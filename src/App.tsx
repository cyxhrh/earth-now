import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Compass,
  Globe2,
  Info,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { categories, type NewsFeed, type NewsFilter, type NewsItem } from './features/news/model'
import { createNewsProvider } from './features/news/provider'
import { filterNews } from './features/news/query'
import { localizeNews } from './features/news/localize'
import { groupNewsEvents } from './features/news/events'
import { rankNewsForCards } from './features/news/cardRanking'
import { NewsCard } from './features/news/NewsCard'
import { NewsDetail } from './features/news/NewsDetail'
import { NewsImage } from './features/news/NewsImage'

const GlobeView = lazy(() => import('./features/globe/GlobeView'))
const initialFilter: NewsFilter = { category: '全部', search: '', hours: 168 }

export default function App() {
  const [feed, setFeed] = useState<NewsFeed | null>(null)
  const [filter, setFilter] = useState<NewsFilter>(initialFilter)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [about, setAbout] = useState(false)
  const [clock, setClock] = useState(Date.now)
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set())
  const imageFailed = useCallback((url: string) => {
    setFailedImages((previous) => (previous.has(url) ? previous : new Set([...previous, url])))
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      try {
        const result = await createNewsProvider().load(controller.signal)
        if (!controller.signal.aborted) {
          setFeed(result)
          setUpdateAvailable(false)
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '内容加载失败，请重试。')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [reload])
  useEffect(() => {
    if (feed?.mode !== 'live') return
    const controller = new AbortController()
    const signature = (value: NewsFeed) =>
      JSON.stringify([
        value.generatedAt,
        value.items.map((item) => [
          item.id,
          item.title,
          item.translation?.translatedAt,
          item.brief?.generatedAt,
        ]),
      ])
    const timer = window.setInterval(() => {
      void createNewsProvider()
        .load(controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setUpdateAvailable(signature(next) !== signature(feed))
        })
        .catch(() => {
          /* Keep the current reading session during network failure. */
        })
    }, 120_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [feed])
  const isLive = feed?.mode === 'live'
  const now = isLive ? clock : feed ? Date.parse(feed.generatedAt) : clock
  const batchTime = feed
    ? new Date(feed.generatedAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
  const stale = isLive && clock - Date.parse(feed.generatedAt) > 86400_000
  const degraded = feed?.sources?.some((source) => source.status !== 'ok')
  const allNewsUnavailable =
    !!feed?.sources?.length && feed.sources.every((source) => source.status !== 'ok')
  const readableItems = useMemo(() => (feed?.items ?? []).map(localizeNews), [feed])
  const reports = useMemo(
    () => filterNews(readableItems, filter, now),
    [readableItems, filter, now],
  )
  const pendingTranslations = useMemo(
    () =>
      filterNews(readableItems, { ...filter, includeUntranslated: true }, now).filter(
        (item) => item.language === 'en' && !item.translation,
      ).length,
    [readableItems, filter, now],
  )
  const items = useMemo(() => groupNewsEvents(reports), [reports])
  const cardItems = useMemo(
    () => rankNewsForCards(items, feed?.hotspots?.items ?? [], now, failedImages),
    [items, feed?.hotspots?.items, now, failedImages],
  )
  const [featured, secondary] = cardItems
  const selected = items.find((item) => item.id === selectedId) ?? null
  const official = filterNews(readableItems, { ...filter, officialOnly: true }, now)[0]
  const selectItem = useCallback((item: NewsItem) => setSelectedId(item.id), [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="地球此刻首页">
          <span className="brand-icon">
            <Globe2 size={25} strokeWidth={1.3} />
          </span>
          <span>
            <strong>
              地球此刻<span>Earth Now</span>
            </strong>
            <small>从这里，看见世界</small>
          </span>
        </a>
        <div className="header-right">
          <span className="demo-badge">
            <span />
            {isLive
              ? '真实新闻 · 批次更新'
              : feed
                ? '前端预览 · 演示数据'
                : loading
                  ? '正在连接新闻'
                  : '新闻连接失败'}
          </span>
          <button
            className="about-button"
            onClick={() => setAbout((value) => !value)}
            aria-expanded={about}
            aria-label="关于此刻"
          >
            <Info size={14} />
            <span>关于此刻</span>
          </button>
        </div>
      </header>
      {about && (
        <section className="about-banner">
          <div>
            <strong>
              {isLive ? '有出处的新闻，按批次更新。' : '先探索交互，再连接真实世界。'}
            </strong>
            <p>
              {isLive
                ? '第一版聚焦全球重大事件、AI 与科技。优先中文报道与官方发布，按批次更新；同篇报道不重复收录，地图仅标注有依据的相关地区。'
                : '当前为演示模式，故事、时间、热度及来源数量均为虚构样本。'}
            </p>
            {feed?.sources && (
              <ul className="source-status-list">
                {feed.sources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.name}
                    </a>
                    {' · '}
                    {source.status === 'ok'
                      ? `${source.count} 条已读取`
                      : source.status === 'cached'
                        ? '读取失败，保留旧批次'
                        : '暂不可用'}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="icon-button" onClick={() => setAbout(false)} aria-label="关闭说明">
            <X size={18} />
          </button>
        </section>
      )}
      <nav className="category-nav" aria-label="新闻分类">
        {categories.map((category) => (
          <button
            key={category}
            className={filter.category === category ? 'active' : ''}
            aria-pressed={filter.category === category}
            onClick={() => {
              setSelectedId(null)
              setFilter((value) => ({ ...value, category, officialOnly: false }))
            }}
          >
            {category === '全部' && <Compass size={15} />}
            {category === '全部' ? '全球视野' : category}
          </button>
        ))}
        <span className="nav-note">全球大事 · AI 进展 · 科技动态</span>
      </nav>
      {isLive && (
        <div className="batch-bar" role="status">
          <span>
            采集于 {batchTime} · 官方发布 / 媒体报道{stale ? ' · 批次已超过 24 小时' : ''}
            {allNewsUnavailable
              ? ' · 新闻采集失败，保留已有内容'
              : degraded
                ? ' · 部分来源暂不可用'
                : ''}
            {error ? ' · 读取失败，显示上一批内容' : ''}
          </span>
          <button
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
            title="读取服务器已采集的批次，不触发实时抓取"
          >
            <RefreshCw size={13} />
            {loading ? '读取中…' : updateAvailable ? '有新内容 · 点击更新' : '读取最新批次'}
          </button>
        </div>
      )}
      <main className="workspace">
        <aside className="feed-panel" aria-label="新闻列表">
          <div className="feed-header">
            <h2>
              {filter.category === '全部'
                ? '全球大事'
                : filter.category === 'AI'
                  ? 'AI 进展'
                  : '科技动态'}
              <span className="edition-mark">/</span>
            </h2>
            <p className="channel-description">
              {filter.category === '全部'
                ? '关注影响世界的重大公共事件'
                : filter.category === 'AI'
                  ? 'OpenAI · DeepSeek · 模型与智能体'
                  : '小米 · 华为 · Apple · 宇树与前沿科技'}
            </p>
            <label className="search-box">
              <Search size={15} />
              <input
                aria-label="搜索新闻或地点"
                placeholder="搜索新闻、城市或地区"
                value={filter.search}
                onChange={(event) =>
                  setFilter((value) => ({ ...value, search: event.target.value }))
                }
              />
              {filter.search && (
                <button
                  className="icon-button"
                  onClick={() => setFilter((value) => ({ ...value, search: '' }))}
                  aria-label="清除搜索"
                >
                  <X size={13} />
                </button>
              )}
            </label>
            {isLive && (
              <div className="source-filter" aria-label="新闻来源筛选">
                <button
                  aria-pressed={!filter.officialOnly}
                  className={!filter.officialOnly ? 'active' : ''}
                  onClick={() => setFilter((v) => ({ ...v, officialOnly: false }))}
                >
                  最新报道
                </button>
                <button
                  aria-pressed={!!filter.officialOnly}
                  className={filter.officialOnly ? 'active' : ''}
                  onClick={() => setFilter((v) => ({ ...v, officialOnly: true }))}
                >
                  官方发布
                </button>
              </div>
            )}
            <div className="feed-toolbar">
              <span aria-live="polite" title={`${reports.length} 篇报道，重复标题已合并`}>
                {items.length} 条事件
              </span>
              <span>
                <SlidersHorizontal size={12} />
                {isLive ? '按发布时间' : '按报道热度'}
              </span>
            </div>
          </div>
          <div className="news-list">
            {!!pendingTranslations && (
              <div className="translation-notice">
                <span>{pendingTranslations} 篇英文报道待翻译，默认展示中文内容。</span>
                <button
                  className="text-button"
                  aria-pressed={!!filter.includeUntranslated}
                  onClick={() =>
                    setFilter((value) => ({
                      ...value,
                      includeUntranslated: !value.includeUntranslated,
                    }))
                  }
                >
                  {filter.includeUntranslated ? '仅看中文内容' : '也显示未翻译原文'}
                </button>
              </div>
            )}
            {loading && (
              <p className="state-message" role="status">
                正在加载内容…
              </p>
            )}
            {error && (
              <div className="state-message" role="alert">
                <p>{error}</p>
                <button className="text-button" onClick={() => setReload((value) => value + 1)}>
                  重新加载 <RefreshCw size={12} />
                </button>
              </div>
            )}
            {!loading && !error && !items.length && (
              <div className="empty-state">
                <Search size={27} />
                <h3>这里暂时很安静</h3>
                <p>换个关键词，或查看最近七天的内容。</p>
                <button
                  className="text-button"
                  onClick={() => setFilter({ ...initialFilter, hours: 168 })}
                >
                  查看全球大事 <ArrowRight size={13} />
                </button>
              </div>
            )}
            {items.map((item) => (
              <NewsCard
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                onSelect={selectItem}
                now={now}
                reportCount={item.reports.length}
              />
            ))}
          </div>
          <div className="feed-footer">
            <span className="small-dot" />
            {isLive ? '中文阅读 · 译文保留原文' : feed ? '演示内容 · 非实时新闻' : '等待新闻数据'}
          </div>
        </aside>
        <Suspense
          fallback={
            <section className="globe-view">
              <div className="globe-message" role="status">
                正在加载地球组件…
              </div>
            </section>
          }
        >
          <GlobeView
            items={cardItems}
            selected={selected}
            onSelect={selectItem}
            isLive={isLive}
            onImageError={imageFailed}
          />
        </Suspense>
        <aside className="discovery-panel" aria-label="精选新闻">
          {isLive && official && (
            <section className="official-spotlight">
              <span className="eyebrow">DIRECT FROM THE SOURCE</span>
              <h2>官方发布</h2>
              <button
                onClick={() => {
                  setFilter((value) => ({ ...value, officialOnly: false }))
                  selectItem(official)
                }}
              >
                <span>{official.provenance?.publisher}</span>
                <strong>{official.title}</strong>
                <small>
                  查看原始发布 <ArrowUpRight size={13} />
                </small>
              </button>
            </section>
          )}
          <div className="discovery-heading">
            <span className="eyebrow">THE DISCOVERY EDIT</span>
            <h2>值得停留的片刻</h2>
            <p>本栏目精选 · 有图优先</p>
          </div>
          {featured && (
            <button className="feature-story" onClick={() => selectItem(featured)}>
              {featured.imageUrl && (
                <NewsImage item={featured} className="feature-art" onImageError={imageFailed} />
              )}
              <div className="feature-copy">
                <span className="category-label">
                  {featured.category} · {isLive ? featured.sourceName : '编辑精选示例'}
                </span>
                <h3>{featured.title}</h3>
                <span className="feature-link">
                  探索这条故事 <ArrowUpRight size={16} />
                </span>
              </div>
            </button>
          )}
          {secondary && (
            <button className="secondary-story" onClick={() => selectItem(secondary)}>
              {secondary.imageUrl && (
                <NewsImage
                  item={secondary}
                  className="secondary-image"
                  onImageError={imageFailed}
                />
              )}
              <div className="secondary-copy">
                <span className="category-label">
                  {secondary.category} · {secondary.sourceName}
                </span>
                <h3>{secondary.title}</h3>
                <span>
                  {secondary.location?.name ?? '全球视野'}
                  <ArrowUpRight size={15} />
                </span>
              </div>
            </button>
          )}
          <div className="explore-note">
            <Globe2 size={21} strokeWidth={1} />
            <p>
              世界很大。
              <br />
              试着转动地球，去另一处看看。
            </p>
          </div>
        </aside>
      </main>
      <footer className="bottom-bar">
        <span className="bottom-label">
          <Globe2 size={13} />
          全球探索<span className="desktop-only"> · 中文阅读</span>
        </span>
        <div className="time-filter" aria-label="时间范围">
          {([24, 168] as const).map((hours) => (
            <button
              key={hours}
              aria-pressed={filter.hours === hours}
              className={filter.hours === hours ? 'active' : ''}
              onClick={() => setFilter((value) => ({ ...value, hours }))}
            >
              {hours === 24 ? '最近 24 小时' : '最近 7 天'}
            </button>
          ))}
        </div>
        <span className="bottom-status">
          <span className="small-dot" />
          {isLive ? '新闻批次' : feed ? '演示模式' : '等待连接'}
          <span className="desktop-only"> · {isLive ? batchTime : '时间随样本生成'}</span>
        </span>
      </footer>
      {selected && (
        <NewsDetail
          item={selected}
          reports={selected.reports}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
