import type { NewsItem } from '../src/features/news/model'
import { placeCatalog } from './placeCatalog'

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const detailedPlaces = placeCatalog.map((place) => {
  const pattern = place.aliases
    .map((alias) =>
      /[a-z]/i.test(alias)
        ? `\\b${escapeRegex(alias)}\\b`
        : alias === '纽约'
          ? '纽约(?!州)'
          : escapeRegex(alias),
    )
    .join('|')
  return {
    ...place,
    regex: new RegExp(pattern, 'gi'),
    localContext: new RegExp(`(?:\\bin\\s+|\\bnear\\s+|\\bat\\s+|位于|在|于)(?:${pattern})`, 'i'),
  }
})

function resolvePlaces(text: string, requireLocalContext = false) {
  const matches = detailedPlaces.filter((place) => {
    place.regex.lastIndex = 0
    return place.regex.test(text) && (!requireLocalContext || place.localContext.test(text))
  })
  // A city and its explicitly named parent province describe one location.
  const deepest = matches.filter((place) => !matches.some((other) => other.parent === place.name))
  let remaining = text
  for (const place of matches) remaining = remaining.replace(place.regex, '')
  const countries = countryMatches(remaining)
  const roots = new Set([
    ...deepest.map((place) => place.country),
    ...countries.map((place) => place.name),
  ])
  if (roots.size > 1 || deepest.length > 1) return { location: null, ambiguous: true }
  const precise = deepest[0]
  const location: NewsItem['location'] = precise
    ? { name: precise.name, lat: precise.lat, lng: precise.lng, precision: precise.precision }
    : (countries[0] ?? null)
  return { location, ambiguous: false, country: precise?.country ?? countries[0]?.name }
}

export function locateTitle(title: string): NewsItem['location'] {
  return resolvePlaces(title).location
}

/** Technology feeds often put the company's stated country in the first sentence.
 * Use only an unambiguous subject/operation location, never the feed publisher's country. */
export function locateTechnologyArticle(title: string, summary = '') {
  const reported = locateArticle(title, summary)
  if (reported.location || resolvePlaces(title).ambiguous) return reported
  const context = summary.replace(/([a-z])([A-Z])/g, '$1 $2')
  const firstSentence = context
    .split(/(?<=[.!?])\s/)[0]
    .split(/\b(?:raised|raises|secured|secures|led by|co[- ]led by)\b/i)[0]
  const candidate = resolvePlaces(firstSentence)
  const companyOrOperation =
    /\b(?:based|headquartered|company|startup|start-up|fintech|bank|platform|operator|government|launch|roll.?out|deploy|data cent(?:er|re)|factory|network)\b/i.test(
      firstSentence,
    )
  if (
    !candidate.ambiguous &&
    candidate.location &&
    companyOrOperation &&
    !/\b(?:investors?|led by|founded by|founders?|reporters?|authors?|compared|versus|between)\b/i.test(
      firstSentence,
    )
  ) {
    return {
      location: candidate.location,
      locationBasis: `根据订阅源摘要中主体或业务的相关地区定位至${candidate.location.name}；使用地区代表点，不代表事件现场。`,
    }
  }
  return reported
}

