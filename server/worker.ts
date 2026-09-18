import './environment'
import { setTimeout as delay } from 'node:timers/promises'
import { dataDir } from './store'
import { NewsDatabase, openDatabase, beijingDay } from './database'
import { NewsPipeline } from './pipeline'

const db = await openDatabase(dataDir)
let stopping = false
const abort = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true
    abort.abort()
  })
try {
  const pipeline = new NewsPipeline(new NewsDatabase(db), dataDir)
  await pipeline.init()
  let nextCollection = 0,
    backupDay = ''
  const minutes = Number(process.env.NEWS_POLL_MINUTES || 30)
  const interval = (Number.isFinite(minutes) ? Math.max(10, minutes) : 30) * 60_000
  while (!stopping) {
    if (Date.now() >= nextCollection) {
      try {
        console.log('增量采集：', await pipeline.collect())
      } catch {
        console.error('本轮来源不可用，保留旧内容。')
      }
      nextCollection = Date.now() + interval
    }
    if (!stopping)
      console.log(
        '后台整理：',
        await pipeline.processJobs(process.argv.includes('--drain') ? 300 : 24),
      )
    const day = beijingDay(new Date())
    if (day !== backupDay) {
      await pipeline.backup()
      backupDay = day
    }
    if (process.argv.includes('--once')) break
    await delay(60_000, undefined, { signal: abort.signal }).catch(() => {})
  }
} finally {
  await db.close()
}
