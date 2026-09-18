import './environment'
import { dataDir, readSnapshot } from './store'
import { enrichBriefs } from './briefs'

const feed = await readSnapshot()
if (!feed) throw new Error('尚无新闻批次')
const idIndex = process.argv.indexOf('--id')
const selected =
  idIndex >= 0 ? feed.items.filter((item) => item.id === process.argv[idIndex + 1]) : feed.items
const result = await enrichBriefs(selected, dataDir, {
  retryUnavailable: process.argv.includes('--retry-unavailable'),
  onProgress: (done, total, ready) => console.log(`速读整理 ${done}/${total}，已完成 ${ready}`),
})
console.log(JSON.stringify(result))
if (result.status !== 'ok') process.exitCode = 1
