import { describe, expect, it } from 'vitest'
import { articleImage } from './images'
import { normalizeFeed } from './news'
import { overseasSources as sources } from './sources'

describe('article images', () => {
  it('extracts a BBC RSS thumbnail through the full parser', async () => {
    const xml = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
      <item><title>Canada news</title><link>https://www.bbc.com/news/a</link>
      <pubDate>Wed, 16 Sep 2026 10:00:00 GMT</pubDate>
      <media:thumbnail url="https://ichef.bbci.co.uk/news/photo.jpg" /></item></channel></rss>`
    const items = await normalizeFeed(xml, sources[1], new Date('2026-09-16T12:00:00Z'))
    expect(items[0].imageUrl).toBe('https://ichef.bbci.co.uk/news/photo.jpg')
  })
  it('supports UN image enclosures and NASA encoded content images', () => {
    expect(
      articleImage(
        {
          enclosure: {
            url: 'https://global.unitednations.entermediadb.net/a.jpg',
            type: 'image/jpeg',
          },
        },
        sources[0],
      ),
    ).toBe('https://global.unitednations.entermediadb.net/a.jpg')
    expect(
      articleImage(
        { 'content:encoded': '<img src="https://science.nasa.gov/a.jpg?w=600&amp;h=400" />' },
        sources[3],
      ),
    ).toBe('https://science.nasa.gov/a.jpg?w=600&h=400')
  })
  it('skips unsafe, unrelated and video URLs and leaves articles without images intact', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://ichef.bbci.co.uk/a.jpg',
      'https://evil.example/a.jpg',
      'https://ichef.bbci.co.uk.evil.example/a.jpg',
      'https://user:pass@ichef.bbci.co.uk/a.jpg',
    ]) {
      expect(articleImage({ thumbnails: [{ $: { url } }] }, sources[1])).toBeUndefined()
    }
    expect(
      articleImage(
        { media: [{ $: { url: 'https://ichef.bbci.co.uk/a.mp4', medium: 'video' } }] },
        sources[1],
      ),
    ).toBeUndefined()
    expect(articleImage({}, sources[1])).toBeUndefined()
  })
})
