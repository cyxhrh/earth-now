import { describe, expect, it } from 'vitest'
import { classifyArticle, scopeNews } from './editorial'
import { filterNews } from '../src/features/news/query'
import type { NewsItem } from '../src/features/news/model'

const item = (title: string): NewsItem => ({
  id: title,
  title,
  summary: '来源摘要',
  category: '科技',
  publishedAt: '2026-09-18T10:00:00Z',
  sourceName: '测试',
  sourceUrl: 'https://www.ithome.com/1',
  location: null,
  heat: 0,
  sourceCount: 1,
  isDemo: false,
  language: 'zh',
})
describe('focused edition', () => {
  it('routes AI, robots and phones without confusing Apple with fruit or AI with substrings', () => {
    expect(classifyArticle(item('DeepSeek 发布新推理模型'))?.channel).toBe('AI')
    expect(classifyArticle(item('宇树科技发布新款人形机器人'))?.channel).toBe('科技')
    expect(classifyArticle(item('华为发布新手机'))?.channel).toBe('科技')
    expect(classifyArticle(item('OpenAI announces new tools'))?.focusTags).toContain('OpenAI')
    expect(classifyArticle(item('苹果丰收采摘活动'))).toBeNull()
    expect(classifyArticle(item('Railway announces services'))).toBeNull()
  })
  it('excludes promotions, ordinary activities and celebrity gossip; admits major world events', () => {
    for (const title of [
      '小米手机领券到手价创新低',
      '马斯克新恋情曝光',
      '宁夏农产品展销活动在厦门启动',
      '外交部发言人主持例行记者会',
      '国家邮政局快递收入突破万亿元',
      '医药工业发展规划推动药品研发',
      '警方查获诈骗手机卡',
    ])
      expect(classifyArticle(item(title))).toBeNull()
    expect(classifyArticle(item('双方达成停火协议'))?.channel).toBe('全球视野')
    expect(classifyArticle(item('智利发生强烈地震'))?.channel).toBe('全球视野')
  })
  it('global view contains world events only, and brands are searchable', () => {
    const items = scopeNews(
      ['双方达成停火协议', 'DeepSeek 发布新模型', '宇树科技发布机器人'].map(item),
    )
    const now = Date.parse('2026-09-18T11:00:00Z')
    expect(
      filterNews(items, { category: '全部', search: '', hours: 24 }, now).map((i) => i.channel),
    ).toEqual(['全球视野'])
    expect(filterNews(items, { category: 'AI', search: 'DeepSeek', hours: 24 }, now)).toHaveLength(
      1,
    )
    expect(filterNews(items, { category: '科技', search: '宇树', hours: 24 }, now)).toHaveLength(1)
  })
})
