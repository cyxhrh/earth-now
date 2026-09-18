import type { NewsItem } from './model'

// Only display copies change. Location matching and stored source text stay original.
export function localizeNews(item: NewsItem): NewsItem {
  if (item.original || item.language !== 'en' || !item.translation) return item
  return {
    ...item,
    original: { title: item.title, summary: item.summary },
    title: item.translation.title,
    summary: item.translation.summary,
  }
}
