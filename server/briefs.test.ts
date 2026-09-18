import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractArticle } from './article'
import {
  attachBriefs,
  composeBrief,
  createBriefWriter,
  enrichBriefs,
  fitReadingBudget,
  readBriefs,
} from './briefs'
import { sources } from './sources'
import type { NewsItem } from '../src/features/news/model'

const source = sources.find((source) => source.id === 'cgtn-world')!
const item: NewsItem = {
  id: 'sample',
  title: 'Example report',
  summary: 'A short excerpt.',
  sourceId: source.id,
  sourceName: source.name,
  sourceUrl: 'https://news.cgtn.com/news/example.html',
  category: '社会',
  publishedAt: '2026-09-18T00:00:00Z',
  language: 'en',
  location: null,
  heat: 0,
  sourceCount: 1,
  isDemo: false,
}
const paragraph =
  'At a public forum, the speaker called for negotiations to resolve conflicts and described the need for international cooperation. These remarks were made in an interview.'
const html = `<nav><p>Navigation and an unrelated report</p></nav><div class="m-content"><div class="text en"><p>${paragraph}</p></div><img src="https://news.cgtn.com/photo.jpg"><img src="https://evil.example/photo.jpg"><img src="https://news.cgtn.com/qrcode.png"></div><aside><p>Unrelated content</p></aside>`
const draft = {
  overview: '一名与会者呼吁通过谈判解决冲突。',
  keyPoints: [{ text: '发言出自公开论坛期间的一次采访。', evidence: [0] }],
  sections: [
    { heading: '发言主张', text: '受访者呼吁加强国际合作，通过谈判解决冲突。', evidence: [0] },
  ],
}
const paths: string[] = []
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function temp() {
  const path = await mkdtemp(join(tmpdir(), 'earth-briefs-'))
  paths.push(path)
  return path
}

describe('article extraction', () => {
  it.each(['techcrunch', 'techcabal'])(
    'reads %s WordPress body without surrounding promotions',
    (id) => {
      const source = sources.find((s) => s.id === id)!
      const body = extractArticle(
        `<main><p>Subscribe now to an unrelated newsletter with many offers.</p><div class="entry-content wp-block-post-content"><p>${paragraph}</p><aside><p>Buy event tickets at our next conference here.</p></aside></div></main>`,
        source,
        `https://${source.hosts[0]}/story/`,
      )
      expect(body.paragraphs).toEqual([paragraph])
    },
  )
  it('reads photo captions and the current photo without related gallery thumbnails', () => {
    const gallery = sources.find((source) => source.id === 'cns-world')!
    const text =
      '当地时间周五，一场文化展览在当地举行，现场展示多件作品，报道提供了展览现场的图片。'
    const result = extractArticle(
      `<div class="tuji_list_wrapper"><div class="img_wrapper"><img src="https://i2.chinanews.com.cn/current.jpg"></div><div class="current_img_desc_wrapper"><div class="left desc"><p>${text}</p></div></div><img src="https://i2.chinanews.com.cn/related.jpg"></div>`,
      gallery,
      'https://www.chinanews.com.cn/tp/example.shtml',
    )
    expect(result.isGallery).toBe(true)
    expect(result.paragraphs).toEqual([text])
    expect(result.images.map((image) => image.url)).toEqual([
      'https://i2.chinanews.com.cn/current.jpg',
    ])
    expect(composeBrief(item, result, draft).coverage).toBe('photo-caption')
  })
  it('reads video text descriptions without treating them as a transcript', () => {
    const source = sources.find((source) => source.id === 'cns-world')!
    const text = '受访者在会议期间接受媒体采访，介绍了当地正在开展的合作项目及交流情况。'
    const result = extractArticle(
      `<div class="content_desc"><p>${text}</p></div>`,
      source,
      'https://www.chinanews.com.cn/gj/shipin/example.shtml',
    )
    expect(result.isVideo).toBe(true)
    expect(result.paragraphs).toEqual([text])
  })
  it('recognizes the official transcript container', () => {
    const official = sources.find((source) => source.id === 'mfa')!
    const content = '记者提问：请介绍有关情况。发言人表示，双方保持沟通，具体安排会适时发布。'
    expect(
      extractArticle(
        `<div class="news-main"><div class="TRS_UEDITOR"><p>${content}</p></div></div>`,
        official,
        'https://www.mfa.gov.cn/example.shtml',
      ).paragraphs,
    ).toEqual([content])
  })
  it('extracts article text and permitted article images without navigation or QR images', () => {
    const result = extractArticle(html, source, item.sourceUrl!)
    expect(result.paragraphs).toEqual([paragraph])
    expect(result.images.map((image) => image.url)).toEqual(['https://news.cgtn.com/photo.jpg'])
    expect(result.truncated).toBe(false)
  })
  it('detects video text and does not pretend a missing article body is available', () => {
    const result = extractArticle(
      `<script type="application/ld+json">{"@type":"VideoObject"}</script>${html}`,
      source,
      item.sourceUrl!,
    )
    expect(result.isVideo).toBe(true)
    expect(
      extractArticle('<nav><p>Unrelated long article elsewhere</p></nav>', source, item.sourceUrl!)
        .paragraphs,
    ).toEqual([])
    const brief = composeBrief(item, result, draft)
    expect(brief.coverage).toBe('video-summary')
    expect(brief.status).toBe('limited')
    expect(brief.readingMinutes).toBe(1)
  })
  it('marks truncated text instead of claiming full article coverage', () => {
    const long = Array.from({ length: 70 }, (_, i) => `<p>${i} ${paragraph}</p>`).join('')
    const result = extractArticle(
      `<div class="m-content"><div class="text en">${long}</div></div>`,
      source,
      item.sourceUrl!,
    )
    expect(result.paragraphs).toHaveLength(60)
    expect(composeBrief(item, result, draft).coverage).toBe('excerpt')
  })
})

