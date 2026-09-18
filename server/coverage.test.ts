import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { coverageCounts, coverageRegion } from './coverage'
import { NewsDatabase } from './database'
import { classifyArticle, rankCandidates } from './editorial'
import { locateArticle } from './location'
import type { NewsItem } from '../src/features/news/model'

const now = new Date('2026-09-18T12:00:00Z')
const news = (id: string, country: string): NewsItem => ({
  id,
  title: `${country}发生严重干旱`,
  summary: '最新报道摘要',
  category: '自然',
  channel: '全球视野',
  publishedAt: now.toISOString(),
  sourceName: '测试',
  sourceUrl: `https://example.com/${id}`,
  location: locateArticle(country).location,
  heat: 0,
  sourceCount: 1,
  isDemo: false,
})

describe('world coverage', () => {
  it('identifies editorial regions without inventing unknown event coordinates', () => {
    for (const [country, region] of [
      ['巴西', '南美'],
      ['加拿大', '北美'],
      ['刚果民主共和国', '非洲'],
      ['澳大利亚', '大洋洲'],
      ['新西兰', '大洋洲'],
      ['法国', '欧洲'],
      ['日本', '亚洲'],
      ['伊朗', '中东'],
    ])
      expect(coverageRegion(locateArticle(country).location)).toBe(region)
    expect(coverageRegion(null)).toBeUndefined()
  })
  it('admits public-impact news but rejects lifestyle, sport and identified commentary', () => {
    for (const title of [
      'Drone footage shows severe drought hitting river in Brazil – video',
      'Ebola outbreak in DRC has peaked',
      'Australia announces immigration changes',
      'Colombian ex-foreign minister charged over corruption',
    ])
      expect(classifyArticle({ ...news(title, '巴西'), title })?.channel).toBe('全球视野')
    expect(
      classifyArticle({
        ...news('review', '巴西'),
        title: 'Night of the Coyotes review – tourist attraction in Mexican town',
      }),
    ).toBeNull()
    expect(
      classifyArticle({ ...news('opinion', '巴西'), provenance: { kind: 'commentary' } }),
    ).toBeNull()
    expect(locateArticle('Ebola outbreak in DRC has peaked').location?.name).toBe('刚果民主共和国')
  })
  it('gives missing regions a turn before an already abundant region', () => {
    const previous = Array.from({ length: 8 }, (_, i) => news('old' + i, '日本'))
    const input = [
      ...Array.from({ length: 12 }, (_, i) => news('asia' + i, '日本')),
      news('south', '巴西'),
      news('africa', '尼日利亚'),
    ]
    expect(
      rankCandidates(input, previous)
        .slice(0, 2)
        .map((i) => i.id)
        .sort(),
    ).toEqual(['africa', 'south'])
  })
  it('reserves daily slots for late arriving regions across collection batches and restarts', async () => {
    const sql = new PGlite()
    try {
      const db = new NewsDatabase(sql)
      await db.init()
      await db.ingest(
        Array.from({ length: 20 }, (_, i) => news('asia' + i, '日本')),
        now,
      )
      expect((await db.recent(now)).length).toBeLessThan(15)
      const restarted = new NewsDatabase(sql)
      const countries = ['巴西', '尼日利亚', '澳大利亚', '加拿大', '法国', '伊朗']
      await restarted.ingest(
        countries.flatMap((country, i) => [news('a' + i, country), news('b' + i, country)]),
        now,
      )
      const counts = coverageCounts(await restarted.recent(now))
      expect(Object.values(counts).every((count) => count >= 2)).toBe(true)
      expect((await restarted.recent(now)).length).toBeLessThanOrEqual(15)
      expect(
        (
          await restarted.ingest(
            countries.map((country, i) => news('a' + i, country)),
            now,
          )
        ).added,
      ).toBe(0)
    } finally {
      await sql.close()
    }
  }, 20000)
})
