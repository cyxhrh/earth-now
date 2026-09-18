import { expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { NewsDatabase } from './database'
import { editionCoverageCounts } from './coverage'
import { locateTechnologyArticle } from './location'
import { classifyArticle, dailyLimits, scopeNews } from './editorial'
import { normalizeFeed } from './news'
import { sources } from './sources'
import { readSnapshot } from './store'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { articleImage } from './articleImages'
import type { NewsItem } from '../src/features/news/model'

const now = new Date('2026-09-18T12:00:00Z')
const item = (id: string, country: string, channel: 'AI' | '科技'): NewsItem => ({
  id,
  title: `${country} ${channel === 'AI' ? 'AI model launch' : 'robot launch'}`,
  summary: 'News',
  category: channel,
  channel,
  sourceName: 'Test',
  sourceUrl: `https://example.com/${id}`,
  publishedAt: now.toISOString(),
  location: locateTechnologyArticle(country).location,
  heat: 0,
  sourceCount: 1,
  isDemo: false,
})

it.each(['AI', '科技'] as const)(
  'reserves %s slots for other regions across batches without increasing the daily cap',
  async (channel) => {
    const sql = new PGlite()
    try {
      const db = new NewsDatabase(sql)
      await db.init()
      await db.ingest(
        Array.from({ length: dailyLimits[channel] + 10 }, (_, i) =>
          item('cn' + i, '中国', channel),
        ),
        now,
      )
      const next = new NewsDatabase(sql)
      await next.ingest(
        ['法国', '巴西', '尼日利亚', '澳大利亚', '日本', '加拿大', '美国', '沙特阿拉伯'].map(
          (country, i) => item('other' + i, country, channel),
        ),
        now,
      )
      const recent = await next.recent(now)
      const counts = editionCoverageCounts(recent)[channel]
      expect(Object.values(counts).every((count) => count >= 1)).toBe(true)
      expect(recent.length).toBe(dailyLimits[channel])
      expect((await next.ingest(recent, now)).added).toBe(0)
    } finally {
      await sql.close()
    }
  },
  20000,
)

it('uses explicit company country but never investor nationality or currency as an event location', () => {
  expect(
    locateTechnologyArticle(
      'AI model released',
      'Finnish technology company develops AI solutions.',
    ).location?.name,
  ).toBe('芬兰')
  expect(
    locateTechnologyArticle(
      'Funding announced',
      'Brazilian fintech A5X raised funds led by American investors.',
    ).location?.name,
  ).toBe('巴西')
  expect(
    locateTechnologyArticle('AI model released', 'Founded by Colombian entrepreneurs.').location,
  ).toBeNull()
  expect(
    locateTechnologyArticle('Funding announced', 'Investors from Germany supported the company.')
      .location,
  ).toBeNull()
  expect(locateTechnologyArticle('Company spends US$12,000 on AI').location).toBeNull()
  expect(locateTechnologyArticle('U.S.-China AI contest').location).toBeNull()
})

it('admits regional cloud and connectivity developments, but not opinion or sponsored roundups', () => {
  for (const title of [
    'Australia considers banning smart glasses',
    'South Africa data centers face resistance',
    'Nigeria begins 5G spectrum transfer',
    'Digital Canberra to refresh private cloud platform',
  ]) {
    expect(classifyArticle({ ...item(title, '', '科技'), title })?.channel).toBe('科技')
  }
  expect(
    classifyArticle({ ...item('sponsor', '', '科技'), title: 'Sponsored: new cloud software' }),
  ).toBeNull()
})

it('accepts inert HTML doctypes in RSS CDATA but blocks actual XML entity declarations', async () => {
  const xml =
    '<rss version="2.0"><channel><title>Tech</title><item><title>Nigeria launches satellites</title><link>https://techcabal.com/news/1</link><pubDate>Fri, 18 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<!DOCTYPE html><p>Details</p>]]></description></item></channel></rss>'
  const source = sources.find((source) => source.id === 'techcabal')!
  expect(await normalizeFeed(xml, source, now)).toHaveLength(1)
  await expect(
    normalizeFeed('<!DOCTYPE rss [<!ENTITY test "bad">]>' + xml, source, now),
  ).rejects.toThrow()
})

it('keeps technology summary locations when the web API rereads a snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earth-focused-'))
  try {
    await writeFile(
      join(directory, 'news.json'),
      JSON.stringify({
        mode: 'live',
        generatedAt: now.toISOString(),
        items: [
          {
            ...item('eu', '', 'AI'),
            title: 'Integral raises funds for AI accounting',
            summary: 'Berlin-based accounting technology company expands its services.',
          },
        ],
      }),
    )
    expect((await readSnapshot(directory))?.items[0].location?.name).toBe('柏林，德国')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('uses the article photo rather than publisher follow badges', () => {
  const source = sources.find((source) => source.id === 'itnews-au')!
  expect(
    articleImage(
      '<article><img src="/images/Follow Google News.png"><div id="article-body"><img src="https://i.nextmedia.com.au/News/anthropic.jpg"></div></article>',
      source,
      'https://www.itnews.com.au/news/1',
    ),
  ).toBe('https://i.nextmedia.com.au/News/anthropic.jpg')
})

it('retains US technology developments without turning event promotions into news', () => {
  for (const title of [
    'Waymo restarts San Antonio service after flooding troubles',
    'Apple’s new child safety features now available',
  ]) {
    expect(classifyArticle({ ...item(title, '', '科技'), title })?.channel).toBe('科技')
  }
  expect(
    classifyArticle({
      ...item('promo', '', '科技'),
      title: 'Open or closed AI? Nvidia speakers at TechCrunch Disrupt 2026',
    }),
  ).toBeNull()
})

it('does not let Mexico or Canada alone satisfy US technology coverage', () => {
  const counts = editionCoverageCounts([item('mx', '墨西哥', '科技'), item('ca', '加拿大', '科技')])
  expect(counts.科技['美国']).toBe(0)
  expect(counts.科技['北美其他']).toBe(2)
})

it('keeps summary-classified AI releases in the same channel on repeated publication', () => {
  const input = {
    ...item('software', '', '科技'),
    title: 'Major updates for Apple’s software platforms are now available',
    summary: 'Apple introduces Siri AI with new capabilities.',
  }
  const once = scopeNews([input])
  expect(once[0].channel).toBe('AI')
  expect(scopeNews(once)[0].channel).toBe('AI')
})
