import { expect, it, vi } from 'vitest'

// Force both legacy contenders to see the dead PID before either removes it.
// The second unlink resumes only after the first contender creates its new lock.
const state = vi.hoisted(() => ({
  exists: true,
  marker: '99999999',
  temporary: '',
  unlinks: 0,
  release: () => {},
}))
vi.mock('node:fs/promises', () => ({
  realpath: async (path: string) => path,
  open: async () => {
    if (state.exists) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
    state.exists = true
    return {
      writeFile: async () => {
        state.release()
      },
      close: async () => {},
    }
  },
  readFile: async () => state.marker,
  writeFile: async (_path: string, marker: string) => {
    state.temporary = marker
  },
  rename: async () => {
    state.marker = state.temporary
    state.exists = true
  },
  unlink: async (path: string) => {
    if (path.endsWith('.tmp')) return
    state.unlinks++
    if (state.unlinks === 2)
      await new Promise<void>((resolve) => {
        state.release = resolve
      })
    state.exists = false
  },
}))
import { acquireProcessLock } from './processLock'

it('does not let a stale observer unlink the winning contender lock', async () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('dead'), { code: 'ESRCH' })
  })
  let owners: Awaited<ReturnType<typeof acquireProcessLock>>[] = []
  try {
    owners = await Promise.all([
      acquireProcessLock('race-fixture'),
      acquireProcessLock('race-fixture'),
    ])
    expect(owners.filter(Boolean)).toHaveLength(1)
  } finally {
    await Promise.all(owners.map((owner) => owner?.close()))
    kill.mockRestore()
  }
})
