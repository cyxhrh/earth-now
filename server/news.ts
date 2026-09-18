import { createHash } from 'node:crypto'
import Parser from 'rss-parser'
import {
  NewsFeedSchema,
  NewsItemSchema,
  type NewsFeed,
  type NewsItem,
} from '../src/features/news/model'
import type { NewsSource } from './sources'
import { articleImage, type MediaFields } from './images'
import { parseOfficialReleases } from './official'
import { readRemoteText } from './remote'
import { fetchArchiveRss } from './archive'

export { locateTitle } from './location'
import { locateArticle, locateTechnologyArticle } from './location'

function plainText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function normalizeFeed(
  xml: string,
  source: NewsSource,
  now: Date,
): Promise<NewsItem[]> {
  // Embedded HTML in CDATA is inert text, not an XML entity declaration.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')))
    throw new Error('不支持带自定义实体的订阅源')
  const parsed = await new Parser<Record<string, never>, MediaFields>({
    customFields: {
      item: [
        ['media:thumbnail', 'thumbnails', { keepArray: true }],
        ['media:content', 'media', { keepArray: true }],
        ['media:group', 'mediaGroups', { keepArray: true }],
      ],
    },
  }).parseString(xml)
  const items: NewsItem[] = []
  for (const entry of parsed.items.slice(0, source.maxItems ?? 60)) {
    const published = Date.parse(entry.isoDate || entry.pubDate || '')
    if (
      !Number.isFinite(published) ||
      published > now.getTime() ||
      now.getTime() - published > 30 * 86400_000
    )
      continue
    let url: URL
    try {
      url = new URL(entry.link || '')
    } catch {
      continue
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !source.hosts.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))
    )
      continue
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key === 'at_medium' || key === 'at_campaign')
        url.searchParams.delete(key)
    }
    const title = plainText(entry.title || '').slice(0, 240)
    if (!title) continue
    const rawSummary = plainText(entry.contentSnippet || entry.summary || '')
    const summary = rawSummary.length > 280 ? rawSummary.slice(0, 280) + '…' : rawSummary
    const { location, locationBasis } =
      source.category === '科技' || source.category === 'AI'
        ? locateTechnologyArticle(title, summary)
        : locateArticle(title, summary)
    const category =
      source.category === '社会' &&
      /气候|洪水|地震|干旱|climate|earthquake|flood|drought/i.test(title)
        ? '自然'
        : source.kind === 'cns-archive' && url.pathname.startsWith('/cj/')
          ? '经济'
          : source.kind === 'cns-archive' && /\/(?:cul|wh)\//.test(url.pathname)
            ? '文化'
            : source.category
    const item = NewsItemSchema.parse({
      id: 'rss-' + createHash('sha256').update(url.href).digest('hex').slice(0, 20),
      title,
      summary: summary || '订阅源未提供摘要，请阅读原文。',
      category,
      publishedAt: new Date(published).toISOString(),
      sourceName: source.name,
      sourceUrl: url.href,
      imageUrl: articleImage(entry, source),
      sourceId: source.id,
      language: source.language,
      fetchedAt: now.toISOString(),
      location,
      locationBasis,
      heat: 0,
      sourceCount: 1,
      isDemo: false,
      provenance:
        (source.id.startsWith('guardian-') &&
          (/\/commentisfree\/|\/editorial\//.test(url.pathname) || /\s\|\s/.test(title))) ||
        /\b(?:opinion|sponsored|partner content|press release|book excerpt)\b/i.test(
          (entry.categories ?? [])
            .map((category: unknown) =>
              typeof category === 'string'
                ? category
                : category &&
                    typeof category === 'object' &&
                    '_' in category &&
                    typeof category._ === 'string'
                  ? category._
                  : '',
            )
            .join(' '),
        ) ||
        /^(?:In an excerpt from|In this excerpt from)/i.test(summary)
          ? { kind: 'commentary' }
          : ['openai', 'apple-newsroom'].includes(source.id)
            ? {
                kind: 'official',
                publisher: source.id === 'apple-newsroom' ? 'Apple' : 'OpenAI',
                originalUrl: url.href,
                checkedAt: now.toISOString(),
              }
            : { kind: 'unverified' },
    })
    items.push(item)
  }
  return items
}

export async function fetchSource(source: NewsSource, now = new Date()): Promise<string> {
  if (source.kind === 'cns-archive') return fetchArchiveRss(now)
  return readRemoteText(source.url, [...source.hosts, new URL(source.url).hostname])
}

export async function aggregateFeeds(
  config: NewsSource[],
  previous: NewsFeed | null,
  fetcher = fetchSource,
  now = new Date(),
  allowUnavailable = false,
): Promise<NewsFeed> {
  const results = await Promise.all(
    config.map(async (source) => {
      try {
        const content = await fetcher(source, now)
        const items =
          source.kind === 'mfa'
            ? parseOfficialReleases(content, source, now)
            : await normalizeFeed(content, source, now)
        if (!items.length) throw new Error('没有有效的近期新闻')
        return {
          items,
          status: {
            id: source.id,
            name: source.name,
            url: source.url,
            status: 'ok' as const,
            count: items.length,
            fetchedAt: now.toISOString(),
          },
        }
      } catch (error) {
        const items = (previous?.items || []).filter(
          (item) =>
            item.sourceId === source.id &&
            now.getTime() - Date.parse(item.publishedAt) <= 30 * 86400_000,
        )
        return {
          items,
          status: {
            id: source.id,
            name: source.name,
            url: source.url,
            status: items.length ? ('cached' as const) : ('error' as const),
            count: items.length,
            fetchedAt: previous?.sources?.find((s) => s.id === source.id)?.fetchedAt,
            message: error instanceof Error ? error.message : '读取失败',
          },
        }
      }
    }),
  )
  const updated = results.some((result) => result.status.status === 'ok')
  if (!updated && !allowUnavailable) throw new Error('所有新闻源读取失败，保留上一批数据。')
  const unique = new Map<string, NewsItem>()
  for (const result of results)
    for (const item of result.items) if (!unique.has(item.id)) unique.set(item.id, item)
  return NewsFeedSchema.parse({
    mode: 'live',
    generatedAt: !updated && previous ? previous.generatedAt : now.toISOString(),
    sources: results.map((r) => r.status),
    items: [...unique.values()].sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    ),
  })
}
