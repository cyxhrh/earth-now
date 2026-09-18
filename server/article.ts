import { load } from 'cheerio'
import type { NewsSource } from './sources'
import { allowedUrl } from './remote'

export interface ArticleContent {
  paragraphs: string[]
  images: { url: string; caption: string }[]
  isVideo: boolean
  isGallery?: boolean
  truncated: boolean
}

export function extractArticle(html: string, source: NewsSource, url: string): ArticleContent {
  const $ = load(html)
  const cns = source.id.startsWith('cns-')
  const path = new URL(url).pathname
  const isGallery = cns && path.startsWith('/tp/')
  const isCnsVideo = cns && path.includes('/shipin/')
  const isVideo =
    isCnsVideo ||
    $('script[type="application/ld+json"]')
      .toArray()
      .some((el) => /"@type"\s*:\s*"VideoObject"/.test($(el).text()))
  // Publisher-specific article containers exclude menus, cookie notices and related stories.
  const selector = source.id.startsWith('cgtn-')
    ? '.m-content'
    : cns
      ? isGallery
        ? '.tuji_list_wrapper'
        : isCnsVideo
          ? '.content_desc'
          : '.left_zw'
      : source.kind === 'mfa'
        ? '.news-main .TRS_UEDITOR, .TRS_Editor'
        : source.id === 'ithome'
          ? '#paragraph'
          : source.id === 'itnews-au'
            ? '#article-body'
            : ['techcrunch', 'techcabal'].includes(source.id)
              ? '.entry-content.wp-block-post-content'
              : source.id.startsWith('guardian-') && $('.article-body-viewer-selector').length
                ? '.article-body-viewer-selector'
                : 'article'
  const root = $(selector).first().clone()
  root
    .find(
      'script, style, nav, aside, footer, form, button, iframe, .related, .recommend, .share, .ad, .pictext, figcaption',
    )
    .remove()
  const textScope = source.id.startsWith('cgtn-')
    ? root.find('.text.en')
    : isGallery
      ? root.find('.current_img_desc_wrapper .desc')
      : root
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
  let paragraphs = textScope
    .find('p')
    .toArray()
    .map((el) => clean($(el).text()))
    .filter(
      (text) => text.length > 20 && !/^\s*(责任编辑|【编辑|来源[:：]|相关阅读|推荐阅读)/.test(text),
    )
  if (!paragraphs.length && textScope.length)
    paragraphs = [clean(textScope.text())].filter((text) => text.length > 60)
  paragraphs = [...new Set(paragraphs)]
  const kept: string[] = []
  let length = 0
  for (const paragraph of paragraphs) {
    if (length + paragraph.length > 18000 || kept.length >= 60) break
    kept.push(paragraph)
    length += paragraph.length
  }
  const images: ArticleContent['images'] = []
  const imageNodes = isGallery ? root.find('.img_wrapper img') : root.find('img')
  imageNodes.each((_, el) => {
    const candidate = $(el).attr('data-src') || $(el).attr('src')
    const image = candidate ? allowedUrl(candidate, source.imageHosts, url) : null
    if (
      !image ||
      image.protocol !== 'https:' ||
      /(?:qrcode|logo|icon)/i.test(image.pathname) ||
      images.some((item) => item.url === image.href)
    )
      return
    images.push({ url: image.href, caption: `原报道配图 · ${source.name}` })
  })
  return {
    paragraphs: kept,
    images: images.slice(0, 3),
    isVideo,
    isGallery,
    truncated: kept.length < paragraphs.length,
  }
}
