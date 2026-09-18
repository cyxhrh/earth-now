import { NewsFeedSchema } from './model'
import type { NewsProvider } from './provider'

export const httpProvider: NewsProvider = {
  async load(signal) {
    const response = await fetch('/api/news', { signal, cache: 'no-store' })
    if (response.status === 503)
      throw new Error(
        '新闻批次尚未就绪（503）。首次采集需要几分钟，请稍后重新加载；持续无内容时，请检查采集进程与来源网络。',
      )
    if (!response.ok)
      throw new Error(`新闻接口暂不可用（${response.status}），请确认后端已启动并完成采集。`)
    return NewsFeedSchema.parse(await response.json())
  },
}
