import { describe, expect, it } from 'vitest'
import type { Hotspot, NewsItem } from './model'
import { rankNewsForCards } from './cardRanking'
import { groupRegions } from '../globe/markerLayout'

const now = Date.parse('2026-09-18T10:00:00Z')
const article: NewsItem = {
  id: 'base',
  title: '空间站完成新一轮科学实验',
  summary: '报道',
  category: '科技',
  publishedAt: '2026-09-18T09:00:00Z',
  sourceName: '官方发布',
  heat: 0,
  sourceCount: 1,
  isDemo: false,
  imageUrl: 'https://example.com/photo.jpg',
  location: { name: '北京', lat: 39.9, lng: 116.4, precision: 'city' },
}
const topic: Hotspot = {
  id: 'topic',
  platform: 'baidu',
  title: article.title,
  rank: 2,
  heat: '8000000',
  url: 'https://top.baidu.com/board',
  observedAt: '2026-09-18T09:30:00Z',
}
const ids = (items: NewsItem[]) => items.map((item) => item.id)

describe('news card selection', () => {
  it('prioritizes pictures, then matched platform rank, then recency without mutating the feed', () => {
    const input = [
      { ...article, id: 'text', imageUrl: undefined },
      { ...article, id: 'latest', title: '全新报道', publishedAt: '2026-09-18T09:50:00Z' },
      { ...article, id: 'hot', publishedAt: '2026-09-18T08:00:00Z' },
      { ...article, id: 'hottest', title: '新型运载火箭成功完成首飞' },
    ]
    const ranked = rankNewsForCards(
      input,
      [topic, { ...topic, title: input[3].title, rank: 1 }],
      now,
    )
    expect(ids(ranked)).toEqual(['hottest', 'hot', 'latest', 'text'])
    expect(ids(input)).toEqual(['text', 'latest', 'hot', 'hottest'])
    expect(ids(groupRegions(ranked)[0].items)).toEqual(ids(ranked))
  })

  it('uses time when evidence is expired, in the future or only shares a keyword', () => {
    const input = [
      { ...article, id: 'older', heat: 99 },
      { ...article, id: 'newer', title: '更新的新闻', publishedAt: '2026-09-18T09:50:00Z' },
    ]
    for (const evidence of [
      { ...topic, observedAt: '2026-09-17T09:59:59Z' },
      { ...topic, observedAt: '2026-09-18T10:01:00Z' },
      { ...topic, title: '空间站' },
      { ...topic, title: `辟谣：${article.title}` },
    ])
      expect(ids(rankNewsForCards(input, [evidence], now))).toEqual(['newer', 'older'])
  })

  it('matches punctuation variants but does not conflate materially different headlines', () => {
    const input = [
      { ...article, id: 'other', title: '最新新闻', publishedAt: '2026-09-18T09:50:00Z' },
      { ...article, id: 'matched', title: `“${article.title}！”` },
    ]
    expect(ids(rankNewsForCards(input, [topic], now))).toEqual(['matched', 'other'])
  })

  it('replaces failed image candidates while keeping text news accessible', () => {
    const input = [
      article,
      { ...article, id: 'backup', title: '其他新闻', imageUrl: 'https://example.com/backup.jpg' },
    ]
    const ranked = rankNewsForCards(input, [topic], now, new Set([article.imageUrl!]))
    expect(ids(ranked)).toEqual(['backup', 'base'])
    expect(ranked[1].imageUrl).toBeUndefined()
    expect(input[0].imageUrl).toBe(article.imageUrl)
    expect(rankNewsForCards([], [], now)).toEqual([])
  })

  it('preserves numerical punctuation and questions when matching heat evidence', () => {
    for (const [headline, trending] of [
      ['出口增长1.5%', '出口增长15%'],
      ['出口增长15%？', '出口增长15%'],
      ['比分1-5', '比分15'],
    ]) {
      const input = [
        { ...article, id: 'older', title: headline },
        { ...article, id: 'newer', title: '其他新闻', publishedAt: '2026-09-18T09:50:00Z' },
      ]
      expect(ids(rankNewsForCards(input, [{ ...topic, title: trending, rank: 1 }], now))).toEqual([
        'newer',
        'older',
      ])
    }
  })
})