export function locateArticle(title: string, summary = '') {
  // Attribution and personal nationality do not establish an event venue.
  const subject = title
    .replace(
      /^[^：:]{1,55}(?:办公室|外交部|国防部|媒体|外媒|英媒|机构|官员|发言人|警方|专家|学者)[^：:]{0,8}[：:]\s*/,
      '',
    )
    .replace(
      /(?:[\u4e00-\u9fff]{2,8}籍|(?:德国|英国|美国|俄罗斯|意大利|马来西亚|埃塞俄比亚|日本|韩国|中国))(?=选手|运动员|华人|专家|学者|工程师|游客)/g,
      '',
    )
  const headline = resolvePlaces(subject)
  // An explicit event venue can resolve a bilateral headline. Datelines and
  // a reporter's location cannot, and unrelated city mentions stay ambiguous.
  const venues = [
    ...subject.matchAll(
      /在([^，。；：、！？\s]{2,24}?)(?:举行|举办|开幕|开幕式|发生|启动|开赛|遇袭|坠毁|爆炸|沉没)/g,
    ),
  ]
    .map((match) => resolvePlaces(match[1]))
    .filter((place) => place.location && !place.ambiguous)
  const voters = /^([a-z]+) go to polls\b/i.exec(subject)
  const votingCountry = voters ? countryMatches(voters[1]) : []
  const venue =
    venues.length === 1 ? venues[0]?.location : votingCountry.length === 1 ? votingCountry[0] : null
  let location = venue ?? headline.location
  let evidence = '标题'
  // An explicit but unrecognized venue must not fall back to the speaker's country.
  const unknownVenue =
    /在[^，。；：、！？\s]{2,24}?(?:举行|举办|发生|遇袭|坠毁|爆炸|沉没)/.test(subject) && !venue
  if (
    unknownVenue ||
    (!venue && /(?:办公室|机构).{0,6}(?:发布|通报)|大学|记者.{0,8}报道/.test(subject))
  )
    location = null
  const incidents = [
    ...summary.matchAll(/(?:发生在|遇袭于)([^，。；：、！？\s]{2,24}?)(?:的|，|。|$)/g),
  ]
    .map((match) => resolvePlaces(match[1]))
    .filter((place) => place.location && !place.ambiguous)
  if (incidents.length === 1) {
    location = incidents[0].location
    evidence = '订阅源摘要'
  }
  if (!headline.ambiguous && !location) {
    const summaryVenues = [
      ...summary.matchAll(/在([^，。；：、！？\s]{2,24}?)(?:举行|举办|开幕|发生|启动|开赛)/g),
    ]
      .map((match) => resolvePlaces(match[1]))
      .filter((place) => place.location && !place.ambiguous)
    if (summaryVenues.length === 1) {
      location = summaryVenues[0].location
      evidence = '订阅源摘要'
    }
  }
  // Summary evidence must describe a location (e.g. "in New Mexico"), not
  // merely an author's affiliation. Never use it to disambiguate rival countries.
  if (!headline.ambiguous && (!location || location.precision === 'country')) {
    const detail = resolvePlaces(summary, true)
    if (
      !detail.ambiguous &&
      detail.location &&
      detail.location.precision !== 'country' &&
      (!headline.country || headline.country === detail.country)
    ) {
      location = detail.location
      evidence = '订阅源摘要'
    }
  }
  return {
    location,
    locationBasis: location
      ? `根据${evidence}${venue || incidents.length === 1 ? '的事件发生地' : '的相关地区'}定位至${location.name}；使用${{ country: '国家', region: '地区／省州', city: '城市' }[location.precision]}代表点，不代表事件现场。`
      : '未发现唯一、可确认的相关地区，暂不标记。',
  }
}

