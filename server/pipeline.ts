import { renameWithRetry as rename } from './atomic'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NewsFeedSchema, type NewsFeed } from '../src/features/news/model'
import { NewsDatabase, openDatabase, beijingDay, articleVersion } from './database'
import { aggregateFeeds } from './news'
import { activeSources } from './sources'
import { attachTranslations, readTranslations, translateItems, translationKey } from './translation'
import { attachBriefs, briefKey, enrichBriefs, readBriefs } from './briefs'
import { scopeNews } from './editorial'
import { readRemoteDocument } from './remote'
import { enrichArticleImages } from './articleImages'
import { coverageCounts, editionCoverageCounts, coverageMinimum, coverageTarget } from './coverage'

export class NewsPipeline {
  constructor(
    readonly database: NewsDatabase,
    readonly directory: string,
  ) {}
  async init(now = new Date()) {
    await this.database.init(now)
    if (!(await this.database.state('imported-v1'))) {
      try {
        const legacy = NewsFeedSchema.parse(
          JSON.parse(await readFile(join(this.directory, 'news.json'), 'utf8')),
        )
        // Source snapshot remains untouched until the first complete database projection.
        await this.database.ingest(legacy.items, now)
        await this.database.setState('feed', {
          generatedAt: legacy.generatedAt,
          mode: 'live',
          sources: legacy.sources,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await this.database.setState('imported-v1', { at: now.toISOString() })
    }
    await this.publish(now)
  }
  async collect(now = new Date()) {
    const previous = await this.snapshot(now)
    try {
      const feed = await aggregateFeeds(
        activeSources(),
        previous,
        async (source) => {
          const cache = await this.database.state<{
            text: string
            etag?: string
            modified?: string
          }>(`source:${source.id}`)
          const fetched = await readRemoteDocument(
            source.url,
            [...source.hosts, new URL(source.url).hostname],
            cache,
          )
          if (fetched.notModified && cache) return cache.text
          if (fetched.notModified) throw Error('来源返回无对应缓存的 304')
          await this.database.setState(`source:${source.id}`, fetched)
          return fetched.text
        },
        now,
      )
      const stats = await this.database.ingest(feed.items, now)
      await this.database.setState('feed', {
        generatedAt: feed.generatedAt,
        mode: 'live',
        sources: feed.sources,
      })
      await this.database.setState('collection', {
        checkedAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        status: 'ok',
        ...stats,
      })
      // Revisit recent articles once per day to discover corrections at an unchanged URL.
      for (const item of await this.database.recent(now, 2))
        await this.database.enqueue(item.id, articleVersion(item), 'brief', now, beijingDay(now))
      await this.publish(now)
      await this.enrichImages(now)
      return stats
    } catch {
      await this.database.setState('feed', {
        generatedAt: previous.generatedAt,
        mode: 'live',
        sources: previous.sources?.map((source) => ({
          ...source,
          status: 'cached',
          message: '本轮读取失败，保留历史内容。',
        })),
      })
      const previousState = await this.database.state<Record<string, unknown>>('collection')
      await this.database.setState('collection', {
        ...previousState,
        checkedAt: now.toISOString(),
        status: 'error',
        message: '本轮采集失败，保留历史内容，下轮自动重试。',
      })
      await this.publish(now)
      throw Error('采集失败，历史新闻已保留。')
    }
  }
  async enrichImages(now = new Date()) {
    const feed = await this.snapshot(now)
    const found = await enrichArticleImages(this.database, feed.items, now)
    if (found) await this.publish(now)
    return found
  }
  async processJobs(max = 8, now = new Date()) {
    let processed = 0
    for (; processed < max; processed++) {
      const task = await this.database.claim(now)
      if (!task) break
      const item = task.payload
      if (!scopeNews([item]).length) {
        await this.database.finish(task.id, true, task.attempts, now)
        continue
      }
      let ok = false
      const cached =
        task.kind === 'translation'
          ? (await readTranslations(this.directory))[translationKey(item)]
          : (await readBriefs(this.directory))[briefKey(item)]
      const fresh =
        cached &&
        (!('status' in cached) ||
          (cached.status !== 'unavailable' &&
            now.getTime() - Date.parse(cached.checkedAt ?? cached.generatedAt) < 86400_000))
      if (fresh) ok = true
      else {
        const limit = Number(process.env.NEWS_DAILY_AI_ATTEMPTS || 200)
        const reserve = () =>
          this.database.reserveBudget(new Date(), Number.isFinite(limit) ? Math.max(0, limit) : 200)
        const defer = () =>
          this.database.db.query(
            "UPDATE tasks SET status='pending',attempts=attempts-1,due_at=$2 WHERE id=$1",
            [task.id, new Date(Date.now() + 3600_000).toISOString()],
          )
        if (!process.env.DEEPSEEK_API_KEY?.trim()) {
          // Do not burn retries while waiting for a key or the next daily budget.
          await defer()
          break
        }
        try {
          const result =
            task.kind === 'translation'
              ? await translateItems([item], this.directory, { now, beforeGenerate: reserve })
              : await enrichBriefs([item], this.directory, {
                  now,
                  retryUnavailable: true,
                  beforeGenerate: reserve,
                })
          if (result.status === 'deferred' || result.status === 'busy') {
            await defer()
            await this.publish(new Date())
            break
          }
          ok = result.status === 'ok'
        } catch {
          /* Only generic failure state is stored; never provider bodies or keys. */
        }
      }
      await this.database.finish(task.id, !!ok, task.attempts, now)
      await this.publish(new Date())
    }
    return processed
  }
  async snapshot(now = new Date()): Promise<NewsFeed> {
    const meta = await this.database.state<Omit<NewsFeed, 'items'>>('feed')
    return NewsFeedSchema.parse({
      ...meta,
      mode: 'live',
      generatedAt: meta?.generatedAt ?? now.toISOString(),
      items: attachBriefs(
        attachTranslations(
          scopeNews(await this.database.recent(now)),
          await readTranslations(this.directory),
        ),
        await readBriefs(this.directory),
      ),
    })
  }
  async publish(now = new Date()) {
    await mkdir(this.directory, { recursive: true })
    const feed = await this.snapshot(now)
    const temporary = join(this.directory, `projection-${process.pid}.tmp`)
    await writeFile(temporary, JSON.stringify(feed, null, 2), 'utf8')
    await rename(temporary, join(this.directory, 'news.json'))
    const status = {
      checkedAt: now.toISOString(),
      collection: await this.database.state('collection'),
      coverage: {
        windowDays: 7,
        minimum: coverageMinimum,
        target: coverageTarget,
        counts: coverageCounts(feed.items),
        byChannel: editionCoverageCounts(feed.items),
        chineseByChannel: editionCoverageCounts(
          feed.items.filter((item) => item.language !== 'en' || item.translation),
        ),
      },
      reading: feed.items.reduce(
        (counts, item) => {
          const status = item.brief?.status ?? 'pending'
          counts[status] = (counts[status] ?? 0) + 1
          return counts
        },
        {} as Record<string, number>,
      ),
      ...(await this.database.stats()),
    }
    const statusTmp = join(this.directory, `status-${process.pid}.tmp`)
    await writeFile(statusTmp, JSON.stringify(status, null, 2), 'utf8')
    await rename(statusTmp, join(this.directory, 'worker-status.json'))
    return feed
  }
  async backup(now = new Date()) {
    // Consistent logical backup from the exclusive database owner, not a copy of live PG files.
    const tables: Record<string, unknown> = {}
    for (const table of ['articles', 'article_versions', 'tasks', 'runtime_state', 'daily_usage'])
      tables[table] = (await this.database.db.query(`SELECT * FROM ${table}`)).rows
    const destination = join(this.directory, 'backups')
    await mkdir(destination, { recursive: true })
    const file = join(destination, `${beijingDay(now)}.json`)
    await writeFile(
      file + '.tmp',
      JSON.stringify({
        schema: 1,
        at: now.toISOString(),
        tables,
        translations: await readTranslations(this.directory),
        briefs: await readBriefs(this.directory),
      }),
      'utf8',
    )
    await rename(file + '.tmp', file)
  }
}

export async function runOnce(directory: string) {
  const db = await openDatabase(directory)
  try {
    const pipeline = new NewsPipeline(new NewsDatabase(db), directory)
    await pipeline.init()
    await pipeline.collect()
    await pipeline.processJobs(100)
    await pipeline.backup()
    return await pipeline.publish()
  } finally {
    await db.close()
  }
}
