import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { Client } from 'pg'
import { NewsItemSchema, type NewsItem } from '../src/features/news/model'
import { dailyLimits, rankCandidates, type Channel } from './editorial'
import { editionCoverageCounts, editionRegion, coverageMinimum } from './coverage'
import { acquireProcessLock } from './processLock'

export interface Sql {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  close(): Promise<void>
}
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const beijingDay = (date: Date) =>
  new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
export const articleVersion = (item: NewsItem) => digest([item.title, item.summary])

export async function openDatabase(
  directory: string,
  connection = process.env.DATABASE_URL,
): Promise<Sql> {
  await mkdir(directory, { recursive: true })
  if (connection) {
    const client = new Client({ connectionString: connection })
    await client.connect()
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(481759221) AS locked',
    )
    if (!lock.rows[0].locked) {
      await client.end()
      throw Error('已有新闻 worker 连接数据库。')
    }
    return {
      query: async <T>(sql: string, params?: unknown[]) => ({
        rows: (await client.query(sql, params)).rows as T[],
      }),
      close: () => client.end(),
    }
  }
  // Only the worker opens embedded Postgres. The web server reads its atomic projection.
  const lockPath = join(directory, 'database-owner.lock')
  const lock = await acquireProcessLock(lockPath)
  if (!lock) throw Error('已有新闻 worker 运行或数据库锁所有者未知；请勿同时启动第二个。')
  try {
    const db = new PGlite(join(directory, 'postgres'))
    await db.waitReady
    return {
      query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
      close: async () => {
        await db.close()
        await lock.close()
      },
    }
  } catch (error) {
    await lock.close()
    throw error
  }
}

