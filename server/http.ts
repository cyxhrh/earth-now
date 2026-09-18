import { createServer, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import type { NewsFeed } from '../src/features/news/model'

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}
function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(data))
}
export function createNewsServer(
  load: () => Promise<NewsFeed | null>,
  staticDir = resolve('dist'),
  statusFile?: string,
) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      return json(response, 405, { error: '只支持读取接口。' })
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
    } catch {
      return json(response, 400, { error: '无效路径。' })
    }
    if (pathname === '/api/health') return json(response, 200, { status: 'ok' })
    if (pathname === '/api/status' && statusFile) {
      try {
        const status = JSON.parse(await readFile(statusFile, 'utf8'))
        const stale =
          !status.collection?.lastSuccessAt ||
          Date.now() - Date.parse(status.collection.lastSuccessAt) > 2 * 3600_000
        return json(response, 200, { ...status, stale })
      } catch {
        return json(response, 503, { error: '后台采集尚未启动。' })
      }
    }
    if (pathname === '/api/news') {
      try {
        const feed = await load()
        if (!feed)
          return json(response, 503, {
            error: '首次采集尚未完成，请稍后重试；持续无内容时请检查唯一 worker 与来源网络。',
          })
        return json(response, 200, feed)
      } catch {
        return json(response, 503, { error: '新闻缓存暂时无法读取，请联系维护者检查采集结果。' })
      }
    }
    if (pathname.startsWith('/api/')) return json(response, 404, { error: '接口不存在。' })
    const file = resolve(staticDir, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(staticDir + sep) || pathname.includes('\\') || pathname.includes('\0'))
      return json(response, 403, { error: '不允许访问此路径。' })
    try {
      const content = await readFile(file)
      response.writeHead(200, {
        'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Cache-Control': pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch {
      json(response, 404, { error: '页面不存在；开发时请打开前端地址，上线前请先构建。' })
    }
  })
}
