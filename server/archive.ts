import { allowedUrl, readRemoteText } from './remote'
import { locateArticle } from './location'

interface ArchiveStory {
  title: string
  url: string
  publishedAt: string
}
const hosts = ['chinanews.com.cn', 'chinanews.com']
const decode = (text: string) =>
  text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function parseArchivePage(html: string, day: string): ArchiveStory[] {
  const items: ArchiveStory[] = []
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const row = match[1]
    const link = row.match(
      /class=["']dd_bt["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    )
    const time = row.match(/class=["']dd_time["'][^>]*>\s*(\d{1,2})-(\d{1,2}) (\d{2}):(\d{2})\s*</i)
    if (!link || !time) continue
    const url = allowedUrl(decode(link[1]), hosts, 'https://www.chinanews.com.cn')
    const title = decode(link[2])
    const date = `${day.slice(0, 4)}-${time[1].padStart(2, '0')}-${time[2].padStart(2, '0')}`
    if (
      !url ||
      !title ||
      date !== day ||
      !url.pathname.includes(`/${day.slice(0, 4)}/${day.slice(5)}/`) ||
      !/\.shtml$/.test(url.pathname) ||
      +time[3] > 23 ||
      +time[4] > 59
    )
      continue
    const stamp = Date.parse(`${date}T${time[3]}:${time[4]}:00+08:00`)
    if (Number.isFinite(stamp))
      items.push({ title, url: url.href, publishedAt: new Date(stamp).toISOString() })
  }
  return items
}

// A geographic supplement to the main RSS feeds: only explicitly located
// overseas stories, sampled across distinct places rather than newest-first.
export function selectArchiveStories(items: ArchiveStory[], limit = 180): ArchiveStory[] {
  const groups = new Map<string, ArchiveStory[]>()
  const seen = new Set<string>()
  for (const item of [...items].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  )) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    const location = locateArticle(item.title).location
    const candidate = !location ? item.title.match(/中澳|澳中|中美|中加|中巴|中拉/)?.[0] : undefined
    if ((!location && !candidate) || location?.name === '中国' || location?.name.endsWith('，中国'))
      continue
    const key = location?.name ?? `待核对地点:${candidate}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  const selected: ArchiveStory[] = []
  for (let index = 0; index < 6 && selected.length < limit; index++) {
    for (const group of groups.values()) {
      if (group[index]) selected.push(group[index])
      if (selected.length >= limit) break
    }
  }
  return selected
}

export async function fetchArchiveRss(now: Date, fetcher = readRemoteText): Promise<string> {
  const beijingDay = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  const fetchPage = async (url: string) => {
    try {
      return await fetcher(url)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (error.name !== 'TimeoutError' && !/HTTP 50[234]|fetch failed/.test(error.message))
      )
        throw error
      return fetcher(url)
    }
  }
  const pages: ArchiveStory[][] = Array.from({ length: 7 }, () => [])
  let cursor = 0
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < 7) {
        const offset = cursor++
        const day = new Date(Date.parse(`${beijingDay}T00:00:00Z`) - offset * 86400_000)
          .toISOString()
          .slice(0, 10)
        const url = `https://www.chinanews.com.cn/scroll-news/${day.slice(0, 4)}/${day.slice(5).replace('-', '')}/news.shtml`
        pages[offset] = parseArchivePage(await fetchPage(url), day)
      }
    }),
  )
  const items = selectArchiveStories(
    pages.flat().filter((item) => Date.parse(item.publishedAt) <= now.getTime()),
  )
  return `<rss version="2.0"><channel><title>中新网国际地区补充</title>${items.map((item) => `<item><title>${escapeXml(item.title)}</title><link>${escapeXml(item.url)}</link><pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`
}
