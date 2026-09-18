import { describe, expect, it } from 'vitest'
import { parseArchivePage, selectArchiveStories, fetchArchiveRss } from './archive'

const day = '2026-09-18'
const row = (title: string, path = '/gj/2026/09-18/123.shtml', time = '9-18 12:30') =>
  `<li><div class="dd_lm">[国际]</div><div class="dd_bt"><a href="${path}">${title}</a></div><div class="dd_time">${time}</div></li>`

describe('regional archive supplement', () => {
  it('keeps a few bilateral candidates for article-level location evidence without assigning a country', () => {
    const items = parseArchivePage(row('从机器人到光伏储能 中澳经贸合作向新向绿'), day)
    expect(selectArchiveStories(items)).toHaveLength(1)
  })
  it('preserves real source links and Beijing publication time, rejects invalid rows', () => {
    const parsed = parseArchivePage(
      row('悉尼举行文化活动') +
        row('bad', 'https://evil.test/123.shtml') +
        row('bad date', '/gj/2026/09-17/123.shtml') +
        row('bad time', undefined, '9-18 25:99'),
      day,
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      title: '悉尼举行文化活动',
      publishedAt: '2026-09-18T04:30:00.000Z',
      url: 'https://www.chinanews.com.cn/gj/2026/09-18/123.shtml',
    })
  })
  it('takes distinct regions in turns so a busy country does not consume the whole supplement', () => {
    const items = parseArchivePage(
      Array.from({ length: 8 }, (_, i) => row(`美国新闻${i}`, `/gj/2026/09-18/${i}.shtml`)).join(
        '',
      ) +
        row('悉尼举行文化活动', '/gj/2026/09-18/30.shtml') +
        row('北京新闻', '/gj/2026/09-18/31.shtml'),
      day,
    )
    const selected = selectArchiveStories(items, 2)
    expect(selected).toHaveLength(2)
    expect(selected.some((item) => item.title.includes('悉尼'))).toBe(true)
    expect(selected.some((item) => item.title.includes('北京'))).toBe(false)
  })
  it('fetches the current seven Beijing dates and fails rather than silently accepting incomplete coverage', async () => {
    const urls: string[] = []
    const xml = await fetchArchiveRss(new Date('2026-09-17T18:00:00Z'), async (url) => {
      urls.push(url)
      return url.includes('/0918/') ? row('悉尼举行文化活动', undefined, '9-18 01:00') : '<li></li>'
    })
    expect(urls).toHaveLength(7)
    expect(urls[0]).toContain('/2026/0918/')
    expect(urls.at(-1)).toContain('/2026/0912/')
    expect(xml).toContain('悉尼举行文化活动')
    await expect(
      fetchArchiveRss(new Date(), async () => {
        throw Error('offline')
      }),
    ).rejects.toThrow('offline')
  })
  it('retries a transient page timeout once without dropping that day', async () => {
    let calls = 0
    const xml = await fetchArchiveRss(new Date('2026-09-18T09:00:00Z'), async (url) => {
      if (url.includes('/0918/')) {
        calls++
        if (calls === 1) throw new DOMException('timeout', 'TimeoutError')
        return row('悉尼举行文化活动')
      }
      return '<li></li>'
    })
    expect(calls).toBe(2)
    expect(xml).toContain('悉尼举行文化活动')
  })
})
