import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createNewsServer } from './http'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})
async function start(load: Parameters<typeof createNewsServer>[0]) {
  const server = createNewsServer(load)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
describe('news HTTP API', () => {
  it('returns the batch without fetching upstream and disallows public refresh', async () => {
    const batch = { mode: 'live' as const, generatedAt: '2026-09-16T12:00:00Z', items: [] }
    const url = await start(async () => batch)
    const response = await fetch(url + '/api/news')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(batch)
    expect((await fetch(url + '/api/news', { method: 'POST' })).status).toBe(405)
    expect((await fetch(url + '/api/refresh')).status).toBe(404)
    expect((await fetch(url + '/..%2fpackage.json')).status).toBe(403)
  })
  it('returns an explicit service error for absent or damaged cache, never demo data', async () => {
    for (const load of [
      async () => null,
      async () => {
        throw new Error('private file detail')
      },
    ]) {
      const url = await start(load)
      const response = await fetch(url + '/api/news')
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('private file detail')
    }
  })
})
