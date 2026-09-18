import { useState } from 'react'
import { ArrowUpRight, TrendingUp } from 'lucide-react'
import type { HotspotFeed } from './model'

const platforms = [
  { id: 'baidu', name: '百度' },
  { id: 'weibo', name: '微博' },
  { id: 'xiaohongshu', name: '小红书' },
] as const

export function HotspotPanel({ feed }: { feed?: HotspotFeed }) {
  const [platform, setPlatform] = useState<(typeof platforms)[number]['id']>('baidu')
  const [expanded, setExpanded] = useState(false)
  const source = feed?.sources.find((s) => s.id === platform)
  const items = feed?.items.filter((i) => i.platform === platform) || []
  const expired = source?.fetchedAt && Date.now() - Date.parse(source.fetchedAt) > 86400_000
  return (
    <section className="hotspot-panel" aria-label="平台热点">
      <div className="hotspot-heading">
        <TrendingUp size={15} />
        <h3>此刻，大家在关注</h3>
      </div>
      <div className="hotspot-tabs" aria-label="热点平台">
        {platforms.map((p) => (
          <button
            key={p.id}
            aria-pressed={platform === p.id}
            className={platform === p.id ? 'active' : ''}
            onClick={() => {
              setPlatform(p.id)
              setExpanded(false)
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <p className="hotspot-note">平台关注度 · 事实以原始发布为准</p>
      {source?.fetchedAt && (
        <p className="hotspot-time">
          采集于{' '}
          {new Date(source.fetchedAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {source.status === 'cached' ? ' · 更新失败，保留旧榜' : ''}
          {expired ? ' · 已过期' : ''}
        </p>
      )}
      {items.length ? (
        <>
          <ol className="hotspot-list">
            {items.slice(0, expanded ? 20 : 5).map((item) => (
              <li key={item.id}>
                <span className="hotspot-rank">{item.rank.toString().padStart(2, '0')}</span>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`查看${source?.name || ''}话题`}
                >
                  <span>{item.title}</span>
                  <small>热度 {item.heat}</small>
                </a>
                <ArrowUpRight size={12} aria-hidden="true" />
              </li>
            ))}
          </ol>
          {items.length > 5 && (
            <button className="hotspot-expand" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收起榜单' : '展开前 20 条'}
            </button>
          )}
        </>
      ) : (
        <div className="hotspot-empty" role="status">
          <strong>
            {platform === 'xiaohongshu'
              ? '小红书尚未接入'
              : platform === 'weibo'
                ? '微博暂无榜单'
                : '暂时没有热点数据'}
          </strong>
          <p>{source?.message || '等待下一批采集结果'}</p>
        </div>
      )}
    </section>
  )
}
