import type Parser from 'rss-parser'
import type { NewsSource } from './sources'

interface MediaNode {
  $?: { url?: string; type?: string; medium?: string }
  'media:thumbnail'?: MediaNode[]
  'media:content'?: MediaNode[]
}
export interface MediaFields {
  'content:encoded'?: string
  thumbnails?: MediaNode[]
  media?: MediaNode[]
  mediaGroups?: MediaNode[]
}

export function articleImage(
  entry: Parser.Item & MediaFields,
  source: NewsSource,
): string | undefined {
  const candidates: string[] = []
  const addMedia = (nodes: MediaNode[] = [], thumbnail = false) => {
    for (const node of nodes) {
      const attrs = node.$
      if (
        attrs?.url &&
        (thumbnail ||
          attrs.medium === 'image' ||
          attrs.type?.startsWith('image/') ||
          /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(attrs.url))
      )
        candidates.push(attrs.url)
    }
  }
  addMedia(entry.media)
  addMedia(entry.thumbnails, true)
  for (const group of entry.mediaGroups || []) {
    addMedia(group['media:content'])
    addMedia(group['media:thumbnail'], true)
  }
  if (entry.enclosure?.type?.startsWith('image/')) candidates.push(entry.enclosure.url)
  // Read image attributes only; never render upstream HTML in the application.
  for (const tag of (entry['content:encoded'] || entry.content || '').match(/<img\b[^>]*>/gi) ||
    []) {
    const src = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]
    if (src) candidates.push(src.replace(/&amp;/gi, '&'))
  }
  for (const candidate of candidates) {
    let url: URL
    try {
      url = new URL(candidate, source.url)
    } catch {
      continue
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !source.imageHosts.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))
    )
      continue
    return url.href
  }
  return undefined
}
