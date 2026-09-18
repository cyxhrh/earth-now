import type { NewsFilter, NewsItem } from './model'

export function filterNews(items: NewsItem[], filter: NewsFilter, now: number): NewsItem[] {
  const query = filter.search.trim().toLocaleLowerCase()
  return items
    .filter((item) => {
      const age = now - Date.parse(item.publishedAt)
      return (
        age >= 0 &&
        age <= filter.hours * 3_600_000 &&
        item.provenance?.kind !== 'commentary' &&
        (filter.includeUntranslated || item.language !== 'en' || !!item.translation) &&
        (!filter.officialOnly || item.provenance?.kind === 'official') &&
        (item.channel
          ? item.channel === (filter.category === '全部' ? '全球视野' : filter.category)
          : filter.category === '全部' || item.category === filter.category) &&
        [
          item.title,
          item.summary,
          item.original?.title ?? '',
          item.original?.summary ?? '',
          item.location?.name ?? '',
          item.sourceName,
          item.provenance?.publisher ?? '',
          ...(item.focusTags ?? []),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)
      )
    })
    .sort((a, b) => b.heat - a.heat || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}

export function relativeTime(date: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(date)) / 60_000))
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return `${Math.floor(minutes / 1440)} 天前`
}
