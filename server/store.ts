import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { NewsFeedSchema, type NewsFeed } from '../src/features/news/model'
import { aggregateFeeds, fetchSource } from './news'
import { type NewsSource } from './sources'
import { locateArticle, locateTechnologyArticle } from './location'
import { collectHotspots } from './hotspots'
import { readRemoteText } from './remote'
import { attachTranslations, readTranslations } from './translation'
import { attachBriefs, readBriefs } from './briefs'

export const dataDir = resolve(process.env.NEWS_DATA_DIR || 'data')

export async function collectBatch(
  config: NewsSource[],
  previous: NewsFeed | null,
  newsFetcher = fetchSource,
  hotspotFetcher: (url: string) => Promise<string> = readRemoteText,
  now = new Date(),
): Promise<NewsFeed> {
  const [news, hotspots] = await Promise.all([
    aggregateFeeds(config, previous, newsFetcher, now, true),
    collectHotspots(previous?.hotspots, { fetcher: hotspotFetcher, now }),
  ])
  if (
    !news.sources?.some((s) => s.status === 'ok') &&
    !hotspots.sources.some((s) => s.status === 'ok')
  )
    throw new Error('新闻与热点均读取失败，保留上一批数据。')
  return NewsFeedSchema.parse({ ...news, hotspots })
}
export async function readSnapshot(directory = dataDir): Promise<NewsFeed | null> {
  try {
    const feed = NewsFeedSchema.parse(
      JSON.parse(await readFile(join(directory, 'news.json'), 'utf8')),
    )
    // Re-evaluate cached articles too; changing the gazetteer requires no upstream fetch.
    return {
      ...feed,
      items: attachBriefs(
        attachTranslations(
          feed.items.map((item) =>
            item.isDemo || item.provenance?.kind === 'official'
              ? item
              : {
                  ...item,
                  ...(item.channel === 'AI' || item.channel === '科技'
                    ? locateTechnologyArticle(item.title, item.summary)
                    : locateArticle(item.title, item.summary)),
                },
          ),
          await readTranslations(directory),
        ),
        await readBriefs(directory),
      ),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function refreshSnapshot(directory = dataDir) {
  const { runOnce } = await import('./pipeline')
  return runOnce(directory)
}
