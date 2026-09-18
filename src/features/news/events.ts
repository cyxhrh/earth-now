import type { NewsItem } from './model'

export type NewsEvent = NewsItem & { reports: NewsItem[] }

export function groupNewsEvents(items: NewsItem[]): NewsEvent[] {
  const groups = new Map<string, NewsItem[][]>()
  for (const item of [...items].sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id),
  )) {
    // Deliberately conservative: punctuation/case variants only. Different facts,
    // numbers or wording remain separate, even when they concern the same topic.
    const title = (item.original?.title ?? item.title)
      .normalize('NFKC')
      .toLocaleLowerCase()
      // Preserve decimals, signs, percentages and punctuation inside numbers.
      .replace(/(?<!\d)[:，,、。！？!?]|[:，,、。！？!?](?!\d)|[\s“”‘’「」『』"'（）()]/gu, '')
    const key = item.isDemo ? item.id : title
    const candidates = groups.get(key) ?? []
    const group = candidates.find(
      (reports) =>
        Math.abs(Date.parse(reports[0].publishedAt) - Date.parse(item.publishedAt)) <=
        36 * 3_600_000,
    )
    if (group) group.push(item)
    else candidates.push([item])
    groups.set(key, candidates)
  }
  return [...groups.values()]
    .flat()
    .map((reports) => ({
      ...reports[0],
      id: [...reports].map((item) => item.id).sort()[0],
      reports,
    }))
    .sort((a, b) =>
      a.isDemo && b.isDemo ? b.heat - a.heat : b.publishedAt.localeCompare(a.publishedAt),
    )
}
