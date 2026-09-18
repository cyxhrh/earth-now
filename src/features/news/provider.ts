import { NewsFeedSchema, type NewsFeed } from './model'
import { createMockFeed } from './mock'
import { httpProvider } from './http-provider'

export interface NewsProvider {
  load(signal?: AbortSignal): Promise<NewsFeed>
}
const mockProvider: NewsProvider = {
  async load(signal) {
    signal?.throwIfAborted()
    const feed = NewsFeedSchema.parse(createMockFeed())
    signal?.throwIfAborted()
    return feed
  },
}

export function createNewsProvider(
  mode = import.meta.env.VITE_NEWS_PROVIDER || 'api',
): NewsProvider {
  if (mode === 'mock') return mockProvider
  if (mode === 'api') return httpProvider
  throw new Error('VITE_NEWS_PROVIDER 仅支持 api 或 mock。')
}
