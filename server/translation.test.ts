import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachTranslations,
  createDeepSeekTranslator,
  readTranslations,
  translateItems,
} from './translation'
import type { NewsItem } from '../src/features/news/model'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function temp() {
  const directory = await mkdtemp(join(tmpdir(), 'earth-translation-'))
  directories.push(directory)
  return directory
}
const item: NewsItem = {
  id: 'a',
  title: 'Scientists report new results',
  summary: 'A study reports 12 findings.',
  language: 'en',
  category: '科技',
  publishedAt: '2026-09-18T00:00:00Z',
  sourceName: 'Example',
  location: null,
  heat: 0,
  sourceCount: 1,
  isDemo: false,
}
const translator = vi.fn(async (items: { id: string }[]) =>
  items.map(({ id }) => ({ id, title: '科学家公布新成果', summary: '一项研究报告了 12 项发现。' })),
)

describe('translation cache', () => {
  it('recovers a translation lock left by a terminated owner', async () => {
    const directory = await temp()
    await writeFile(join(directory, 'translation.lock'), '123456789')
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    try {
      expect(await translateItems([item], directory, { translator })).toMatchObject({
        status: 'ok',
        translated: 1,
      })
      expect(Object.keys(await readTranslations(directory))).toHaveLength(1)
    } finally {
      kill.mockRestore()
    }
  })
  it('deduplicates identical input, reuses cache and invalidates changed source text', async () => {
    const directory = await temp()
    translator.mockClear()
    const articles = [
      item,
      { ...item, id: 'duplicate' },
      { ...item, id: 'zh', language: 'zh' as const },
    ]
    expect(await translateItems(articles, directory, { translator })).toMatchObject({
      translated: 1,
      pending: 0,
    })
    expect(await translateItems(articles, directory, { translator })).toMatchObject({
      translated: 0,
      pending: 0,
    })
    expect(translator).toHaveBeenCalledTimes(1)
    const cached = attachTranslations(articles, await readTranslations(directory))
    expect(cached[0].title).toBe(item.title)
    expect(cached[1].translation?.title).toBe('科学家公布新成果')
    expect(cached[2].translation).toBeUndefined()
    expect(
      attachTranslations(
        [{ ...cached[0], summary: 'Updated text' }],
        await readTranslations(directory),
      )[0].translation,
    ).toBeUndefined()
  })
  it('retains successful batches and rejects missing, mismatched or non-Chinese results', async () => {
    const directory = await temp()
    await translateItems([item], directory, { translator })
    for (const result of [[], [{ id: 'wrong', title: '中文', summary: '中文' }]]) {
      const outcome = await translateItems([{ ...item, title: 'Different' }], directory, {
        translator: async () => result,
      })
      expect(outcome.status).toBe('partial')
    }
    expect(
      await translateItems([{ ...item, title: 'Different' }], directory, {
        translator: async (items) => items,
      }),
    ).toMatchObject({ status: 'partial' })
    expect(Object.keys(await readTranslations(directory))).toHaveLength(1)
  })
  it('stops after a provider failure and preserves completed batches for retry', async () => {
    const directory = await temp()
    const articles = Array.from({ length: 8 }, (_, index) => ({ ...item, title: `Story ${index}` }))
    const partial = vi
      .fn(translator.getMockImplementation()!)
      .mockImplementationOnce(translator.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('offline'))
    expect(await translateItems(articles, directory, { translator: partial })).toMatchObject({
      translated: 6,
      pending: 2,
    })
    expect(Object.keys(await readTranslations(directory))).toHaveLength(6)
    expect(await translateItems(articles, directory, { translator })).toMatchObject({
      translated: 2,
      pending: 0,
    })
  })
})

describe('DeepSeek boundary', () => {
  it('uses the server-only endpoint and accepts validated JSON output', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    items: [
                      { id: 'a', title: '科学家公布新成果', summary: '一项研究报告了 12 项发现。' },
                    ],
                  }),
                },
              },
            ],
          }),
        ),
    )
    const result = await createDeepSeekTranslator('test-key', 'deepseek-flash', fetcher)([item])
    expect(result[0].title).toBe('科学家公布新成果')
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(request?.redirect).toBe('error')
    expect(JSON.parse(String(request?.body)).response_format).toEqual({ type: 'json_object' })
  })
  it('rejects truncated responses and hides provider error bodies', async () => {
    const truncated: typeof fetch = async () =>
      new Response(
        JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
      )
    await expect(
      createDeepSeekTranslator('test-key', undefined, truncated)([item]),
    ).rejects.toThrow()
    const failed: typeof fetch = async () =>
      new Response('sensitive provider detail', { status: 401 })
    await expect(createDeepSeekTranslator('test-key', undefined, failed)([item])).rejects.toThrow(
      '翻译服务 HTTP 401',
    )
  })
})
