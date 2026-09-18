import type { NewsItem } from '../src/features/news/model'

export interface NewsSource {
  id: string
  name: string
  url: string
  hosts: string[]
  imageHosts: string[]
  language: 'zh' | 'en'
  category: NewsItem['category']
  kind?: 'rss' | 'mfa' | 'cns-archive'
  maxItems?: number
}

// Optional legacy sources; default collection does not depend on these overseas feeds.
export const overseasSources: NewsSource[] = [
  {
    id: 'un-zh',
    name: '联合国新闻',
    url: 'https://news.un.org/feed/subscribe/zh/news/all/rss.xml',
    hosts: ['news.un.org'],
    imageHosts: ['news.un.org', 'global.unitednations.entermediadb.net'],
    language: 'zh',
    category: '社会',
  },
  {
    id: 'bbc-world',
    name: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    hosts: ['bbc.com', 'bbc.co.uk'],
    imageHosts: ['ichef.bbci.co.uk'],
    language: 'en',
    category: '社会',
  },
  {
    id: 'bbc-tech',
    name: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    hosts: ['bbc.com', 'bbc.co.uk'],
    imageHosts: ['ichef.bbci.co.uk'],
    language: 'en',
    category: '科技',
  },
  {
    id: 'nasa',
    name: 'NASA',
    url: 'https://www.nasa.gov/feed/',
    hosts: ['nasa.gov'],
    imageHosts: ['nasa.gov'],
    language: 'en',
    category: '太空',
  },
]

// Keep legacy definitions for archived links and migration, but stop polling broad feeds.
export const activeSources = () =>
  sources.filter(
    (source) =>
      [
        'ithome',
        'openai',
        'cns-world',
        'cgtn-world',
        'cgtn-tech-sci',
        'bbc-latin-america',
        'tech-eu',
        'techcabal',
        'restofworld',
        'itnews-au',
        'latamlist',
        'techcrunch',
        'apple-newsroom',
      ].includes(source.id) || source.id.startsWith('guardian-'),
  )

export const sources: NewsSource[] = [
  {
    id: 'apple-newsroom',
    name: 'Apple Newsroom',
    url: 'https://www.apple.com/newsroom/rss-feed.rss',
    hosts: ['apple.com'],
    imageHosts: ['apple.com'],
    language: 'en',
    category: '科技',
    maxItems: 60,
  },
  ...(
    [
      ['tech-eu', 'Tech.eu · 欧洲科技', 'https://tech.eu/feed/', 'tech.eu'],
      ['techcabal', 'TechCabal · 非洲科技', 'https://techcabal.com/feed/', 'techcabal.com'],
      ['restofworld', 'Rest of World', 'https://restofworld.org/feed/latest/', 'restofworld.org'],
      [
        'itnews-au',
        'iTnews · 澳大利亚科技',
        'https://www.itnews.com.au/RSS/rss.ashx',
        'itnews.com.au',
      ],
      ['latamlist', 'LatamList · 拉美科技', 'https://latamlist.com/feed/', 'latamlist.com'],
      ['techcrunch', 'TechCrunch', 'https://techcrunch.com/feed/', 'techcrunch.com'],
    ] as const
  ).map(([id, name, url, host]): NewsSource => ({
    id,
    name,
    url,
    hosts: [host],
    imageHosts: id === 'itnews-au' ? [host, 'i.nextmedia.com.au'] : [host],
    language: 'en',
    category: '科技',
    maxItems: 60,
  })),
  {
    id: 'bbc-latin-america',
    name: 'BBC · 拉丁美洲',
    url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml',
    hosts: ['bbc.com', 'bbc.co.uk'],
    imageHosts: ['ichef.bbci.co.uk'],
    language: 'en',
    category: '社会',
  },
  ...(
    [
      ['americas', '美洲', 'world/americas'],
      ['africa', '非洲', 'world/africa'],
      ['australia', '澳大利亚', 'australia-news'],
      ['newzealand', '新西兰', 'world/newzealand'],
      ['europe', '欧洲', 'world/europe-news'],
      ['north-america', '北美', 'us-news'],
    ] as const
  ).map(([id, name, path]): NewsSource => ({
    id: `guardian-${id}`,
    name: `卫报 · ${name}`,
    url: `https://www.theguardian.com/${path}/rss`,
    hosts: ['theguardian.com'],
    imageHosts: ['guim.co.uk'],
    language: 'en',
    category: '社会',
    maxItems: 40,
  })),
  {
    id: 'ithome',
    name: 'IT之家',
    url: 'https://www.ithome.com/rss/',
    hosts: ['ithome.com'],
    imageHosts: ['ithome.com', 'ithome.net'],
    language: 'zh',
    category: '科技',
    maxItems: 100,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    url: 'https://openai.com/news/rss.xml',
    hosts: ['openai.com'],
    imageHosts: ['openai.com', 'images.ctfassets.net'],
    language: 'en',
    category: 'AI',
    maxItems: 30,
  },
  {
    id: 'mfa',
    name: '外交部',
    kind: 'mfa',
    url: 'https://www.mfa.gov.cn/wjdt_674879/fyrbt_674889/',
    hosts: ['www.mfa.gov.cn'],
    imageHosts: [],
    language: 'zh',
    category: '社会',
  },
  ...(['world', 'finance'] as const).map((channel): NewsSource => ({
    id: `cns-${channel}`,
    name: `中新网 · ${channel === 'world' ? '国际' : '财经'}`,
    url: `https://www.chinanews.com.cn/rss/${channel}.xml`,
    hosts: ['chinanews.com.cn', 'chinanews.com'],
    imageHosts: ['chinanews.com.cn', 'chinanews.com'],
    language: 'zh',
    category: channel === 'world' ? '社会' : '经济',
  })),
  ...(['world', 'tech-sci'] as const).map((channel): NewsSource => ({
    id: `cgtn-${channel}`,
    name: `CGTN · ${channel === 'world' ? '世界' : '科技'}`,
    url: `https://www.cgtn.com/subscribe/rss/section/${channel}.xml`,
    hosts: ['cgtn.com'],
    imageHosts: ['cgtn.com'],
    language: 'en',
    category: channel === 'world' ? '社会' : '科技',
  })),
  {
    id: 'cns-global-archive',
    name: '中新网 · 海外地区',
    kind: 'cns-archive',
    url: 'https://www.chinanews.com.cn/scroll-news/news1.html',
    hosts: ['chinanews.com.cn', 'chinanews.com'],
    imageHosts: ['chinanews.com.cn', 'chinanews.com'],
    language: 'zh',
    category: '社会',
    maxItems: 180,
  },
]
