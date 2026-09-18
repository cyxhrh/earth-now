import { expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireProcessLock } from './processLock'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

it('retains a live owner and reclaims a terminated owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earth-lock-'))
  const path = join(directory, 'briefs.lock')
  try {
    const lock = await acquireProcessLock(path)
    expect(lock).not.toBeNull()
    expect(await acquireProcessLock(path)).toBeNull()
    await lock!.close()
    await writeFile(path, '123456789')
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    try {
      const recovered = await acquireProcessLock(path)
      expect(recovered).not.toBeNull()
      await recovered!.close()
    } finally {
      kill.mockRestore()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('releases the kernel guard after an actual owner process is terminated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earth-lock-crash-'))
  const path = join(directory, 'worker.lock')
  const moduleUrl = pathToFileURL(resolve('server/processLock.ts')).href
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `const { acquireProcessLock } = await import(${JSON.stringify(moduleUrl)}); const lock = await acquireProcessLock(${JSON.stringify(path)}); process.send(!!lock); setInterval(() => {}, 1000);`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  )
  let recovered: Awaited<ReturnType<typeof acquireProcessLock>> = null
  try {
    const [owned] = await once(child, 'message', { signal: AbortSignal.timeout(10000) })
    expect(owned).toBe(true)
    expect(await acquireProcessLock(path)).toBeNull()
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    recovered = await acquireProcessLock(path)
    expect(recovered).not.toBeNull()
    expect(await acquireProcessLock(path)).toBeNull()
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    await recovered?.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 20000)

it('does not reclaim a legacy lock with an unknown owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earth-lock-unknown-'))
  const path = join(directory, 'worker.lock')
  try {
    await writeFile(path, '')
    expect(await acquireProcessLock(path)).toBeNull()
    expect(await readFile(path, 'utf8')).toBe('')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('releases its ownership marker and allows reacquisition without deleting the next owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earth-lock-release-'))
  const path = join(directory, 'worker.lock')
  try {
    const first = await acquireProcessLock(path)
    await first!.close()
    const next = await acquireProcessLock(path)
    expect(next).not.toBeNull()
    await first!.close()
    expect(await readFile(path, 'utf8')).toBeTruthy()
    expect(await acquireProcessLock(path)).toBeNull()
    await next!.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('allows only one simultaneous contender to reclaim a dead owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earth-lock-race-'))
  const path = join(directory, 'worker.lock')
  await writeFile(path, '123456789')
  const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
    if (pid === 123456789) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    return true
  })
  let owners: Awaited<ReturnType<typeof acquireProcessLock>>[] = []
  try {
    owners = await Promise.all(Array.from({ length: 12 }, () => acquireProcessLock(path)))
    expect(owners.filter(Boolean)).toHaveLength(1)
  } finally {
    await Promise.all(owners.map((owner) => owner?.close()))
    kill.mockRestore()
    await rm(directory, { recursive: true, force: true })
  }
})
