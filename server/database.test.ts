import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { NewsDatabase, articleVersion, beijingDay } from './database'
import type { NewsItem } from '../src/features/news/model'
import { locateArticle } from './location'
import { dailyLimits } from './editorial'

const now = new Date('2026-09-18T12:00:00Z')
const article = (id: string, title = 'DeepSeek 发布新模型'): NewsItem => ({
  id,
  title,
  summary: '来源摘要',
  category: '科技',
  publishedAt: '2026-09-18T10:00:00Z',
  sourceName: '测试',
  sourceUrl: `https://example.com/${id}`,
  location: null,
  heat: 0,
  sourceCount: 1,
  isDemo: false,
  language: 'zh',
})
describe('persistent ingestion and jobs', () => {
  const sql = new PGlite()
  const db = new NewsDatabase(sql)
  beforeAll(async () => {
    await sql.waitReady
    await db.init()
  }, 20000)
  afterAll(() => sql.close())
  it('keeps one article across batches, detects changed text and preserves history', async () => {
    const a = article('one')
    expect((await db.ingest([a], now)).added).toBe(1)
    expect((await db.ingest([{ ...a, fetchedAt: now.toISOString() }], now)).unchanged).toBe(1)
    expect((await db.ingest([{ ...a, summary: '模型加入新的能力' }], now)).updated).toBe(1)
    expect(await db.recent(now)).toHaveLength(1)
    expect((await sql.query('SELECT * FROM article_versions')).rows).toHaveLength(2)
    const task = await db.claim(now)
    expect(task?.payload.summary).toBe('模型加入新的能力')
    await db.finish(task!.id, true, task!.attempts, now)
    expect(await db.claim(now)).toBeUndefined()
    await db.ingest([], now)
    expect(await db.recent(now)).toHaveLength(1)
  })
  it('applies a persistent per-publication-day cap even when repeatedly polled', async () => {
    const countries = [
      '法国',
      '巴西',
      '尼日利亚',
      '澳大利亚',
      '日本',
      '美国',
      '沙特阿拉伯',
      '中国',
      '加拿大',
    ]
    const many = Array.from({ length: dailyLimits.AI + 10 }, (_, i) => ({
      ...article('quota' + i),
      location: locateArticle(countries[i % countries.length]).location,
    }))
    expect((await db.ingest(many, now)).added).toBe(dailyLimits.AI - 1)
    expect((await db.ingest(many, now)).added).toBe(0)
    expect(await db.recent(now)).toHaveLength(dailyLimits.AI)
    expect((await db.ingest([{ ...many[0], summary: '重要修正' }], now)).updated).toBe(1)
  })
  it('enforces budget across restarts and uses Beijing day', async () => {
    expect(beijingDay(new Date('2026-09-18T17:00:00Z'))).toBe('2026-09-19')
    expect(await db.reserveBudget(now, 2)).toBe(true)
    const restarted = new NewsDatabase(sql)
    expect(await restarted.reserveBudget(now, 2)).toBe(true)
    expect(await restarted.reserveBudget(now, 2)).toBe(false)
  })
  it('retries failures with delay and stops after three attempts; completed jobs remain unique', async () => {
    await sql.query("UPDATE tasks SET status='done'")
    const a = (await db.recent(now))[0]
    await db.enqueue(a.id, articleVersion(a), 'brief', now, 'retry-test')
    const t = await db.claim(now)
    await db.finish(t!.id, false, 0, now)
    expect(await db.claim(now)).toBeUndefined()
    const later = new Date(now.getTime() + 6 * 60_000)
    const second = await db.claim(later)
    expect(second?.attempts).toBe(1)
    await db.finish(second!.id, false, 2, later)
    expect(await db.claim(new Date(now.getTime() + 86400_000))).toBeUndefined()
  })
})

it.each([false, true])(
  'keeps corrected publication dates consistent (changed text: %s)',
  async (changed) => {
    const sql = new PGlite()
    try {
      const db = new NewsDatabase(sql)
      await db.init()
      const original = { ...article('date'), publishedAt: '2026-09-12T10:00:00.000Z' }
      await db.ingest([original], now)
      await db.ingest(
        [
          {
            ...original,
            publishedAt: '2026-09-18T10:00:00.000Z',
            summary: changed ? '新摘要' : original.summary,
          },
        ],
        now,
      )
      const later = new Date('2026-09-20T12:00:00Z')
      expect(await db.recent(later)).toHaveLength(1)
      const row = (
        await sql.query<{ publication_day: string }>('SELECT publication_day FROM articles')
      ).rows[0]
      expect(row.publication_day).toBe('2026-09-18')
      expect(await db.claim(later)).toBeDefined()
    } finally {
      await sql.close()
    }
  },
  20000,
)

it('repairs previously inconsistent SQL dates from the stored payload on startup', async () => {
  const sql = new PGlite()
  try {
    const db = new NewsDatabase(sql)
    await db.init()
    await db.ingest([article('legacy-date')], now)
    await sql.query("UPDATE articles SET published_at='2026-09-01',publication_day='2026-09-01'")
    await db.init()
    expect(await db.recent(now)).toHaveLength(1)
  } finally {
    await sql.close()
  }
}, 20000)

it.each(['startup', 'ingest'])(
  'revives wrongly expired current tasks after date correction: %s',
  async (mode) => {
    const sql = new PGlite()
    try {
      const db = new NewsDatabase(sql)
      await db.init()
      const original = { ...article('expired-date'), publishedAt: '2026-09-12T10:00:00.000Z' }
      await db.ingest([original], now)
      const later = new Date('2026-09-20T12:00:00Z')
      expect(await db.claim(later)).toBeUndefined()
      const corrected = { ...original, publishedAt: '2026-09-18T10:00:00.000Z' }
      if (mode === 'startup') {
        await sql.query('UPDATE articles SET payload=payload || $1::jsonb', [
          JSON.stringify({ publishedAt: corrected.publishedAt }),
        ])
        await db.init(later)
      } else await db.ingest([corrected], later)
      expect(await db.claim(later)).toMatchObject({ attempts: 0, payload: { id: 'expired-date' } })
    } finally {
      await sql.close()
    }
  },
  20000,
)

it('preserves terminal, exhausted, old-version and out-of-window jobs during recovery', async () => {
  const sql = new PGlite()
  try {
    const db = new NewsDatabase(sql)
    await db.init()
    const cases = ['done', 'failed', 'superseded', 'exhausted', 'old-version', 'future', 'old']
    await db.ingest(
      cases.map((id) => article(id)),
      now,
    )
    for (const id of cases) {
      await sql.query('UPDATE tasks SET status=$2,attempts=$3 WHERE article_id=$1', [
        id,
        ['done', 'failed', 'superseded'].includes(id) ? id : 'expired',
        id === 'exhausted' ? 3 : 0,
      ])
    }
    await sql.query("UPDATE tasks SET version='outdated' WHERE article_id='old-version'")
    await sql.query(
      `UPDATE articles SET payload=payload || jsonb_build_object('publishedAt',CASE WHEN id='future' THEN '2026-09-21T12:00:00.000Z' ELSE '2026-09-01T12:00:00.000Z' END) WHERE id IN ('future','old')`,
    )
    await db.init(new Date('2026-09-20T12:00:00Z'))
    const tasks = (await sql.query<{ status: string }>('SELECT status FROM tasks')).rows
    expect(tasks).toHaveLength(7)
    expect(tasks.filter((task) => task.status === 'expired')).toHaveLength(4)
    expect(tasks.filter((task) => task.status === 'pending')).toHaveLength(0)
  } finally {
    await sql.close()
  }
}, 20000)