export class NewsDatabase {
  constructor(readonly db: Sql) {}
  async init(now = new Date()) {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, source_url TEXT UNIQUE NOT NULL, channel TEXT NOT NULL, publication_day TEXT NOT NULL, published_at TIMESTAMPTZ NOT NULL, first_seen TIMESTAMPTZ NOT NULL, last_seen TIMESTAMPTZ NOT NULL, version TEXT NOT NULL, payload JSONB NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at DESC)`,
      `CREATE TABLE IF NOT EXISTS article_versions (article_id TEXT NOT NULL, version TEXT NOT NULL, payload JSONB NOT NULL, observed_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(article_id, version))`,
      `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id), version TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, due_at TIMESTAMPTZ NOT NULL, error TEXT)`,
      `CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status,due_at)`,
      `CREATE TABLE IF NOT EXISTS runtime_state (key TEXT PRIMARY KEY, value JSONB NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS daily_usage (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0)`,
    ])
      await this.db.query(sql)
    // Repair projections written before source-date corrections updated the SQL columns.
    await this.db.query(`UPDATE articles SET
      published_at=(payload->>'publishedAt')::timestamptz,
      publication_day=to_char((payload->>'publishedAt')::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')
      WHERE published_at IS DISTINCT FROM (payload->>'publishedAt')::timestamptz
        OR publication_day IS DISTINCT FROM to_char((payload->>'publishedAt')::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`)
    // The exclusive owner has died if running tasks survive a restart.
    await this.db.query("UPDATE tasks SET status='pending' WHERE status='running'")
    await this.reviveCurrentTasks(now)
  }
  private async reviveCurrentTasks(now: Date) {
    // Expiry is derived from the source date; corrections can bring a job back into the window.
    // Never retry completed/failed tasks, obsolete versions, or exhausted attempts.
    await this.db.query(
      `UPDATE tasks t SET status='pending',due_at=$1,error=NULL FROM articles a
       WHERE t.article_id=a.id AND t.version=a.version AND t.status='expired'
         AND t.attempts < 3 AND a.published_at >= $2 AND a.published_at <= $1`,
      [now.toISOString(), new Date(now.getTime() - 7 * 86400_000).toISOString()],
    )
  }
  async state<T>(key: string): Promise<T | undefined> {
    return (
      await this.db.query<{ value: T }>('SELECT value FROM runtime_state WHERE key=$1', [key])
    ).rows[0]?.value
  }
  async setState(key: string, value: unknown) {
    await this.db.query(
      'INSERT INTO runtime_state VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
      [key, JSON.stringify(value)],
    )
  }
  async ingest(items: NewsItem[], now = new Date()) {
    let added = 0,
      updated = 0,
      unchanged = 0,
      skipped = 0
    await this.db.query('BEGIN')
    try {
      const recent = await this.recent(now)
      const editions = editionCoverageCounts(recent)
      for (const item of rankCandidates(items, recent)) {
        if (!item.sourceUrl || !item.channel) continue
        const existing = (
          await this.db.query<{ id: string; version: string }>(
            'SELECT id,version FROM articles WHERE id=$1 OR source_url=$2',
            [item.id, item.sourceUrl],
          )
        ).rows[0]
        const day = beijingDay(new Date(item.publishedAt))
        if (!existing) {
          // Old RSS archive entries are not current coverage and must not consume model budget.
          if (now.getTime() - Date.parse(item.publishedAt) > 7 * 86400_000) {
            skipped++
            continue
          }
          const count = (
            await this.db.query<{ count: string }>(
              'SELECT count(*) FROM articles WHERE channel=$1 AND publication_day=$2',
              [item.channel, day],
            )
          ).rows[0]
          if (Number(count.count) >= dailyLimits[item.channel as Channel]) {
            skipped++
            continue
          }
          {
            const coverage = editions[item.channel]
            const minimum = item.channel === '全球视野' ? coverageMinimum : 1
            const region = editionRegion(item)
            const reserved = Object.values(coverage).reduce(
              (sum, count) => sum + Math.max(0, minimum - count),
              0,
            )
            if (
              (!region || coverage[region] >= minimum) &&
              Number(count.count) >= dailyLimits[item.channel] - reserved
            ) {
              skipped++
              continue
            }
            if (region) coverage[region]++
          }
        }
        const stable = { ...item, id: existing?.id ?? item.id }
        const version = articleVersion(stable)
        if (existing?.version === version) {
          unchanged++
          await this.db.query(
            'UPDATE articles SET last_seen=$2,payload=payload || $3::jsonb,channel=$4,published_at=$5,publication_day=$6 WHERE id=$1',
            [
              stable.id,
              now.toISOString(),
              JSON.stringify(stable),
              stable.channel,
              stable.publishedAt,
              day,
            ],
          )
          continue
        }
        await this.db.query(
          `INSERT INTO articles VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8::jsonb)
          ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload,last_seen=EXCLUDED.last_seen,channel=EXCLUDED.channel,published_at=EXCLUDED.published_at,publication_day=EXCLUDED.publication_day`,
          [
            stable.id,
            stable.sourceUrl,
            stable.channel,
            day,
            stable.publishedAt,
            now.toISOString(),
            version,
            JSON.stringify(stable),
          ],
        )
        await this.db.query(
          'INSERT INTO article_versions VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING',
          [stable.id, version, JSON.stringify(stable), now.toISOString()],
        )
        for (const kind of ['translation', 'brief']) {
          if (kind === 'translation' && stable.language !== 'en') continue
          await this.enqueue(stable.id, version, kind, now)
        }
        if (existing) updated++
        else added++
      }
      await this.reviveCurrentTasks(now)
      await this.db.query('COMMIT')
    } catch (error) {
      await this.db.query('ROLLBACK')
      throw error
    }
    return { added, updated, unchanged, skipped }
  }
  async enqueue(id: string, version: string, kind: string, now: Date, suffix = '') {
    await this.db.query(
      'INSERT INTO tasks(id,article_id,version,kind,due_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [digest([id, version, kind, suffix]), id, version, kind, now.toISOString()],
    )
  }
  async recent(now = new Date(), days = 7): Promise<NewsItem[]> {
    const rows = await this.db.query<{ payload: unknown }>(
      'SELECT payload FROM articles WHERE published_at >= $1 AND published_at <= $2 ORDER BY published_at DESC',
      [new Date(now.getTime() - days * 86400_000).toISOString(), now.toISOString()],
    )
    return rows.rows.map((row) => NewsItemSchema.parse(row.payload))
  }
  async claim(now = new Date()) {
    await this.db.query(
      "UPDATE tasks SET status='expired' WHERE status='pending' AND article_id IN (SELECT id FROM articles WHERE published_at < $1)",
      [new Date(now.getTime() - 7 * 86400_000).toISOString()],
    )
    // Only one owner executes this connection. Stale-version tasks never overwrite updates.
    await this.db.query(
      "UPDATE tasks SET status='superseded' WHERE status IN ('pending','running') AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.id=tasks.article_id AND a.version=tasks.version)",
    )
    const result = await this.db.query<{
      id: string
      kind: string
      attempts: number
      payload: NewsItem
    }>(
      `SELECT t.id,t.kind,t.attempts,a.payload FROM tasks t JOIN articles a ON a.id=t.article_id
      WHERE t.status='pending' AND t.due_at <= $1 ORDER BY t.due_at, CASE WHEN t.kind='translation' THEN 0 ELSE 1 END LIMIT 1`,
      [now.toISOString()],
    )
    const task = result.rows[0]
    if (task)
      await this.db.query("UPDATE tasks SET status='running',attempts=attempts+1 WHERE id=$1", [
        task.id,
      ])
    return task
  }
  async finish(id: string, ok: boolean, attempts: number, now = new Date()) {
    const exhausted = attempts + 1 >= 3
    await this.db.query('UPDATE tasks SET status=$2,due_at=$3,error=$4 WHERE id=$1', [
      id,
      ok ? 'done' : exhausted ? 'failed' : 'pending',
      new Date(now.getTime() + 5 * 60_000 * 2 ** attempts).toISOString(),
      ok ? null : '来源或模型暂不可用；最多重试三次',
    ])
  }
  async reserveBudget(now: Date, limit: number): Promise<boolean> {
    if (limit <= 0) return false
    const r = await this.db.query(
      `INSERT INTO daily_usage(day,attempts) VALUES($1,1) ON CONFLICT(day) DO UPDATE SET attempts=daily_usage.attempts+1 WHERE daily_usage.attempts < $2 RETURNING attempts`,
      [beijingDay(now), limit],
    )
    return r.rows.length > 0
  }
  async stats() {
    return {
      articles: (await this.db.query('SELECT channel,count(*) FROM articles GROUP BY channel'))
        .rows,
      tasks: (await this.db.query('SELECT status,count(*) FROM tasks GROUP BY status')).rows,
      usage: (await this.db.query('SELECT * FROM daily_usage ORDER BY day DESC LIMIT 7')).rows,
    }
  }
}
