import './environment'
import { dataDir, readSnapshot } from './store'
import { translateItems } from './translation'

const feed = await readSnapshot()
if (!feed) throw new Error('请先执行 npm run news:refresh 采集新闻。')
const result = await translateItems(feed.items, dataDir)
console.log(JSON.stringify(result))
if (result.status !== 'ok') process.exitCode = 1
