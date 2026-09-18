import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { openDatabase, NewsDatabase, beijingDay } from '../server/database'
import { NewsPipeline } from '../server/pipeline'
import { aggregateFeeds } from '../server/news'
import { readSnapshot } from '../server/store'
import { createNewsServer } from '../server/http'
import { NewsFeedSchema } from '../src/features/news/model'

// Isolated lifecycle probe: no environment file, personal data or paid requests.
const directory = await mkdtemp(join(tmpdir(), 'earth-now-smoke-'))
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  throw Error('Smoke test forbids external network requests')
}
const sql = await openDatabase(directory, '')
const database = new NewsDatabase(sql)
const pipeline = new NewsPipeline(database, directory)
const server = createNewsServer(
  () => readSnapshot(directory),
  resolve('dist'),
  join(directory, 'worker-status.json'),
)
let closed = false
try {
  const now = new Date()
  await pipeline.init(now)
  const source = {
    id: 'smoke',
    name: 'Synthetic fixture',
    url: 'https://example.com/rss',
    hosts: ['example.com'],
    imageHosts: [],
    language: 'zh' as const,
    category: '科技' as const,
  }
  const xml = `<rss version="2.0"><channel><title>Fixture</title><item><title>美国机器人技术研发取得进展</title><link>https://example.com/robot</link><description>美国机器人技术测试的虚构集成测试样本。</description><pubDate>${now.toUTCString()}</pubDate></item></channel></rss>`
  const collected = await aggregateFeeds([source], null, async () => xml, now)
  assert.equal(collected.items.length, 1)
  await database.ingest(collected.items, now)
  await database.ingest(collected.items, now)
  await pipeline.publish(now)
  await pipeline.backup(now)
  const backup = JSON.parse(
    await readFile(join(directory, 'backups', `${beijingDay(now)}.json`), 'utf8'),
  )
  assert.equal(backup.tables.articles.length, 1)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  for (const path of [
    '/',
    '/api/health',
    '/api/status',
    '/demo/ai.svg',
    '/textures/earth-blue-ocean-8k.jpg',
  ]) {
    const response = await originalFetch(base + path)
    assert.equal(response.status, 200, path)
    await response.arrayBuffer()
  }
  const feed = NewsFeedSchema.parse(await (await originalFetch(base + '/api/news')).json())
  assert.equal(feed.items.length, 1)
  assert.equal(feed.mode, 'live')
  assert.equal((await originalFetch(base + '/api/news', { method: 'POST' })).status, 405)
  await sql.close()
  closed = true
  const reopened = await openDatabase(directory, '')
  try {
    const next = new NewsDatabase(reopened)
    await next.init(now)
    assert.equal((await next.recent(now)).length, 1)
  } finally {
    await reopened.close()
  }
  console.log(
    'PASS: empty database → synthetic RSS → deduplication → snapshot/API → backup → restart; built assets served; no external or model requests.',
  )
} finally {
  globalThis.fetch = originalFetch
  await new Promise<void>((done) => server.close(() => done()))
  if (!closed) await sql.close()
  // mkdtemp produced this isolated directory; never remove user data.
  assert.ok(
    resolve(directory).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')),
  )
  await rm(directory, { recursive: true, force: true })
}
