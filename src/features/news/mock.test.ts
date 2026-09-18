import { expect, it, vi } from 'vitest'
import { createMockFeed } from './mock'
import { NewsFeedSchema, NewsItemSchema } from './model'
import { filterNews } from './query'
import { createNewsProvider } from './provider'

it('provides independent, geographically varied demo content for all three channels', () => {
  const now = Date.now()
  const feed = NewsFeedSchema.parse(createMockFeed(now))
  for (const category of ['全部', 'AI', '科技'] as const) {
    const items = filterNews(feed.items, { category, search: '', hours: 168 }, now)
    expect(items.length).toBeGreaterThanOrEqual(5)
    expect(new Set(items.map((item) => item.location?.name)).size).toBeGreaterThanOrEqual(5)
    expect(
      items.every((item) => item.channel === (category === '全部' ? '全球视野' : category)),
    ).toBe(true)
    expect(items.some((item) => item.imageUrl?.startsWith('/demo/'))).toBe(true)
    expect(items.some((item) => !item.imageUrl)).toBe(true)
    expect(items.some((item) => item.brief?.sections.length)).toBe(true)
  }
  expect(feed.items.every((item) => item.isDemo && !item.sourceUrl)).toBe(true)
})

it('loads demo data without any network request, even when fetch is unavailable', async () => {
  const fetcher = vi.fn(() => {
    throw new Error('network disabled')
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    expect((await createNewsProvider('mock').load()).mode).toBe('demo')
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('allows bundled illustrations but rejects arbitrary local and executable image addresses', () => {
  const item = createMockFeed().items[0]
  expect(NewsItemSchema.safeParse({ ...item, imageUrl: '/demo/world.svg' }).success).toBe(true)
  for (const imageUrl of [
    '//evil.test/a.svg',
    '/demo/../secret',
    '/api/news',
    'javascript:alert(1)',
    'data:text/html,x',
  ]) {
    expect(NewsItemSchema.safeParse({ ...item, imageUrl }).success).toBe(false)
  }
})
