import { describe, expect, it } from 'vitest'
import { normalizeFeed, aggregateFeeds } from './news'
import { parseBaiduHotspots, parseWeiboHotspots, collectHotspots } from './hotspots'
import { enrichProvenance } from './provenance'
import type { NewsSource } from './sources'
import { collectBatch } from './store'

const now = new Date('2026-09-18T09:00:00Z')
const source: NewsSource = {
  id: 'cns-world',
  name: '中新网 · 国际',
  url: 'https://www.chinanews.com.cn/rss/world.xml',
  hosts: ['chinanews.com.cn'],
  imageHosts: ['chinanews.com.cn', 'chinanews.com'],
  category: '社会',
  language: 'zh',
}
const xml = `<rss version="2.0"><channel><item><title>菲律宾最新消息</title>
<link>https://www.chinanews.com.cn/gj/2026/09-18/123.shtml</link>
<description>消息摘要</description><pubDate>Fri, 18 Sep 2026 16:00:00 +0800</pubDate>
</item></channel></rss>`

describe('source provenance', () => {
  it('uses a bounded archive article lead for venue evidence and reuses it from metadata cache', async () => {
    const archive: NewsSource = { ...source, kind: 'cns-archive' }
    const [item] = await normalizeFeed(
      xml.replace('菲律宾最新消息', '中澳经贸合作向新向绿'),
      archive,
      now,
    )
    const html =
      '<span id="source_baidu">中国新闻网</span><div class="left_zw"><p>中新社墨尔本9月12日电 展览在澳大利亚墨尔本举行。</p><!-- end -->'
    const [enriched] = await enrichProvenance([item], [archive], async () => html, now)
    expect(enriched.location?.name).toBe('墨尔本，澳大利亚')
    expect(enriched.summary).toContain('展览在澳大利亚墨尔本举行')
    const [cached] = await enrichProvenance(
      [item],
      [archive],
      async () => {
        throw Error('should use cache')
      },
      now,
      [enriched],
    )
    expect(cached.summary).toBe(enriched.summary)
    expect(cached.location).toEqual(enriched.location)
  })
  it('reuses recent verified attribution and retains it unchanged when an overdue lookup fails', async () => {
    const [item] = await normalizeFeed(xml, source, now)
    const previous = {
      ...item,
      imageUrl: 'https://www.chinanews.com.cn/photo.jpg',
      provenance: {
        kind: 'reprint' as const,
        publisher: '央视新闻客户端',
        checkedAt: now.toISOString(),
      },
    }
    let calls = 0
    const fetcher = async () => {
      calls++
      throw new Error('offline')
    }
    const [recent] = await enrichProvenance(
      [item],
      [source],
      fetcher,
      new Date('2026-09-18T10:00:00Z'),
      [previous],
    )
    expect(calls).toBe(0)
    expect(recent.provenance).toEqual(previous.provenance)
    const [overdue] = await enrichProvenance(
      [item],
      [source],
      fetcher,
      new Date('2026-09-20T10:00:00Z'),
      [previous],
    )
    expect(calls).toBe(1)
    expect(overdue.provenance).toEqual(previous.provenance)
    expect(overdue.imageUrl).toBe(previous.imageUrl)
  })
  it('does not label a media feed as firsthand and preserves its stated original publisher', async () => {
    const [item] = await normalizeFeed(xml, source, now)
    expect(item.provenance?.kind).toBe('unverified')
    const [enriched] = await enrichProvenance(
      [item],
      [source],
      async () => '<span id="source_baidu">来源：<a href="">央视新闻客户端</a></span>',
      now,
    )
    expect(enriched.provenance).toMatchObject({ kind: 'reprint', publisher: '央视新闻客户端' })
    expect(enriched.sourceUrl).toBe(item.sourceUrl)
    expect(enriched.provenance?.originalUrl).toBeUndefined()
  })
  it('keeps attribution unverified if the page cannot be read, and does not fetch unrelated URLs', async () => {
    const [item] = await normalizeFeed(xml, source, now)
    let calls = 0
    const result = await enrichProvenance(
      [item, { ...item, sourceUrl: 'https://evil.example/a' }],
      [source],
      async () => {
        calls += 1
        throw new Error('offline')
      },
      now,
    )
    expect(calls).toBe(1)
    expect(result.every((i) => i.provenance?.kind === 'unverified')).toBe(true)
  })
  it('recognizes a dated official release without inventing an event location or a publication time', async () => {
    const official: NewsSource = {
      ...source,
      id: 'mfa',
      name: '外交部',
      kind: 'mfa',
      url: 'https://www.mfa.gov.cn/wjdt_674879/fyrbt_674889/',
      hosts: ['www.mfa.gov.cn'],
    }
    const html = `<ul class="list1"><li><a href="./202609/t20260917_123.shtml">例行记者会（2026-09-17）</a></li>
      <li><a href="https://evil.example/202609/t20260917_123.shtml">伪造（2026-09-17）</a></li></ul>`
    const feed = await aggregateFeeds([official], null, async () => html, now)
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      provenance: { kind: 'official', publisher: '外交部' },
      publicationPrecision: 'date',
      location: null,
      sourceUrl: 'https://www.mfa.gov.cn/wjdt_674879/fyrbt_674889/202609/t20260917_123.shtml',
    })
  })
})

