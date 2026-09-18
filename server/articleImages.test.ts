import { describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { articleImage, enrichArticleImages } from './articleImages'
import { sources } from './sources'
import { NewsDatabase } from './database'
import type { NewsItem } from '../src/features/news/model'

const source = sources.find((source) => source.id === 'ithome')!
const url = 'https://www.ithome.com/0/123/456.htm'
describe('independent article images', () => {
  it('uses body or article metadata, excluding unrelated or unsafe images', () => {
    expect(articleImage('<meta property="og:image" content="">', source, url)).toBeUndefined()
    expect(
      articleImage(
        '<div id="paragraph"><img src="https://img.ithome.com/news.jpg"></div><aside><img src="https://img.ithome.com/other.jpg"></aside>',
        source,
        url,
      ),
    ).toContain('/news.jpg')
    expect(
      articleImage(
        '<meta property="og:image" content="https://img.ithome.com/cover.jpg">',
        source,
        url,
      ),
    ).toContain('/cover.jpg')
    expect(
      articleImage(
        '<meta property="og:image" content="https://evil.example/image.jpg"><aside><img src="https://img.ithome.com/other.jpg"></aside>',
        source,
        url,
      ),
    ).toBeUndefined()
    expect(
      articleImage(
        '<meta property="og:image" content="https://img.ithome.com/logo.png">',
        source,
        url,
      ),
    ).toBeUndefined()
  })
  it('persists images without AI calls, caches misses, and retries after one day', async () => {
    const sql = new PGlite()
    try {
      const db = new NewsDatabase(sql)
      await db.init()
      const now = new Date('2026-09-18T12:00:00Z')
      const item: NewsItem = {
        id: 'image',
        title: 'DeepSeek 发布模型',
        summary: '报道摘要',
        category: 'AI',
        channel: 'AI',
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: url,
        publishedAt: now.toISOString(),
        location: null,
        heat: 0,
        sourceCount: 1,
        isDemo: false,
      }
      await db.ingest([item], now)
      const read = vi.fn().mockResolvedValue('<article>no image</article>')
      expect(await enrichArticleImages(db, [item], now, read)).toBe(0)
      await enrichArticleImages(db, [item], now, read)
      expect(read).toHaveBeenCalledTimes(1)
      read.mockResolvedValue(
        '<div id="paragraph"><img src="https://img.ithome.com/news.jpg"></div>',
      )
      expect(await enrichArticleImages(db, [item], new Date(now.getTime() + 86400_001), read)).toBe(
        1,
      )
      expect((await db.recent(now))[0].imageUrl).toBe('https://img.ithome.com/news.jpg')
      expect((await sql.query('SELECT * FROM daily_usage')).rows).toHaveLength(0)
    } finally {
      await sql.close()
    }
  }, 20000)
})
