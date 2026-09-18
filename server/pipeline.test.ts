import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { NewsDatabase } from './database'
import { NewsPipeline } from './pipeline'
import { acquireProcessLock } from './processLock'
import { readTranslations } from './translation'
import type { NewsItem } from '../src/features/news/model'

it.each(['busy', 'zero-budget', 'failed-request', 'success'] as const)(
  'accounts only actual translation attempts: %s',
  async (condition) => {
    const directory = await mkdtemp(join(tmpdir(), 'earth-pipeline-'))
    const sql = new PGlite()
    const now = new Date()
    const db = new NewsDatabase(sql)
    let lock: Awaited<ReturnType<typeof acquireProcessLock>> = null
    const item: NewsItem = {
      id: 'budget',
      title: 'DeepSeek releases new AI model',
      summary: 'New capabilities.',
      category: 'AI',
      language: 'en',
      publishedAt: now.toISOString(),
      sourceName: 'Test',
      sourceUrl: 'https://example.com/budget',
      location: null,
      heat: 0,
      sourceCount: 1,
      isDemo: false,
    }
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-placeholder')
    vi.stubEnv('NEWS_DAILY_AI_ATTEMPTS', condition === 'zero-budget' ? '0' : '10')
    let requests = 0
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests++
      if (condition !== 'success') return new Response('', { status: 503 })
      const request = JSON.parse(String(init.body))
      const input = JSON.parse(request.messages[1].content).items
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  items: input.map((entry: { id: string }) => ({
                    id: entry.id,
                    title: '发布新模型',
                    summary: '新增功能。',
                  })),
                }),
              },
            },
          ],
        }),
      )
    })
    try {
      await db.init()
      await db.ingest([item], now)
      if (condition === 'busy') lock = await acquireProcessLock(join(directory, 'translation.lock'))
      await new NewsPipeline(db, directory).processJobs(1, now)
      const usage = (await sql.query<{ attempts: number }>('SELECT attempts FROM daily_usage')).rows
      const attempted = condition === 'failed-request' || condition === 'success'
      expect(usage.reduce((sum, row) => sum + row.attempts, 0)).toBe(attempted ? 1 : 0)
      expect(requests).toBe(attempted ? 1 : 0)
      const task = (
        await sql.query<{ status: string; attempts: number }>(
          "SELECT status,attempts FROM tasks WHERE kind='translation'",
        )
      ).rows[0]
      expect(task).toMatchObject({
        status: condition === 'success' ? 'done' : 'pending',
        attempts: attempted ? 1 : 0,
      })
      expect(Object.keys(await readTranslations(directory))).toHaveLength(
        condition === 'success' ? 1 : 0,
      )
    } finally {
      await lock?.close()
      await sql.close()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      await rm(directory, { recursive: true, force: true })
    }
  },
  20000,
)
