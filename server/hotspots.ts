import type { Hotspot, HotspotFeed } from '../src/features/news/model'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { readRemoteText } from './remote'

function topic(
  platform: Hotspot['platform'],
  title: string,
  rank: number,
  heat: string,
  now: Date,
): Hotspot {
  return {
    id: platform + '-' + createHash('sha256').update(title).digest('hex').slice(0, 16),
    platform,
    title,
    rank,
    heat,
    observedAt: now.toISOString(),
    url:
      (platform === 'baidu' ? 'https://www.baidu.com/s?wd=' : 'https://s.weibo.com/weibo?q=') +
      encodeURIComponent(title),
  }
}
function unique(items: Hotspot[]) {
  const result = [...new Map(items.map((i) => [i.title, i])).values()]
  if (!result.length) throw new Error('没有可读取的热点')
  return result.slice(0, 50)
}
export function parseBaiduHotspots(html: string, now: Date): Hotspot[] {
  const embedded = html.match(/<!--s-data:([\s\S]*?)-->/)?.[1]
  if (!embedded) throw new Error('百度页面结构变化')
  const data = z
    .object({
      data: z.object({
        cards: z.array(
          z.object({
            component: z.string(),
            content: z.array(z.unknown()).optional(),
          }),
        ),
      }),
    })
    .parse(JSON.parse(embedded))
  const entries = data.data.cards.find((c) => c.component === 'hotList')?.content || []
  const seen = new Set<string>()
  const items: Hotspot[] = []
  for (const raw of entries) {
    const parsed = z
      .object({
        word: z.string().trim().min(1).max(240),
        index: z.number().int().min(0).max(100),
        hotScore: z.string().max(40),
        isTop: z.boolean().optional(),
      })
      .safeParse(raw)
    if (!parsed.success || parsed.data.isTop || seen.has(parsed.data.word)) continue
    const entry = parsed.data
    seen.add(entry.word)
    items.push(topic('baidu', entry.word, entry.index + 1, entry.hotScore, now))
  }
  return unique(items)
}
export function parseWeiboHotspots(json: string, now: Date): Hotspot[] {
  const data = z
    .object({
      code: z.literal(200),
      result: z.object({
        list: z.array(
          z.object({
            hotword: z.string().trim().min(1).max(240),
            hotwordnum: z.union([z.string(), z.number()]),
          }),
        ),
      }),
    })
    .parse(JSON.parse(json))
  return unique(
    data.result.list.map((entry, i) =>
      topic('weibo', entry.hotword, i + 1, String(entry.hotwordnum).slice(0, 40), now),
    ),
  )
}
export async function collectHotspots(
  previous?: HotspotFeed,
  options: { now?: Date; weiboKey?: string; fetcher?: (url: string) => Promise<string> } = {},
): Promise<HotspotFeed> {
  const now = options.now || new Date()
  const key = options.weiboKey ?? process.env.TIANAPI_KEY ?? ''
  const fetcher = options.fetcher || readRemoteText
  const configs = [
    {
      id: 'baidu' as const,
      name: '百度热榜',
      url: 'https://top.baidu.com/board?tab=realtime',
      parse: parseBaiduHotspots,
    },
    {
      id: 'weibo' as const,
      name: '微博热搜',
      url: 'https://apis.tianapi.com/weibohot/index?key=' + encodeURIComponent(key),
      parse: parseWeiboHotspots,
    },
  ]
  const results = await Promise.all(
    configs.map(async (config): Promise<HotspotFeed> => {
      if (config.id === 'weibo' && !key)
        return {
          items: [],
          sources: [
            {
              id: 'weibo',
              name: config.name,
              status: 'not-configured',
              message: '等待接入，暂无榜单数据',
            },
          ],
        }
      try {
        const items = config.parse(await fetcher(config.url), now)
        return {
          items,
          sources: [
            {
              id: config.id,
              name: config.name,
              status: 'ok',
              fetchedAt: now.toISOString(),
              message: `${items.length} 条平台热点`,
            },
          ],
        }
      } catch {
        const items = (previous?.items || []).filter(
          (item) =>
            item.platform === config.id &&
            Date.parse(item.observedAt) <= now.getTime() &&
            now.getTime() - Date.parse(item.observedAt) < 86400_000,
        )
        return {
          items,
          sources: [
            {
              id: config.id,
              name: config.name,
              status: items.length ? 'cached' : 'error',
              fetchedAt: items[0]?.observedAt,
              message: items.length ? '更新失败，显示上次榜单' : '暂时无法读取榜单',
            },
          ],
        }
      }
    }),
  )
  return {
    items: results.flatMap((r) => r.items),
    sources: [
      ...results.flatMap((r) => r.sources),
      {
        id: 'xiaohongshu',
        name: '小红书',
        status: 'unavailable',
        message: '尚未接入，暂无可用订阅',
      },
    ],
  }
}
