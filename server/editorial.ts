import type { NewsItem } from '../src/features/news/model'
import { editionCoverageCounts, editionRegion, coverageTarget } from './coverage'

export const dailyLimits = { 全球视野: 15, AI: 30, 科技: 40 } as const
export type Channel = keyof typeof dailyLimits
// Versioned, explainable editorial rules. They select candidates, not verified importance.
const entities: [string, RegExp][] = [
  ['OpenAI', /\bopenai\b|chatgpt|\bgpt[-\s]?\d|奥特曼/i],
  ['DeepSeek', /deepseek|深度求索|梁文锋/i],
  ['小米', /小米|\bxiaomi\b|redmi|雷军/i],
  ['华为', /华为|\bhuawei\b|鸿蒙|昇腾|麒麟芯片/i],
  ['Apple', /\bapple\b|苹果公司|苹果.*(?:手机|芯片|发布|系统)|iphone|ipad|macbook|苹果智能/i],
  ['宇树科技', /宇树|宇数科技|\bunitree\b/i],
  ['马斯克', /马斯克|\belon musk\b|\bxai\b|\bgrok\b|特斯拉|\btesla\b|spacex|星舰|neuralink/i],
  ['Google', /谷歌|\bgoogle\b|deepmind|gemini/i],
  ['Microsoft', /微软|\bmicrosoft\b/i],
  ['Anthropic', /anthropic|claude/i],
  ['英伟达', /英伟达|\bnvidia\b|黄仁勋/i],
  ['中国 AI', /通义千问|\bqwen\b|豆包|字节跳动|智谱|月之暗面|\bkimi\b|minimax|阶跃星辰/i],
]
const ai =
  /\bai\b|\bagi\b|deepmind|人工智能|大模型|语言模型|智能体|生成式|机器学习|神经网络|模型训练|模型推理|算力|词元|\bllm\b|chatgpt|deepseek|openai|anthropic|claude|gemini|\bgpt[-\s]?\d|\bgrok\b|通义千问|\bqwen\b|豆包|智谱|月之暗面|\bkimi\b|minimax|阶跃星辰/i
const tech =
  /芯片|半导体|机器人|人形|手机|处理器|显卡|量子|自动驾驶|航天|卫星|火箭|星舰|核电|\bchip|robot|iphone|ipad|macbook|satellite|rocket|semiconductor|quantum|nuclear power|software|hardware/i
const digitalTechnology =
  /\b(?:data cent(?:er|re)s?|cloud|cybersecurity|cyber defence|fintech|5g|broadband|smart glasses|network refresh|private cloud|battery|batteries|sensor|security technology|tech companies|technology company)\b|数据中心|网络安全|云计算|宽带/i
const techEditorialNoise =
  /\b(?:podcast|sponsored|in partnership with|techcabal daily|techcrunch disrupt|book excerpt|opinion)\b/i
const noise =
  /优惠券|领券|补贴后|到手价|限时特价|折扣|促销|好价|抽奖|带货|诈骗|绯闻|恋情|穿搭|晒娃|\bcoupon|\bdiscount|\bdeal of/i
const worldMajor =
  /战争|停火|空袭|导弹|核武|核试验|核设施|恐袭|袭击|军事冲突|紧急状态|大选|总统选举|总理辞职|总统辞职|政变|制裁|关税|央行.*(?:降息|加息)|美联储.*(?:降息|加息|利率)|和平协议|人道危机|难民|联合国大会|安理会|地震|海啸|飓风|台风|洪灾|洪水|大规模.*(?:停电|抗议)|疫情|重大事故|客机.*(?:坠毁|失事)|\bwar\b|ceasefire|airstrike|missile|nuclear|terror|election|coup|sanction|tariff|interest rate|earthquake|tsunami|hurricane|flood|pandemic|humanitarian/i
const worldNoise =
  /推介|展销|招商|公益|夏令营|文旅|美食|旅游|摄影|图片故事|音乐会|联谊|侨胞|捐赠|迎新|发言人.*例行记者会|\btravel\b|festival|cuisine|photo of the day/i
