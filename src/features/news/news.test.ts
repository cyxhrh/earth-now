import { describe, expect, it } from 'vitest'
import { NewsFeedSchema, type NewsItem } from './model'
import { filterNews } from './query'

const now = Date.parse('2026-09-16T12:00:00Z')
const article: NewsItem = {
  id: 'example',
  title: '东京城市观测示例',
  summary: '前端演示内容',
  category: '科技',
  publishedAt: '2026-09-16T10:00:00Z',
  sourceName: '演示编辑部',
  location: { name: '东京', lat: 35.68, lng: 139.69, precision: 'city' },
  heat: 80,
  sourceCount: 2,
  isDemo: true,
}

describe('news filtering', () => {
  it('keeps official releases distinct from reprints and opinion, and searches the stated publisher', () => {
    const items: NewsItem[] = [
      { ...article, id: 'official', provenance: { kind: 'official', publisher: '外交部' } },
      { ...article, id: 'reprint', provenance: { kind: 'reprint', publisher: '央视新闻客户端' } },
      { ...article, id: 'opinion', provenance: { kind: 'commentary', publisher: '人民日报' } },
    ]
    expect(
      filterNews(items, { category: '全部', search: '', hours: 24, officialOnly: true }, now).map(
        (i) => i.id,
      ),
    ).toEqual(['official'])
    expect(
      filterNews(items, { category: '全部', search: '央视', hours: 24 }, now).map((i) => i.id),
    ).toEqual(['reprint'])
    expect(
      filterNews(items, { category: '全部', search: '', hours: 24 }, now).map((i) => i.id),
    ).toEqual(['official', 'reprint'])
  })
  it('combines category, location search and time instead of resetting other filters', () => {
    const items = [article, { ...article, id: 'other', category: '自然' as const }]
    expect(
      filterNews(items, { category: '科技', search: '东京', hours: 24 }, now).map((x) => x.id),
    ).toEqual(['example'])
    expect(filterNews(items, { category: '科技', search: '伦敦', hours: 24 }, now)).toEqual([])
  })
  it('excludes future and expired stories and includes the exact boundary', () => {
    const items = [
      article,
      { ...article, id: 'future', publishedAt: '2026-09-17T00:00:00Z' },
      { ...article, id: 'old', publishedAt: '2026-09-14T00:00:00Z' },
      { ...article, id: 'boundary', publishedAt: '2026-09-15T12:00:00Z' },
    ]
    expect(
      filterNews(items, { category: '全部', search: '', hours: 24 }, now).map((x) => x.id),
    ).toEqual(['example', 'boundary'])
  })
  it('keeps unlocated stories readable', () => {
    expect(
      filterNews(
        [{ ...article, location: null }],
        { category: '全部', search: '观测', hours: 24 },
        now,
      ),
    ).toHaveLength(1)
  })
})

describe('news feed contract', () => {
  const feed = { items: [article], generatedAt: '2026-09-16T12:00:00Z', mode: 'demo' }
  it('accepts a feed with an explicitly unlocated story', () => {
    expect(
      NewsFeedSchema.safeParse({ ...feed, items: [{ ...article, location: null }] }).success,
    ).toBe(true)
  })
  it('rejects dangerous links and impossible coordinates at the data boundary', () => {
    expect(
      NewsFeedSchema.safeParse({
        ...feed,
        items: [{ ...article, sourceUrl: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false)
    expect(
      NewsFeedSchema.safeParse({
        ...feed,
        items: [{ ...article, location: { ...article.location, lat: 95 } }],
      }).success,
    ).toBe(false)
  })
})
