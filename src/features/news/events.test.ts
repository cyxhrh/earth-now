import { describe, expect, it } from 'vitest'
import { groupNewsEvents } from './events'
import { filterNews } from './query'
import type { NewsItem } from './model'

const report: NewsItem = {
  id: 'original',
  title: '外交部：中美双方就年内元首互动安排保持着沟通',
  summary: '摘要',
  publishedAt: '2026-09-18T08:00:00Z',
  category: '社会',
  sourceName: '中国新闻网',
  sourceUrl: 'https://example.com/original',
  location: null,
  heat: 50,
  sourceCount: 1,
  isDemo: false,
}
describe('event grouping', () => {
  it('merges duplicate headlines while preserving every report and original link', () => {
    const reprint = {
      ...report,
      id: 'reprint',
      title: report.title.replace('：', ': '),
      sourceUrl: 'https://example.com/reprint',
      sourceName: '转载媒体',
      publishedAt: '2026-09-18T09:00:00Z',
    }
    const events = groupNewsEvents([report, reprint])
    expect(events).toHaveLength(1)
    expect(events[0].reports.map((item) => item.sourceUrl)).toEqual([
      reprint.sourceUrl,
      report.sourceUrl,
    ])
    expect(events[0].publishedAt).toBe(reprint.publishedAt)
    expect(groupNewsEvents([reprint, report])[0].id).toBe(events[0].id)
    expect(report.id).toBe('original')
  })
  it('keeps new developments, opposite claims and distant recurring headlines separate', () => {
    expect(
      groupNewsEvents([
        { ...report, title: '利率升至1.5%' },
        { ...report, id: 'different-number', title: '利率升至15%' },
      ]),
    ).toHaveLength(2)
    expect(
      groupNewsEvents([
        { ...report, title: '某地事故致1死4伤' },
        { ...report, id: 'update', title: '某地事故致2死7伤' },
        { ...report, id: 'denied', title: '某地事故未致1死4伤' },
      ]),
    ).toHaveLength(3)
    expect(
      groupNewsEvents([report, { ...report, id: 'later', publishedAt: '2026-09-21T08:00:00Z' }]),
    ).toHaveLength(2)
  })
  it('keeps official and publisher searches scoped to matching reports', () => {
    const official = {
      ...report,
      id: 'official',
      sourceName: '外交部',
      provenance: { kind: 'official' as const },
    }
    const filtered = filterNews(
      [report, official],
      { category: '全部', search: '', hours: 168, officialOnly: true },
      Date.parse('2026-09-18T10:00:00Z'),
    )
    expect(groupNewsEvents(filtered)[0].reports.map((item) => item.id)).toEqual(['official'])
  })
})