// Public-impact developments are broader than war/disaster keywords, but exclude lifestyle and sport.
const publicImpact =
  /严重干旱|交通事故.*(?:死亡|遇难)|爆炸.*(?:死亡|遇难)|枪击|疫情|埃博拉|移民.*(?:政策|改革)|最高法院|部长.*(?:起诉|被控)|\b(?:severe drought|drought.*(?:worsen|crisis)|outbreak|ebola|cholera|mass shooting|ambush|supreme court|unemployment|immigration changes|immigration reform|visa policy|minister.{0,35}charged|dead.{0,45}methanol|femicide|protest|thousands demand|security and economic alliance|associate membership)\b/i
const unrelatedWorld =
  /\breview\b|\bpodcast\b|\bas it happened\b|\bfootball\b|\brugby\b|\bfriendly\b|\bcelebrity\b|\bmovie\b/i

export function classifyArticle(
  item: NewsItem,
): { channel: Channel; focusTags: string[]; score: number } | null {
  if (
    item.provenance?.kind === 'commentary' ||
    noise.test(item.title) ||
    techEditorialNoise.test(item.title) ||
    (item.sourceId === 'apple-newsroom' && /photography exhibition/i.test(item.summary))
  )
    return null
  const text = `${item.title} ${item.summary}`
  const focusTags = entities.filter(([, rule]) => rule.test(text)).map(([name]) => name)
  if (
    (ai.test(item.title) ||
      item.sourceId === 'openai' ||
      (['科技', 'AI'].includes(item.category) &&
        /\bAI\b|\bartificial intelligence\b/i.test(item.summary.split(/(?<=[.!?])\s/)[0]))) &&
    !worldNoise.test(item.title) &&
    (focusTags.length ||
      item.category === '科技' ||
      item.category === 'AI' ||
      ['openai', 'ithome', 'cgtn-tech-sci', 'bbc-tech'].includes(item.sourceId ?? '') ||
      /大模型|智能体|模型训练|模型推理|AI.*(?:监管|法案|安全)/.test(item.title))
  )
    return { channel: 'AI', focusTags, score: focusTags.length ? 90 : 75 }
  if (
    (tech.test(item.title) ||
      (item.category === '科技' && digitalTechnology.test(text)) ||
      /\b(?:waymo|zoox)\b.*\b(?:service|permit|robotaxi|launch|restart)/i.test(item.title) ||
      (focusTags.length &&
        /发布|研发|开源|系统|量产|财报|launch|release|unveils|introduces|new.*(?:features|updates).*available/i.test(
          item.title,
        ))) &&
    (focusTags.length || item.category === '科技')
  )
    return { channel: '科技', focusTags, score: focusTags.length ? 85 : 65 }
  if (
    (worldMajor.test(item.title) || publicImpact.test(item.title)) &&
    !worldNoise.test(item.title) &&
    !unrelatedWorld.test(item.title) &&
    !/战争记忆|侵略战争责任|祝愿.*大选|war memor|remembering the war/i.test(item.title)
  )
    return {
      channel: '全球视野',
      focusTags: [],
      score: /停火|战争|核|地震|ceasefire|nuclear|earthquake/i.test(item.title) ? 95 : 80,
    }
  return null
}

export function scopeNews(items: NewsItem[]): NewsItem[] {
  return items.flatMap((item) => {
    const match = classifyArticle(item)
    return match
      ? [
          {
            ...item,
            channel: match.channel,
            focusTags: match.focusTags,
            category: match.channel === '全球视野' ? item.category : match.channel,
          },
        ]
      : []
  })
}

export function rankCandidates(items: NewsItem[], recent: NewsItem[] = []): NewsItem[] {
  const ranked = scopeNews(items).sort(
    (a, b) =>
      (classifyArticle(b)?.score ?? 0) - (classifyArticle(a)?.score ?? 0) ||
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  )
  const known = new Set(recent.map((item) => item.id))
  const counts = editionCoverageCounts(recent)
  const result: NewsItem[] = []
  while (ranked.length) {
    const deficit = (item: NewsItem) => {
      const region = !known.has(item.id) ? editionRegion(item) : undefined
      return region && item.channel ? Math.max(0, coverageTarget - counts[item.channel][region]) : 0
    }
    let index = 0
    for (let i = 1; i < ranked.length; i++)
      if (deficit(ranked[i]) > deficit(ranked[index])) index = i
    const [item] = ranked.splice(index, 1)
    result.push(item)
    const region = !known.has(item.id) ? editionRegion(item) : undefined
    if (region && item.channel) counts[item.channel][region]++
    known.add(item.id)
  }
  return result
}
