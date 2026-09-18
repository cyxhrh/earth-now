import { describe, expect, it } from 'vitest'
import { normalizeFeed, aggregateFeeds, locateTitle } from './news'
import { overseasSources as sources } from './sources'

const now = new Date('2026-09-16T12:00:00Z')
const xml = (title = '也门人道援助最新进展', link = 'https://news.un.org/zh/story/123') => `
<rss version="2.0"><channel><title>Test</title><item>
<title>${title}</title><link>${link}</link>
<description><![CDATA[<p>来自订阅源的简短摘要。</p>]]></description>
<pubDate>Wed, 16 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`

describe('RSS ingestion boundary', () => {
  it('normalizes attributed RSS categories and still identifies commentary', async () => {
    for (const category of ['World news', 'Opinion']) {
      const input = xml().replace(
        '</item>',
        `<category domain="https://example.com/topic">${category}</category><category>News</category></item>`,
      )
      const items = await normalizeFeed(input, sources[0], now)
      expect(items).toHaveLength(1)
      expect(items[0].provenance?.kind).toBe(category === 'Opinion' ? 'commentary' : 'unverified')
    }
  })
  it('preserves source time, real link and plain text; maps only an explicit place', async () => {
    const items = await normalizeFeed(xml(), sources[0], now)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      isDemo: false,
      sourceCount: 1,
      heat: 0,
      publishedAt: '2026-09-16T10:00:00.000Z',
      summary: '来自订阅源的简短摘要。',
      location: { name: '也门', precision: 'country' },
      sourceUrl: 'https://news.un.org/zh/story/123',
    })
  })
  it('rejects invalid dates, future articles, dangerous and off-publisher links', async () => {
    for (const input of [
      xml().replace('Wed, 16 Sep 2026 10:00:00 GMT', 'not a date'),
      xml().replace('16 Sep', '17 Sep'),
      xml('新闻', 'javascript:alert(1)'),
      xml('新闻', 'https://evil.example/a'),
    ]) {
      expect(await normalizeFeed(input, sources[0], now)).toEqual([])
    }
  })
  it('leaves ambiguous, multiple-country and absent locations unlocated', () => {
    expect(locateTitle('Iran and Israel hold talks')).toBeNull()
    expect(locateTitle('Researchers tell us about AI')).toBeNull()
    expect(locateTitle('US researchers tell us about AI')?.name).toBe('美国')
    expect(locateTitle('US limits visas for South African officials')).toBeNull()
    expect(locateTitle('Colombia and Brazil report')).toBeNull()
    expect(locateTitle('数字世界的新变化')).toBeNull()
    expect(locateTitle('南苏丹援助进展')?.name).toBe('南苏丹')
  })
  it('deduplicates canonical links without inventing independent sources', async () => {
    const feed = await aggregateFeeds(
      [sources[0], { ...sources[0], id: 'copy' }],
      null,
      async () => xml(),
      now,
    )
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0].sourceCount).toBe(1)
  })
  it('retains the prior batch for a failed source and marks it cached', async () => {
    const previous = await aggregateFeeds([sources[0]], null, async () => xml(), now)
    const feed = await aggregateFeeds(
      [sources[0], sources[1]],
      previous,
      async (source) => {
        if (source.id === sources[0].id) throw new Error('network down')
        return xml('Japan technology news', 'https://www.bbc.com/news/articles/123')
      },
      new Date('2026-09-16T13:00:00Z'),
    )
    expect(feed.sources?.[0]).toMatchObject({ status: 'cached', fetchedAt: now.toISOString() })
    expect(feed.items.some((item) => item.sourceId === sources[0].id)).toBe(true)
    expect(feed.items).toHaveLength(2)
  })
  it('does not replace a valid batch when all upstream sources fail', async () => {
    const previous = await aggregateFeeds([sources[0]], null, async () => xml(), now)
    await expect(
      aggregateFeeds(
        [sources[0]],
        previous,
        async () => {
          throw new Error('offline')
        },
        now,
      ),
    ).rejects.toThrow('所有新闻源')
  })
})
