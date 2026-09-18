import type { NewsItem } from './model'

export interface MapAnchor {
  location: NonNullable<NewsItem['location']>
  kind: 'reported' | 'organization'
  organization?: string
  basis: string
  sourceUrl?: string
}

// City representative points. Official company addresses checked 2026-09-18.
// These are explicitly company associations, never inferred event venues.
const organizations = [
  {
    name: 'Apple',
    pattern: /^(?:Apple\b|苹果(?:公司)?)/i,
    city: '库比蒂诺，加利福尼亚州，美国',
    lat: 37.32,
    lng: -122.03,
    sourceUrl: 'https://www.apple.com/contact/',
  },
  {
    name: 'Microsoft',
    pattern: /\bmicrosoft\b|微软/i,
    city: '雷德蒙德，华盛顿州，美国',
    lat: 47.67,
    lng: -122.12,
    sourceUrl: 'https://news.microsoft.com/facts-about-microsoft/',
  },
  {
    name: 'NVIDIA',
    pattern: /\bnvidia\b|英伟达/i,
    city: '圣克拉拉，加利福尼亚州，美国',
    lat: 37.35,
    lng: -121.95,
    sourceUrl: 'https://www.nvidia.com/en-us/contact/',
  },
  {
    name: 'OpenAI',
    pattern: /\bopenai\b|chatgpt/i,
    city: '旧金山，美国',
    lat: 37.77,
    lng: -122.42,
    sourceUrl: 'https://openai.com/policies/developer-apps-terms/',
  },
  {
    name: 'Anthropic',
    pattern: /\banthropic\b|\bclaude\b/i,
    city: '旧金山，美国',
    lat: 37.77,
    lng: -122.42,
    sourceUrl: 'https://www.anthropic.com/transparency/voluntary-commitments',
  },
  {
    name: 'DeepSeek',
    pattern: /\bdeepseek\b|深度求索/i,
    city: '杭州，中国',
    lat: 30.25,
    lng: 120.16,
    sourceUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
  },
  {
    name: 'MiniMax',
    pattern: /\bminimax\b|稀宇/i,
    city: '上海，中国',
    lat: 31.23,
    lng: 121.47,
    sourceUrl: 'https://agent.minimaxi.com/doc/zh/privacy-policy.html',
  },
  {
    name: 'vivo',
    pattern: /\bvivo\b/i,
    city: '东莞，中国',
    lat: 23.02,
    lng: 113.75,
    sourceUrl:
      'https://www.vivo.com/en/about-vivo/news/vivo-unveils-the-brand-new-communications-network-lab',
  },
  {
    name: '小米',
    pattern: /小米|\bxiaomi\b|\bredmi\b/i,
    city: '北京，中国',
    lat: 39.9,
    lng: 116.4,
    sourceUrl: 'https://privacy.mi.com/iap-sdk-c/zh_CN/',
  },
]

export function getMapAnchor(item: NewsItem): MapAnchor | null {
  if (item.location)
    return {
      kind: 'reported',
      location: item.location,
      basis: item.locationBasis ?? '报道相关地区代表点',
    }
  if (!['AI', '科技'].includes(item.channel ?? item.category)) return null
  // Match the source headline, not broad summaries/brand tags; competing companies remain unlocated.
  const matches = organizations.filter((org) =>
    org.pattern.test(item.original?.title ?? item.title),
  )
  const officialPublishers: Record<string, string> = { openai: 'OpenAI', 'apple-newsroom': 'Apple' }
  const officialOrganization = officialPublishers[item.sourceId ?? '']
  const organization = officialOrganization
    ? organizations.find((org) => org.name === officialOrganization)
    : matches.length === 1
      ? matches[0]
      : undefined
  if (!organization) return null
  return {
    kind: 'organization',
    organization: organization.name,
    location: {
      name: organization.city,
      lat: organization.lat,
      lng: organization.lng,
      precision: 'city',
    },
    basis: `关联 ${organization.name} 的公开机构所在地：${organization.city}。这是城市代表点，不代表报道的事件发生地。`,
    sourceUrl: organization.sourceUrl,
  }
}
