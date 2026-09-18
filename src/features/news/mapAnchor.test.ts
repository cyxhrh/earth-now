import { expect, it } from 'vitest'
import { getMapAnchor } from './mapAnchor'
import { groupRegions } from '../globe/markerLayout'
import type { NewsItem } from './model'

const article = (changes: Partial<NewsItem> = {}): NewsItem => ({
  id: 'test',
  title: 'OpenAI releases a model',
  summary: 'News summary',
  category: 'AI',
  channel: 'AI',
  location: null,
  sourceName: 'News',
  publishedAt: '2026-09-18T00:00:00Z',
  heat: 10,
  sourceCount: 1,
  isDemo: false,
  ...changes,
})

it('preserves reported event coordinates instead of relocating the story to a company', () => {
  const location = { name: '巴黎', lat: 48.85, lng: 2.35, precision: 'city' as const }
  expect(getMapAnchor(article({ location }))).toMatchObject({ kind: 'reported', location })
})

it('labels an organization association without changing the news location', () => {
  const item = article({ title: 'MiniMax 发布新模型' })
  expect(getMapAnchor(item)).toMatchObject({
    kind: 'organization',
    organization: 'MiniMax',
    location: { name: '上海，中国' },
  })
  expect(getMapAnchor(item)?.basis).toContain('不代表报道的事件发生地')
  expect(item.location).toBeNull()
})

it('does not invent map anchors for generic, competing-company or world stories', () => {
  for (const item of [
    article({ title: 'AI 行业发展' }),
    article({ title: 'OpenAI 与 DeepSeek 对比' }),
    article({ channel: '全球视野' }),
  ]) {
    expect(getMapAnchor(item)).toBeNull()
    expect(groupRegions([item], true)).toEqual([])
  }
})

it('uses original headlines and explicit official publishers, not summary mentions', () => {
  expect(
    getMapAnchor(
      article({
        title: '新模型发布',
        original: { title: 'DeepSeek releases a model', summary: '' },
      }),
    )?.organization,
  ).toBe('DeepSeek')
  expect(getMapAnchor(article({ title: '我们的最新进展', sourceId: 'openai' }))?.organization).toBe(
    'OpenAI',
  )
  expect(
    getMapAnchor(
      article({ title: '新模型发布', summary: 'OpenAI and MiniMax', focusTags: ['OpenAI'] }),
    ),
  ).toBeNull()
})

it('separates organization and event anchors even when they share a city', () => {
  const org = article()
  const event = article({ id: 'event', location: getMapAnchor(org)!.location })
  const groups = groupRegions([org, event], true)
  expect(groups).toHaveLength(2)
  expect(groups.map((group) => group.anchor.kind)).toEqual(['organization', 'reported'])
  expect(
    groups.every((group) => group.location.lat === 37.77 && group.location.lng === -122.42),
  ).toBe(true)
})

it('maps official Apple technology releases to a labeled organization, not an invented venue', () => {
  expect(
    getMapAnchor(
      article({
        channel: '科技',
        category: '科技',
        sourceId: 'apple-newsroom',
        title: 'New safety features are available',
      }),
    ),
  ).toMatchObject({
    kind: 'organization',
    organization: 'Apple',
    location: { name: '库比蒂诺，加利福尼亚州，美国' },
  })
  expect(
    getMapAnchor(article({ channel: '科技', title: 'QQ 音乐官宣适配苹果 iPhone Duo 折叠屏手机' })),
  ).toBeNull()
  expect(
    getMapAnchor(
      article({ channel: '科技', title: 'Microsoft releases a Windows security update' }),
    )?.organization,
  ).toBe('Microsoft')
})
