import { createHash } from 'node:crypto'
import { NewsItemSchema, type NewsItem } from '../src/features/news/model'
import type { NewsSource } from './sources'
import { allowedUrl } from './remote'

export function parseOfficialReleases(html: string, source: NewsSource, now: Date): NewsItem[] {
  const list = html.match(/<ul\b[^>]*class=["']list1["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1]
  if (!list) throw new Error('官方发布列表结构变化')
  const items: NewsItem[] = []
  for (const match of list.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = allowedUrl(match[1], source.hosts, source.url)
    const text = match[2].replace(/<[^>]*>/g, '').trim()
    const date = text.match(/（(\d{4}-\d{2}-\d{2})）/)?.[1]
    if (!url || !date || !url.pathname.startsWith(new URL(source.url).pathname)) continue
    const timestamp = Date.parse(`${date}T00:00:00+08:00`)
    if (
      !Number.isFinite(timestamp) ||
      timestamp > now.getTime() ||
      now.getTime() - timestamp > 30 * 86400_000
    )
      continue
    items.push(
      NewsItemSchema.parse({
        id: 'official-' + createHash('sha256').update(url.href).digest('hex').slice(0, 20),
        title: text.replace(/（\d{4}-\d{2}-\d{2}）\s*$/, ''),
        summary: '外交部官网发布的例行记者会全文，包含记者提问与发言人回应。点击原文查看完整实录。',
        category: source.category,
        publishedAt: new Date(timestamp).toISOString(),
        publicationPrecision: 'date',
        sourceName: source.name,
        sourceId: source.id,
        sourceUrl: url.href,
        language: 'zh',
        fetchedAt: now.toISOString(),
        provenance: {
          kind: 'official',
          publisher: source.name,
          originalUrl: url.href,
          checkedAt: now.toISOString(),
        },
        location: null,
        locationBasis: '综合记者会涉及多个议题，不标为单一事件发生地。',
        heat: 0,
        sourceCount: 1,
        isDemo: false,
      }),
    )
  }
  return items
}
