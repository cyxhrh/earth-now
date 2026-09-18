import { ArrowUpRight, MapPin } from 'lucide-react'
import { categoryColors, provenanceLabels, type NewsItem } from './model'
import { relativeTime } from './query'

export function NewsCard({
  item,
  selected,
  onSelect,
  now,
  reportCount = 1,
}: {
  item: NewsItem
  selected: boolean
  onSelect: (item: NewsItem) => void
  now: number
  reportCount?: number
}) {
  return (
    <button
      className={`news-card ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect(item)}
      aria-pressed={selected}
      data-news-id={item.id}
    >
      <span className="news-meta">
        <span style={{ color: categoryColors[item.category] }}>● {item.category}</span>
        <time dateTime={item.publishedAt}>
          {item.publicationPrecision === 'date'
            ? new Date(item.publishedAt).toLocaleDateString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit',
                day: '2-digit',
              })
            : relativeTime(item.publishedAt, now)}
        </time>
      </span>
      <span className="news-title">
        {item.title}
        <ArrowUpRight size={14} />
      </span>
      <span className="news-location">
        <MapPin size={11} />
        {item.location?.name ?? '跨地区 · 暂无定位'}
      </span>
      <span className="news-attribution" title={item.provenance?.publisher}>
        {item.sourceName}
        {item.provenance && ` · ${provenanceLabels[item.provenance.kind]}`}
        {reportCount > 1 && <span className="report-count">{reportCount} 条报道</span>}
      </span>
    </button>
  )
}
