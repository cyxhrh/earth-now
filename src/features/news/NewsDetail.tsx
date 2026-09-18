import { ArrowUpRight, Clock3, MapPin, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { categoryColors, provenanceLabels, type NewsItem } from './model'
import { NewsImage } from './NewsImage'
import { getMapAnchor } from './mapAnchor'
import { BriefFigure, NewsBriefContent } from './NewsBriefContent'

export function NewsDetail({
  item,
  reports = [item],
  onClose,
}: {
  item: NewsItem
  reports?: NewsItem[]
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const [progress, setProgress] = useState(0)
  const brief = item.brief?.status !== 'unavailable' ? item.brief : undefined
  const hero = brief?.images[0]
  const mapAnchor = getMapAnchor(item)
  const heroUrl = hero?.url ?? item.imageUrl
  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    title.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      // Globe markers can be recreated on selection; the matching list entry
      // remains a dependable keyboard return point in that case.
      const target =
        opener?.isConnected && opener !== document.body
          ? opener
          : document.querySelector<HTMLElement>(`[data-news-id="${CSS.escape(item.id)}"]`)
      target?.focus({ preventScroll: true })
    }
  }, [item.id])
  return (
    <dialog
      ref={dialog}
      className="reading-drawer"
      aria-labelledby="reading-title"
      onScroll={(event) => {
        const element = event.currentTarget
        const range = element.scrollHeight - element.clientHeight
        setProgress(range > 0 ? Math.round((element.scrollTop / range) * 100) : 100)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], summary',
          ),
        ).filter((control) => control.getClientRects().length > 0)
        const first = controls[0]
        const last = controls.at(-1)
        const active = document.activeElement
        if (
          !controls.includes(active as HTMLElement) ||
          (event.shiftKey ? active === first : active === last)
        ) {
          event.preventDefault()
          const target = event.shiftKey ? last : first
          target?.focus({ preventScroll: true })
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose()
      }}
    >
      <section className="detail-panel">
        <div className="section-caption">
          <span>
            新闻速读 <span className="reading-status">地球自转已暂停</span>
          </span>
          <button className="icon-button" onClick={onClose} aria-label="关闭详情">
            <X size={16} />
          </button>
          <progress className="reading-progress" value={progress} max={100} aria-label="阅读进度" />
        </div>
        {hero ? (
          <BriefFigure image={hero} />
        ) : (
          <NewsImage item={item} className="detail-photo" hideWhenMissing />
        )}
        <div className="detail-body">
          <span className="category-label" style={{ color: categoryColors[item.category] }}>
            {item.category} ·{' '}
            {item.isDemo
              ? '演示内容'
              : brief
                ? '中文速读'
                : item.original
                  ? 'AI 中文译文'
                  : item.language === 'en'
                    ? '英文原文 · 待翻译'
                    : '中文新闻'}
          </span>
          <h2 id="reading-title" ref={title} tabIndex={-1}>
            {item.title}
          </h2>
          <p className="detail-location">
            <MapPin size={13} />
            {item.location?.name ??
              (mapAnchor?.kind === 'organization'
                ? `${mapAnchor.organization} 机构所在地：${mapAnchor.location.name}（非事件地点）`
                : '暂无可确认的单一发生地')}
          </p>
          <div className="brief-byline">
            <span>{item.sourceName}</span>
            <time dateTime={item.publishedAt}>
              {new Date(item.publishedAt).toLocaleDateString('zh-CN')}
            </time>
            {brief && (
              <span className="brief-time">
                <Clock3 size={13} />
                {brief.readingMinutes === 1
                  ? '约 1 分钟'
                  : `约 ${brief.readingMinutes} 分钟`} ·{' '}
                {brief.status === 'limited' ? '简讯' : '速读'}
              </span>
            )}
          </div>
          <NewsBriefContent item={item} heroUrl={heroUrl} />
          {item.original && (
            <div className="translation-context">
              {!brief && <p>标题与摘要由 AI 翻译，可展开英文对照；完整报道请访问来源。</p>}
              <details className="original-text">
                <summary>查看英文标题与原始摘要</summary>
                <h3 lang="en">{item.original.title}</h3>
                <p lang="en">{item.original.summary}</p>
              </details>
            </div>
          )}
          <div className="reading-source">
            <span>
              {item.sourceName} · {new Date(item.publishedAt).toLocaleDateString('zh-CN')}
            </span>
            {item.sourceUrl && (
              <a
                className="source-link"
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.language === 'en' ? '访问来源（英文）' : '阅读原文'}{' '}
                <ArrowUpRight size={15} />
              </a>
            )}
          </div>
          {reports.length > 1 && (
            <section className="event-reports" aria-label="同事件报道">
              <h3>同事件 · {reports.length} 条报道</h3>
              <p>相同标题已合并，保留各篇报道及发布时间。</p>
              {reports.map((report) => (
                <article key={report.id}>
                  <span>
                    {report.sourceName} ·{' '}
                    {report.provenance ? provenanceLabels[report.provenance.kind] : '出处待核'}
                    {report.provenance?.publisher && ` · ${report.provenance.publisher}`}
                  </span>
                  <time dateTime={report.publishedAt}>
                    {new Date(report.publishedAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {report.sourceUrl ? (
                    <a href={report.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {report.title} <ArrowUpRight size={13} />
                    </a>
                  ) : (
                    <p>{report.title}</p>
                  )}
                </article>
              ))}
            </section>
          )}
          <details className="source-details">
            <summary>来源与定位说明</summary>
            {!item.isDemo && (
              <p className="source-explanation">
                {brief
                  ? `速读根据 ${item.sourceName} 原页面可提取的${brief.coverage === 'video-summary' ? '视频文字简介' : brief.coverage === 'photo-caption' ? '图文说明' : '正文'}生成，不等于逐字原文；保留原报道归属，不代表独立事实核验。`
                  : item.provenance?.kind === 'official'
                    ? '此条链接指向发布机构官网的原始实录；上方为栏目说明，具体发言请阅读原文。'
                    : `摘要来自 ${item.sourceName} 订阅源。${
                        item.provenance?.kind === 'reprint'
                          ? `该页标注来源为 ${item.provenance.publisher}，当前链接为转载页，首发链接尚未核实。`
                          : item.provenance?.kind === 'publisher-original'
                            ? '该页来源自署为发布媒体，未据此认定所有内容均为现场一手报道。'
                            : '原始出处尚未逐篇核实，请结合原文判断。'
                      }`}
                {item.imageUrl && ' 配图取自该报道的订阅源或正文。'}
              </p>
            )}
            <dl>
              <div>
                <dt>发布于</dt>
                <dd>
                  {item.publicationPrecision === 'date'
                    ? new Date(item.publishedAt).toLocaleDateString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                      }) + '（仅提供日期）'
                    : new Date(item.publishedAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                </dd>
              </div>
              {item.provenance && (
                <div>
                  <dt>出处类型</dt>
                  <dd>{provenanceLabels[item.provenance.kind]}</dd>
                </div>
              )}
              {item.provenance?.publisher && (
                <div>
                  <dt>{item.provenance.kind === 'official' ? '发布机构' : '页面标注来源'}</dt>
                  <dd>{item.provenance.publisher}</dd>
                </div>
              )}
              {item.provenance?.checkedAt && (
                <div>
                  <dt>出处核对于</dt>
                  <dd>{new Date(item.provenance.checkedAt).toLocaleString('zh-CN')}</dd>
                </div>
              )}
              <div>
                <dt>{item.isDemo ? '定位精度' : '地区精度'}</dt>
                <dd>
                  {item.location
                    ? { city: '城市级', region: '区域级', country: '国家级' }[
                        item.location.precision
                      ]
                    : mapAnchor?.kind === 'organization'
                      ? '机构所在城市（非事件地点）'
                      : '未定位'}
                </dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{item.sourceName}</dd>
              </div>
              {item.fetchedAt && (
                <div>
                  <dt>采集于</dt>
                  <dd>{new Date(item.fetchedAt).toLocaleString('zh-CN')}</dd>
                </div>
              )}
            </dl>
            {item.locationBasis && <p className="source-explanation">{item.locationBasis}</p>}
            {mapAnchor?.kind === 'organization' && (
              <p className="source-explanation">
                {mapAnchor.basis}{' '}
                <a href={mapAnchor.sourceUrl} target="_blank" rel="noopener noreferrer">
                  机构所在地依据
                </a>
              </p>
            )}
          </details>
          {!item.sourceUrl && <p className="demo-note">此为虚构的交互演示样本，无真实新闻原文。</p>}
        </div>
      </section>
    </dialog>
  )
}
