import './environment'
import { createNewsServer } from './http'
import { dataDir, readSnapshot } from './store'
import { join, resolve } from 'node:path'

const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'
const server = createNewsServer(readSnapshot, resolve('dist'), join(dataDir, 'worker-status.json'))
server.listen(port, host, () => console.log(`新闻 API：http://${host}:${port}/api/news`))
server.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close())
