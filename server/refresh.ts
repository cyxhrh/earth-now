import './environment'
import { refreshSnapshot } from './store'

try {
  const feed = await refreshSnapshot()
  console.log(
    `采集完成：${feed.items.length} 条真实新闻，${feed.items.filter((i) => i.location).length} 条可标记相关地区。`,
  )
  console.table(
    feed.sources?.map(({ name, status, count, message }) => ({
      name,
      status,
      count,
      message: message || '',
    })),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : '采集失败')
  process.exitCode = 1
}
