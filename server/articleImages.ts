import { load } from 'cheerio'
import { extractArticle } from './article'
import { articleVersion, type NewsDatabase } from './database'
import { allowedUrl, readRemoteText } from './remote'
import { sources, overseasSources, type NewsSource } from './sources'
import type { NewsItem } from '../src/features/news/model'

/** Only the article body or publisher's own article cover metadata, never related stories. */
export function articleImage(html: string, source: NewsSource, url: string) {
  const bodyImage = extractArticle(html, source, url).images[0]?.url
  if (bodyImage) return bodyImage
  const $ = load(html)
  for (const element of $('meta[property="og:image"],meta[name="twitter:image"]').toArray()) {
    const content = $(element).attr('content')?.trim()
    if (!content) continue
    const image = allowedUrl(content, source.imageHosts, url)
    if (image?.protocol === 'https:' && !/(?:qrcode|logo|icon)/i.test(image.pathname))
      return image.href
  }
}

/** Image discovery runs without model calls, with bounded concurrency and a daily retry cache. */
export async function enrichArticleImages(
  db: NewsDatabase,
  items: NewsItem[],
  now = new Date(),
  read = readRemoteText,
) {
  const invalidBadge = (url = '') => /Follow(?:%20| )Google|preferred_source_badge/i.test(url)
  const queue = items.filter(
    (item) => (!item.imageUrl || invalidBadge(item.imageUrl)) && item.sourceUrl,
  )
  let found = 0
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const item = queue.shift()!
        const source = [...sources, ...overseasSources].find(
          (source) => source.id === item.sourceId,
        )
        if (!source || !allowedUrl(item.sourceUrl!, source.hosts)) continue
        const key = `article-image:${item.id}`
        const version = articleVersion(item)
        const cache = await db.state<{ version: string; checkedAt: string }>(key)
        if (
          !invalidBadge(item.imageUrl) &&
          cache?.version === version &&
          now.getTime() - Date.parse(cache.checkedAt) < 86400_000
        )
          continue
        let imageUrl: string | undefined
        try {
          imageUrl = articleImage(
            await read(item.sourceUrl!, source.hosts),
            source,
            item.sourceUrl!,
          )
        } catch {
          /* Missing or blocked source keeps a compact text card. */
        }
        if (imageUrl) {
          await db.db.query(
            'UPDATE articles SET payload=payload || $3::jsonb WHERE id=$1 AND version=$2',
            [item.id, version, JSON.stringify({ imageUrl })],
          )
          found++
        } else if (invalidBadge(item.imageUrl)) {
          await db.db.query(
            "UPDATE articles SET payload=payload - 'imageUrl' WHERE id=$1 AND version=$2",
            [item.id, version],
          )
          found++
        }
        await db.setState(key, { version, checkedAt: now.toISOString() })
      }
    }),
  )
  return found
}
