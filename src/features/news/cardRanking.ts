import type { Hotspot, NewsItem } from './model'

// Exact titles apart from quotation marks/spacing and trailing exclamation marks.
// Preserve meaningful punctuation, especially decimals, signs and questions.
// Shared names or words are
// insufficient evidence that a story belongs to a trending topic.
const titleKey = (title: string) =>
  title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”‘’「」『』"\p{Z}\s]/gu, '')
    .replace(/[!。]+$/u, '')

export function rankNewsForCards(
  items: NewsItem[],
  hotspots: Hotspot[],
  now: number,
  failedImages: ReadonlySet<string> = new Set(),
): NewsItem[] {
  const ranks = new Map<string, number>()
  for (const topic of hotspots) {
    const age = now - Date.parse(topic.observedAt)
    if (!Number.isFinite(age) || age < 0 || age > 86400_000) continue
    const key = titleKey(topic.title)
    ranks.set(key, Math.min(ranks.get(key) ?? Infinity, topic.rank))
  }
  const popularity = (item: NewsItem) => {
    if (item.isDemo) return item.heat / 100
    const rank = ranks.get(titleKey(item.title))
    return rank ? 1 / rank : 0
  }
  return items
    .map((item) =>
      item.imageUrl && failedImages.has(item.imageUrl) ? { ...item, imageUrl: undefined } : item,
    )
    .sort(
      (a, b) =>
        Number(!!b.imageUrl) - Number(!!a.imageUrl) ||
        popularity(b) - popularity(a) ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        a.id.localeCompare(b.id),
    )
}
