import type { NewsItem } from '../src/features/news/model'
import type { NewsSource } from './sources'
import { allowedUrl } from './remote'
import { articleImage } from './images'
import { locateArticle } from './location'

export async function enrichProvenance(
  items: NewsItem[],
  sources: NewsSource[],
  fetcher: (url: string) => Promise<string>,
  now: Date,
  previous: NewsItem[] = [],
): Promise<NewsItem[]> {
  const result = [...items]
  const prior = new Map(previous.map((item) => [item.id, item]))
  let cursor = 0
  // Four concurrent requests, restricted to articles admitted by a configured CNS feed.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < result.length) {
        const index = cursor++
        const item = result[index]
        const source = sources.find((s) => s.id === item.sourceId)
        if (
          !source ||
          !source.id.startsWith('cns-') ||
          !item.sourceUrl ||
          !allowedUrl(item.sourceUrl, source.hosts)
        )
          continue
        const cached = prior.get(item.id)
        if (
          cached?.provenance?.checkedAt &&
          cached.sourceUrl === item.sourceUrl &&
          cached.sourceId === item.sourceId &&
          cached.title === item.title &&
          (source.kind === 'cns-archive' || cached.summary === item.summary)
        ) {
          result[index] = {
            ...item,
            provenance: cached.provenance,
            imageUrl: item.imageUrl || cached.imageUrl,
            ...(source.kind === 'cns-archive'
              ? { summary: cached.summary, ...locateArticle(item.title, cached.summary) }
              : {}),
          }
        }
        const checked = Date.parse(result[index].provenance?.checkedAt || '')
        if (checked <= now.getTime() && now.getTime() - checked < 86400_000) continue
        try {
          const html = await fetcher(item.sourceUrl)
          const section = html.match(
            /<span\b[^>]*id=["']source_baidu["'][^>]*>([\s\S]*?)<\/span>/i,
          )?.[1]
          const publisher = section
            ?.replace(/<[^>]*>/g, '')
            .replace(/^\s*来源[：:]\s*/, '')
            .trim()
            .slice(0, 80)
          if (!publisher) continue
          const samePublisher = ['中国新闻网', '中新网', '中国新闻社', '中新社'].includes(publisher)
          const opinion = /（钟声）|\(钟声\)|社论[：:]|评论员[：:]|（国际论坛）/.test(item.title)
          // Only images inside the article body, never navigation icons or unrelated recommendations.
          const body = html.match(
            /<div\b[^>]*class=["'][^"']*\bleft_zw\b[^"']*["'][^>]*>([\s\S]*?)(?:<!--|<div\b[^>]*class=["'][^"']*(?:left_name|left_zw_))/i,
          )?.[1]
          const lead =
            source.kind === 'cns-archive' && body
              ? [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
                  .map((match) =>
                    match[1]
                      .replace(/<[^>]*>/g, '')
                      .replace(/&nbsp;/g, ' ')
                      .trim(),
                  )
                .find((text) => text.length >= 20)
                  ?.slice(0, 280)
              : undefined
          result[index] = {
            ...result[index],
            ...(lead ? { summary: lead, ...locateArticle(item.title, lead) } : {}),
            imageUrl:
              result[index].imageUrl ||
              (body ? articleImage({ content: body }, source) : undefined),
            provenance: {
              kind: opinion ? 'commentary' : samePublisher ? 'publisher-original' : 'reprint',
              publisher,
              checkedAt: now.toISOString(),
            },
          }
        } catch {
          /* A failed metadata lookup must not promote or discard a feed article. */
        }
      }
    }),
  )
  return result
}
