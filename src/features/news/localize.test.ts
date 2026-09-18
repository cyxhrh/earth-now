import { describe, expect, it } from 'vitest'
import { localizeNews } from './localize'
import { filterNews } from './query'
import { groupNewsEvents } from './events'
import type { NewsItem } from './model'

const item: NewsItem = {
  id: 'en',
  title: 'Scientists report new results',
  summary: 'A study reports 12 findings.',
  language: 'en',
  category: '科技',
  publishedAt: '2026-09-18T00:00:00Z',
  sourceName: 'Example',
  location: null,
  heat: 0,
  sourceCount: 1,
  isDemo: false,
  translation: {
    title: '科学家公布新成果',
    summary: '一项研究报告了 12 项发现。',
    language: 'zh-CN',
    provider: 'deepseek',
    translatedAt: '2026-09-18T00:00:00Z',
  },
}
const filter = { category: '全部' as const, search: '', hours: 168 as const }
const now = Date.parse('2026-09-18T12:00:00Z')
describe('Chinese reading', () => {
  it('displays Chinese without overwriting original text and remains idempotent', () => {
    const display = localizeNews(item)
    expect(display.title).toBe('科学家公布新成果')
    expect(display.original?.summary).toBe(item.summary)
    expect(item.title).toBe('Scientists report new results')
    expect(localizeNews(display)).toBe(display)
  })
  it('searches both languages and only shows untranslated English after opting in', () => {
    const items = [localizeNews(item), { ...item, id: 'pending', translation: undefined }]
    for (const search of ['科学家', 'Scientists'])
      expect(filterNews(items, { ...filter, search }, now)).toHaveLength(1)
    expect(filterNews(items, filter, now)).toHaveLength(1)
    expect(filterNews(items, { ...filter, includeUntranslated: true }, now)).toHaveLength(2)
  })
  it('groups by original headline to avoid merging distinct stories with similar translations', () => {
    const other = localizeNews({ ...item, id: 'other', title: 'A different study reports results' })
    expect(groupNewsEvents([localizeNews(item), other])).toHaveLength(2)
  })
})
