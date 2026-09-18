import type { NewsItem } from '../src/features/news/model'
import { getMapAnchor } from '../src/features/news/mapAnchor'

// Coarse editorial coverage bands, not administrative boundaries or new event locations.
export const coverageRegions = ['南美', '非洲', '大洋洲', '北美', '欧洲', '亚洲', '中东'] as const
export type CoverageRegion = (typeof coverageRegions)[number]
export const coverageMinimum = 2
export const coverageTarget = 3

export function coverageRegion(location: NewsItem['location']): CoverageRegion | undefined {
  if (!location) return undefined
  const { lat, lng } = location
  if (lat < -60) return undefined
  if (lat < 13 && lat > -57 && lng < -34 && lng > -83) return '南美'
  if (lng < -30 && lng > -170 && lat >= 7) return '北美'
  if (lat < 0 && (lng > 110 || lng < -150)) return '大洋洲'
  if (lat >= 12 && lat <= 42 && lng >= 34 && lng <= 63) return '中东'
  if (lat < 37 && lat > -36 && lng >= -20 && lng < 52) return '非洲'
  if (lat >= 35 && lng >= -25 && lng < 60) return '欧洲'
  if (lng >= 60 || (lat >= 0 && lng >= 52)) return '亚洲'
  return undefined
}

export function coverageCounts(items: NewsItem[]) {
  const counts = Object.fromEntries(coverageRegions.map((region) => [region, 0])) as Record<
    CoverageRegion,
    number
  >
  for (const item of items) {
    const region = item.channel === '全球视野' ? coverageRegion(item.location) : undefined
    if (region) counts[region]++
  }
  return counts
}

// Track China and the US independently; continental neighbors must not fill their quota.
const focusedRegions = [
  ...coverageRegions.filter((region) => region !== '亚洲' && region !== '北美'),
  '美国',
  '北美其他',
  '中国',
  '亚洲其他',
]
export function editionRegion(item: NewsItem): string | undefined {
  if (item.channel === '全球视野') return coverageRegion(item.location)
  const location = getMapAnchor(item)?.location
  if (!location) return undefined
  if (/中国|北京|上海|杭州|深圳|东莞/.test(location.name)) return '中国'
  if (/美国/.test(location.name)) return '美国'
  const region = coverageRegion(location)
  if (region === '北美') return '北美其他'
  return region === '亚洲' ? '亚洲其他' : region
}
export function editionCoverageCounts(items: NewsItem[]) {
  const result: Record<'全球视野' | 'AI' | '科技', Record<string, number>> = {
    全球视野: coverageCounts(items),
    AI: Object.fromEntries(focusedRegions.map((region) => [region, 0])),
    科技: Object.fromEntries(focusedRegions.map((region) => [region, 0])),
  }
  for (const item of items) {
    if (item.channel !== 'AI' && item.channel !== '科技') continue
    const region = editionRegion(item)
    if (region) result[item.channel][region]++
  }
  return result
}
