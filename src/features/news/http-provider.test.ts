import { afterEach, expect, it, vi } from 'vitest'
import { httpProvider } from './http-provider'

afterEach(() => vi.unstubAllGlobals())
it('explains first collection and worker readiness for an unavailable snapshot', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
  await expect(httpProvider.load()).rejects.toThrow('首次采集')
})
it('rejects unsuccessful API responses instead of silently loading mock data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
  await expect(httpProvider.load()).rejects.toThrow('503')
})
it('validates the response schema before exposing it to the UI', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ mode: 'live', items: [{ title: 'malformed' }] })),
      ),
  )
  await expect(httpProvider.load()).rejects.toThrow()
})
it('passes cancellation through to the HTTP request', async () => {
  const signal = new AbortController().signal
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ mode: 'live', generatedAt: '2026-09-16T12:00:00Z', items: [] }),
      ),
    )
  vi.stubGlobal('fetch', fetcher)
  await httpProvider.load(signal)
  expect(fetcher).toHaveBeenCalledWith('/api/news', { signal, cache: 'no-store' })
})
