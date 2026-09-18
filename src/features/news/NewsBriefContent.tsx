import { useState } from 'react'
import type { NewsBrief, NewsItem } from './model'

export function BriefFigure({ image }: { image: NewsBrief['images'][number] }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <figure className="brief-figure">
      <img
        src={image.url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      <figcaption>{image.caption}</figcaption>
    </figure>
  )
}

export function NewsBriefContent({ item, heroUrl }: { item: NewsItem; heroUrl?: string }) {
  const brief = item.brief
  if (!brief || brief.status === 'unavailable')
    return (
      <>
        {item.summary !== item.title && <p className="summary">{item.summary}</p>}
        {!item.isDemo && (
          <p className="brief-limited-note">
            {!brief
              ? '正文速读尚未生成，当前展示来源简介。'
              : brief.failureReason === 'source-access'
                ? '来源暂不允许读取正文，当前仅展示订阅简介。可前往原网站继续阅读。'
                : brief.failureReason === 'body-missing'
                  ? '来源页面未提供可提取的正文，当前展示来源简介。'
                  : brief.failureReason === 'generation'
                    ? '正文已取得，中文速读尚未整理成功。当前先展示来源简介。'
                    : '来源正文暂未读取成功，当前展示来源简介。可前往原网站继续阅读。'}
          </p>
        )}
      </>
    )
  const extraImages = brief.images.filter((image) => image.url !== heroUrl)
  return (
    <div className="brief-content">
      <section className="brief-overview" aria-label="新闻概览">
        <span className="brief-eyebrow">先读这一段</span>
        <p>{brief.overview}</p>
      </section>
      <section className="brief-key-points" aria-labelledby="brief-key-title">
        <h3 id="brief-key-title">这条新闻的重点</h3>
        <ul>
          {brief.keyPoints.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </section>
      {brief.sections.map((section, index) => (
        <section className="brief-section" key={index}>
          <h3>{section.heading}</h3>
          <p>{section.text}</p>
          {extraImages[index] && <BriefFigure image={extraImages[index]} />}
        </section>
      ))}
      {brief.status === 'limited' && (
        <p className="brief-limited-note">
          {item.isDemo
            ? '简讯布局演示 · 内容为虚构样本。'
            : brief.coverage === 'video-summary'
              ? '这是一则视频报道，以上根据原页面提供的文字简介整理；完整采访请前往来源观看。'
              : brief.coverage === 'photo-caption'
                ? '这是一则图片新闻，以上根据原页面的图文说明整理。'
                : '原报道篇幅较短，以上已整理其主要信息。'}
        </p>
      )}
      {brief.coverage === 'excerpt' && (
        <p className="brief-limited-note">
          原文较长，本页基于已提取的部分正文整理，完整内容请阅读来源。
        </p>
      )}
      <p className="brief-credit">
        {item.isDemo ? (
          '虚构交互演示 · 文字与插图均不代表真实新闻'
        ) : (
          <>
            依据 {item.sourceName}{' '}
            {brief.coverage === 'video-summary'
              ? '视频文字简介'
              : brief.coverage === 'photo-caption'
                ? '图文说明'
                : '正文'}
            整理 · AI 辅助编辑
          </>
        )}
      </p>
    </div>
  )
}