describe('hotspot data remains a separate signal', () => {
  const html = `<!--s-data:${JSON.stringify({
    data: {
      cards: [
        {
          component: 'hotList',
          content: [
            { word: '置顶话题', isTop: true, index: 0, hotScore: '900' },
            { word: '火星任务新进展', index: 0, hotScore: '800', url: 'javascript:alert(1)' },
            { word: '火星任务新进展', index: 1, hotScore: '700' },
            { word: '', index: 2, hotScore: '600' },
          ],
        },
      ],
    },
  })}-->`
  it('keeps successful hotspots when news sources fail, without renewing cached article time', async () => {
    const previous = await aggregateFeeds([source], null, async () => xml, now)
    const result = await collectBatch(
      [source],
      previous,
      async () => {
        throw new Error('offline')
      },
      async () => html,
      new Date('2026-09-18T10:00:00Z'),
    )
    expect(result.hotspots?.items).toHaveLength(1)
    expect(result.sources?.[0].status).toBe('cached')
    expect(result.items[0].fetchedAt).toBe(now.toISOString())
    expect(result.generatedAt).toBe(previous.generatedAt)
    await expect(
      collectBatch(
        [source],
        previous,
        async () => {
          throw new Error('offline')
        },
        async () => {
          throw new Error('offline')
        },
        now,
      ),
    ).rejects.toThrow()
  })
  it('preserves platform ranking, removes duplicate topics and builds safe search links', () => {
    const items = parseBaiduHotspots(html, now)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      platform: 'baidu',
      rank: 1,
      title: '火星任务新进展',
      heat: '800',
      observedAt: now.toISOString(),
    })
    expect(items[0].url).toBe('https://www.baidu.com/s?wd=' + encodeURIComponent('火星任务新进展'))
    expect(items[0]).not.toHaveProperty('publishedAt')
    expect(items[0]).not.toHaveProperty('location')
  })
  it('rejects a changed page and API business errors instead of accepting an empty success', () => {
    expect(() => parseBaiduHotspots('<html>登录</html>', now)).toThrow()
    expect(() => parseWeiboHotspots(JSON.stringify({ code: 230, msg: 'bad key' }), now)).toThrow()
    expect(
      parseWeiboHotspots(
        JSON.stringify({
          code: 200,
          result: { list: [{ hotword: '官方通报', hotwordnum: '100万', hottag: '新' }] },
        }),
        now,
      )[0],
    ).toMatchObject({ platform: 'weibo', rank: 1, heat: '100万' })
  })
  it('retains fresh cached topics on failure without renewing their observation time', async () => {
    const previous = { items: parseBaiduHotspots(html, now), sources: [] }
    const result = await collectHotspots(previous, {
      now: new Date('2026-09-18T10:00:00Z'),
      weiboKey: '',
      fetcher: async () => {
        throw new Error('offline')
      },
    })
    expect(result.items[0].observedAt).toBe(now.toISOString())
    expect(result.sources.find((s) => s.id === 'baidu')?.status).toBe('cached')
    expect(result.sources.find((s) => s.id === 'weibo')?.status).toBe('not-configured')
    const expired = await collectHotspots(previous, {
      now: new Date('2026-09-20T10:00:00Z'),
      weiboKey: '',
      fetcher: async () => {
        throw new Error('offline')
      },
    })
    expect(expired.items).toEqual([])
  })
})
