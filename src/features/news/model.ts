import { z } from 'zod'

export const categories = ['全部', 'AI', '科技'] as const
export type CategoryFilter = (typeof categories)[number]
const sourceUrl = z
  .string()
  .url()
  .refine(
    (value) => URL.canParse(value) && ['https:', 'http:'].includes(new URL(value).protocol),
    'Only HTTP(S) links are allowed',
  )
// Only bundled illustrations may use relative paths. Remote images must use HTTPS.
const imageUrl = z
  .string()
  .refine(
    (value) =>
      /^\/demo\/[a-z0-9-]+\.(svg|webp|png|jpg)$/.test(value) ||
      (URL.canParse(value) && new URL(value).protocol === 'https:'),
    'Images must use HTTPS or a bundled demo illustration',
  )
export const NewsBriefSchema = z.object({
  status: z.enum(['ready', 'limited', 'unavailable']),
  coverage: z.enum(['article', 'excerpt', 'video-summary', 'photo-caption', 'none']),
  overview: z.string(),
  keyPoints: z.array(z.string()).max(4),
  sections: z.array(z.object({ heading: z.string(), text: z.string() })).max(4),
  images: z.array(z.object({ url: imageUrl, caption: z.string() })).max(3),
  readingMinutes: z.number().int().min(1).max(10),
  sourceUrl,
  generatedAt: z.iso.datetime(),
  contentHash: z.string().optional(),
  checkedAt: z.iso.datetime().optional(),
  failureReason: z
    .enum(['source-access', 'source-network', 'body-missing', 'generation', 'unsupported'])
    .optional(),
})
export type NewsBrief = z.infer<typeof NewsBriefSchema>
export const NewsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  category: z.enum(['AI', '科技', '自然', '经济', '文化', '社会', '太空']),
  channel: z.enum(['全球视野', 'AI', '科技']).optional(),
  focusTags: z.array(z.string()).optional(),
  publishedAt: z.iso.datetime(),
  sourceName: z.string().min(1),
  sourceUrl: sourceUrl.optional(),
  imageUrl: imageUrl.optional(),
  location: z
    .object({
      name: z.string(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      precision: z.enum(['city', 'region', 'country']),
    })
    .nullable(),
  heat: z.number().min(0).max(100),
  sourceCount: z.number().int().positive(),
  isDemo: z.boolean(),
  sourceId: z.string().optional(),
  fetchedAt: z.iso.datetime().optional(),
  language: z.enum(['zh', 'en']).optional(),
  brief: NewsBriefSchema.optional(),
  translation: z
    .object({
      title: z.string().trim().min(1),
      summary: z.string().trim().min(1),
      language: z.literal('zh-CN'),
      provider: z.enum(['deepseek', 'assisted']),
      translatedAt: z.iso.datetime(),
    })
    .optional(),
  locationBasis: z.string().optional(),
  publicationPrecision: z.enum(['date', 'time']).optional(),
  provenance: z
    .object({
      kind: z.enum(['official', 'publisher-original', 'reprint', 'unverified', 'commentary']),
      publisher: z.string().optional(),
      originalUrl: sourceUrl.optional(),
      checkedAt: z.iso.datetime().optional(),
    })
    .optional(),
})
export const SourceStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: sourceUrl,
  status: z.enum(['ok', 'cached', 'error']),
  count: z.number().int().nonnegative(),
  fetchedAt: z.iso.datetime().optional(),
  message: z.string().optional(),
})
export const NewsFeedSchema = z.object({
  items: z.array(NewsItemSchema),
  generatedAt: z.iso.datetime(),
  mode: z.enum(['demo', 'live']),
  sources: z.array(SourceStatusSchema).optional(),
  hotspots: z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          platform: z.enum(['baidu', 'weibo']),
          title: z.string().min(1),
          rank: z.number().int().positive(),
          heat: z.string(),
          url: sourceUrl,
          observedAt: z.iso.datetime(),
        }),
      ),
      sources: z.array(
        z.object({
          id: z.enum(['baidu', 'weibo', 'xiaohongshu']),
          name: z.string(),
          status: z.enum(['ok', 'cached', 'error', 'not-configured', 'unavailable']),
          message: z.string(),
          fetchedAt: z.iso.datetime().optional(),
        }),
      ),
    })
    .optional(),
})
export type NewsItem = z.infer<typeof NewsItemSchema> & {
  original?: { title: string; summary: string }
}
export type NewsFeed = z.infer<typeof NewsFeedSchema>
export type HotspotFeed = NonNullable<NewsFeed['hotspots']>
export type Hotspot = HotspotFeed['items'][number]
export interface NewsFilter {
  category: CategoryFilter
  search: string
  hours: 24 | 168
  officialOnly?: boolean
  includeUntranslated?: boolean
}
export const provenanceLabels = {
  official: '官方发布',
  'publisher-original': '来源自署',
  reprint: '转载报道',
  unverified: '出处待核',
  commentary: '评论观点',
} as const
export const categoryColors: Record<NewsItem['category'], string> = {
  AI: '#b9b4df',
  科技: '#9cbbdf',
  自然: '#b7b5a4',
  经济: '#c7b394',
  文化: '#b8accb',
  社会: '#a5b6c9',
  太空: '#a9aecb',
}