describe('brief preparation', () => {
  it('reserves model budget only for a new generation, not failed extraction or unchanged bodies', async () => {
    const path = await temp()
    const beforeGenerate = vi.fn(async () => true)
    const writer = vi.fn(async () => draft)
    await enrichBriefs([item], path, {
      fetcher: async () => '<main>No article</main>',
      writer,
      beforeGenerate,
    })
    expect(beforeGenerate).not.toHaveBeenCalled()
    await enrichBriefs([item], path, {
      fetcher: async () => html,
      writer,
      beforeGenerate,
      retryUnavailable: true,
      now: new Date('2026-09-19T00:00:00Z'),
    })
    await enrichBriefs([item], path, {
      fetcher: async () => html,
      writer,
      beforeGenerate,
      now: new Date('2026-09-21T00:00:00Z'),
    })
    expect(beforeGenerate).toHaveBeenCalledTimes(1)
    expect(writer).toHaveBeenCalledTimes(1)
  })
  it('defers without caching a failure when the model budget is unavailable', async () => {
    const path = await temp()
    const writer = vi.fn(async () => draft)
    const result = await enrichBriefs([item], path, {
      fetcher: async () => html,
      writer,
      beforeGenerate: async () => false,
    })
    expect(result.status).toBe('deferred')
    expect(writer).not.toHaveBeenCalled()
    expect(attachBriefs([item], await readBriefs(path))[0].brief).toBeUndefined()
  })
  it('records a safe access reason without exposing upstream errors or attempting generation', async () => {
    const path = await temp()
    const writer = vi.fn(async () => draft)
    await enrichBriefs([item], path, {
      fetcher: async () => {
        throw new Error('HTTP 403 private upstream diagnostics')
      },
      writer,
    })
    const brief = attachBriefs([item], await readBriefs(path))[0].brief!
    expect(brief.failureReason).toBe('source-access')
    expect(JSON.stringify(brief)).not.toContain('private')
    expect(writer).not.toHaveBeenCalled()
  })
  it('keeps complete facts within a three-minute budget and avoids padding short news', () => {
    const short = composeBrief(item, extractArticle(html, source, item.sourceUrl!), draft)
    expect(short.sections).toEqual([])
    const long = {
      ...short,
      status: 'ready' as const,
      sections: Array.from({ length: 4 }, (_, i) => ({
        heading: `背景${i}`,
        text: '这是有出处的完整句子。'.repeat(40),
      })),
    }
    const fitted = fitReadingBudget(long)
    expect(fitted.readingMinutes).toBeLessThanOrEqual(3)
    expect(fitted.keyPoints).toEqual(long.keyPoints)
    expect(
      fitted.sections.every((section) =>
        long.sections.some((original) => original.text === section.text),
      ),
    ).toBe(true)
  })
  it('persists briefs, reuses cache, and does not attach old briefs to changed stories', async () => {
    const path = await temp()
    const fetcher = vi.fn(async () => html)
    const writer = vi.fn(async () => draft)
    expect(await enrichBriefs([item], path, { fetcher, writer })).toMatchObject({ ready: 1 })
    expect(await enrichBriefs([item], path, { fetcher, writer })).toMatchObject({ ready: 0 })
    expect(writer).toHaveBeenCalledTimes(1)
    expect(attachBriefs([item], await readBriefs(path))[0].brief?.overview).toBe(draft.overview)
    expect(
      attachBriefs([{ ...item, summary: 'Updated' }], await readBriefs(path))[0].brief,
    ).toBeUndefined()
  })
  it('does not send an unapproved article URL or pad a missing body using the title', async () => {
    const path = await temp()
    const fetcher = vi.fn(async () => '<html><h1>Headline only</h1></html>')
    const writer = vi.fn(async () => draft)
    const items = [item, { ...item, id: 'unsafe', sourceUrl: 'http://127.0.0.1/private' }]
    expect(await enrichBriefs(items, path, { fetcher, writer })).toMatchObject({
      unavailable: 2,
      ready: 0,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(writer).not.toHaveBeenCalled()
    expect(
      attachBriefs(items, await readBriefs(path)).every(
        (item) => item.brief?.status === 'unavailable',
      ),
    ).toBe(true)
  })
  it('checks changed bodies after a day but does not regenerate unchanged text', async () => {
    const path = await temp()
    const writer = vi.fn(async () => draft)
    await enrichBriefs([item], path, {
      fetcher: async () => html,
      writer,
      now: new Date('2026-09-18T00:00:00Z'),
    })
    await enrichBriefs([item], path, {
      fetcher: async () => html,
      writer,
      now: new Date('2026-09-20T00:00:00Z'),
    })
    expect(writer).toHaveBeenCalledTimes(1)
    await enrichBriefs([item], path, {
      fetcher: async () =>
        html.replace(paragraph, paragraph + ' A new verified statement was added to the article.'),
      writer,
      now: new Date('2026-09-22T00:00:00Z'),
    })
    expect(writer).toHaveBeenCalledTimes(2)
    expect(attachBriefs([item], await readBriefs(path))[0].brief?.contentHash).toBeTruthy()
  })
  it('retains usable cached copy on later upstream failure', async () => {
    const path = await temp()
    await enrichBriefs([item], path, {
      fetcher: async () => html,
      writer: async () => draft,
      now: new Date('2026-09-18T00:00:00Z'),
    })
    await enrichBriefs([item], path, {
      fetcher: async () => {
        throw new Error('offline')
      },
      writer: async () => draft,
      now: new Date('2026-09-20T00:00:00Z'),
    })
    expect(attachBriefs([item], await readBriefs(path))[0].brief?.overview).toBe(draft.overview)
  })
  it('rejects model references to nonexistent paragraphs', async () => {
    const badDraft = { ...draft, keyPoints: [{ text: '不存在的说法', evidence: [42] }] }
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(badDraft) } }],
        }),
      )
    await expect(
      createBriefWriter(
        'test',
        undefined,
        fetcher,
      )(item, extractArticle(html, source, item.sourceUrl!)),
    ).rejects.toThrow('速读引用段落无效')
  })
  it('keeps complete supported sections when the model exceeds the requested section count', async () => {
    const response = {
      ...draft,
      sections: Array.from({ length: 6 }, (_, index) => ({
        ...draft.sections[0],
        heading: `经过${index}`,
      })),
    }
    const writer = createBriefWriter(
      'test',
      undefined,
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }],
          }),
        ),
    )
    const result = await writer(item, extractArticle(html, source, item.sourceUrl!))
    expect(result.sections).toHaveLength(4)
    expect(result.sections[0].text).toBe(draft.sections[0].text)
  })
})