// Representative country/region points, never article-specific event coordinates.
const places: [string, number, number, string, ('country' | 'region')?][] = [
  ['芬兰', 64, 26, '芬兰|\\bFinland\\b|\\bFinnish\\b'],
  ['比利时', 50.8, 4.5, '比利时|\\bBelgium\\b|\\bBelgian\\b'],
  ['冰岛', 65, -19, '冰岛|\\bIceland(?:ic)?\\b'],
  ['爱沙尼亚', 59, 26, '爱沙尼亚|\\bEstonia(?:n)?\\b'],
  ['瑞士', 47, 8, '瑞士|\\bSwitzerland\\b|\\bSwiss\\b'],
  ['爱尔兰', 53, -8, '爱尔兰|\\bIreland\\b|\\bIrish\\b'],
  ['加纳', 8, -2, '加纳|\\bGhana(?:ian)?\\b'],
  ['埃及', 27, 30, '埃及|\\bEgypt(?:ian)?\\b'],
  ['阿联酋', 24, 54, '阿联酋|\\bUAE\\b|\\bUnited Arab Emirates\\b'],
  ['莫桑比克', -18.7, 35.5, '莫桑比克|\\bMozambique\\b|\\bMozambican\\b'],
  ['马拉维', -13.3, 34.3, '马拉维|\\bMalawi(?:an)?\\b'],
  ['厄立特里亚', 15.2, 39.8, '厄立特里亚|\\bEritrea(?:n)?\\b'],
  ['瑞典', 62, 15, '瑞典|\\bSweden\\b|\\bSwedish\\b'],
  ['葡萄牙', 39.5, -8, '葡萄牙|\\bPortugal\\b|\\bPortuguese\\b'],
  ['白俄罗斯', 53.7, 28, '白俄罗斯|\\bBelarus(?:ian)?\\b'],
  ['南苏丹', 7.9, 30.2, '南苏丹|\\bSouth Sudan\\b'],
  ['苏丹', 15.5, 32.6, '苏丹|\\bSudan(?:ese)?\\b'],
  ['也门', 15.6, 48.5, '也门|\\bYemen(?:i)?\\b'],
  ['加沙地带', 31.4, 34.4, '加沙|\\bGaza\\b', 'region'],
  ['乌克兰', 49, 32, '乌克兰|\\bUkrain(?:e|ian)\\b'],
  ['俄罗斯', 61, 105, '俄罗斯|\\bRussia(?:ns?)?\\b'],
  ['伊朗', 32, 53, '伊朗|\\bIran(?:ian)?\\b'],
  ['以色列', 31.5, 34.8, '以色列|\\bIsrael(?:i)?\\b'],
  ['黎巴嫩', 33.9, 35.8, '黎巴嫩|\\bLebanon\\b|\\bLebanese\\b'],
  ['叙利亚', 35, 38, '叙利亚|\\bSyria(?:n)?\\b'],
  ['阿富汗', 33, 65, '阿富汗|\\bAfghan(?:istan)?\\b'],
  ['巴基斯坦', 30, 70, '巴基斯坦|\\bPakistan(?:i)?\\b'],
  ['印度', 22, 79, '印度|\\bIndia(?:n)?\\b'],
  ['孟加拉国', 24, 90, '孟加拉国|\\bBangladesh(?:i)?\\b'],
  ['尼泊尔', 28, 84, '尼泊尔|\\bNepal(?:ese|i)?\\b'],
  ['缅甸', 21, 96, '缅甸|\\bMyanmar\\b'],
  ['菲律宾', 13, 122, '菲律宾|\\bPhilippines\\b|\\bFilipino\\b'],
  ['日本', 36, 138, '日本|\\bJapan(?:ese)?\\b'],
  ['中国', 35, 104, '中国|\\bChina\\b|\\bChinese\\b'],
  ['韩国', 36, 128, '韩国|\\bSouth Korea(?:n)?\\b'],
  ['朝鲜', 40, 127, '朝鲜|\\bNorth Korea(?:n)?\\b'],
  ['澳大利亚', -25, 134, '澳大利亚|\\bAustralia(?:n)?\\b'],
  ['新西兰', -41, 174, '新西兰|\\bNew Zealand\\b'],
  ['厄瓜多尔', -2, -78, '厄瓜多尔|\\bEcuador(?:ian)?\\b'],
  ['阿根廷', -34, -64, '阿根廷|\\bArgentina\\b|\\bArgentinian\\b'],
  ['智利', -33, -71, '智利|\\bChile(?:an)?\\b'],
  ['秘鲁', -10, -76, '秘鲁|\\bPeru(?:vian)?\\b'],
  ['委内瑞拉', 8, -66, '委内瑞拉|\\bVenezuela(?:n)?\\b'],
  ['古巴', 22, -79, '古巴|\\bCuba(?:n)?\\b'],
  ['巴拿马', 9, -80, '巴拿马|\\bPanama(?:nian)?\\b'],
  ['乌拉圭', -33, -56, '乌拉圭|\\bUruguay(?:an)?\\b'],
  ['巴拉圭', -23, -58, '巴拉圭|\\bParaguay(?:an)?\\b'],
  ['玻利维亚', -17, -65, '玻利维亚|\\bBolivia(?:n)?\\b'],
  ['哥斯达黎加', 10, -84, '哥斯达黎加|\\bCosta Rica(?:n)?\\b'],
  ['斐济', -18, 178, '斐济|\\bFiji(?:an)?\\b'],
  ['巴布亚新几内亚', -6, 147, '巴布亚新几内亚|\\bPapua New Guinea\\b'],
  ['印度尼西亚', -5, 120, '印度尼西亚|印尼|\\bIndonesia(?:n)?\\b'],
  ['马来西亚', 4, 102, '马来西亚|\\bMalaysia(?:n)?\\b'],
  ['新加坡', 1.35, 103.8, '新加坡|\\bSingapore(?:an)?\\b'],
  ['泰国', 15, 101, '泰国|\\bThailand\\b|\\bThai\\b'],
  ['英国', 54, -2, '英国|\\bUnited Kingdom\\b|\\bBritain\\b|\\bBritish\\b'],
  ['法国', 46, 2, '法国|\\bFrance\\b|\\bFrench\\b'],
  ['德国', 51, 10, '德国|\\bGerman(?:y)?\\b'],
  ['意大利', 43, 12, '意大利|\\bItaly\\b|\\bItalian\\b'],
  ['西班牙', 40, -4, '西班牙|\\bSpain\\b|\\bSpanish\\b'],
  ['美国', 39, -98, '美国|\\bUnited States\\b'],
  ['加拿大', 56, -106, '加拿大|\\bCanada\\b|\\bCanadian\\b'],
  ['哥伦比亚', 4, -73, '哥伦比亚|\\bColombia(?:n)?\\b'],
  ['丹麦', 56, 10, '丹麦|\\bDenmark\\b|\\bDanish\\b'],
  ['荷兰', 52, 5, '荷兰|\\bNetherlands\\b|\\bDutch\\b'],
  ['沙特阿拉伯', 24, 45, '沙特(?:阿拉伯)?|\\bSaudi(?: Arabia)?\\b'],
  ['阿曼', 21, 57, '阿曼|\\bOman(?:i)?\\b'],
  ['墨西哥', 23, -102, '墨西哥|\\bMexico\\b|\\bMexican\\b'],
  ['巴西', -14, -52, '巴西|\\bBrazil(?:ian)?\\b'],
  ['海地', 19, -72, '海地|\\bHaiti(?:an)?\\b'],
  ['肯尼亚', 1, 38, '肯尼亚|\\bKenya(?:n)?\\b'],
  ['索马里', 6, 46, '索马里|\\bSomali(?:a)?\\b'],
  ['埃塞俄比亚', 9, 40, '埃塞俄比亚|\\bEthiopia(?:n)?\\b'],
  ['尼日利亚', 9, 8, '尼日利亚|\\bNigeria(?:n)?\\b'],
  ['南非', -29, 24, '南非|\\bSouth Africa(?:n)?\\b'],
  [
    '刚果民主共和国',
    -3,
    24,
    '刚果民主共和国|刚果（金）|\\bDR Congo\\b|\\bDRC\\b|\\bDemocratic Republic of (?:the )?Congo\\b',
  ],
]

function countryMatches(title: string): NonNullable<NewsItem['location']>[] {
  let remaining = title
  const matches: NonNullable<NewsItem['location']>[] = []
  // Uppercase abbreviations are place names; lowercase "us" is a pronoun.
  if (/\bUS\b(?!\$)|\bU\.S\.(?=\s|$|[-–])/.test(remaining)) {
    matches.push({ name: '美国', lat: 39, lng: -98, precision: 'country' })
    remaining = remaining.replace(/\bUS\b(?!\$)|\bU\.S\.(?=\s|$|[-–])/g, '')
  }
  if (/\bUK\b/.test(remaining)) {
    matches.push({ name: '英国', lat: 54, lng: -2, precision: 'country' })
    remaining = remaining.replace(/\bUK\b/g, '')
  }
  for (const [name, lat, lng, pattern, precision = 'country'] of [...places].sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    const regex = new RegExp(pattern, 'gi')
    if (regex.test(remaining)) {
      if (!matches.some((place) => place.name === name)) matches.push({ name, lat, lng, precision })
      remaining = remaining.replace(regex, '')
    }
  }
  return matches
}
