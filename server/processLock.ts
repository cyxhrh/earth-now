import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import { renameWithRetry } from './atomic'

/** Host-local kernel ownership survives no process; never reclaim by unlinking a live lock. */
export async function acquireProcessLock(path: string): Promise<{ close(): Promise<void> } | null> {
  const canonical = join(await realpath(dirname(resolve(path))), basename(path))
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical
  const hash = createHash('sha256').update(identity).digest('hex')
  const guard = createServer((socket) => socket.destroy())
  const acquired = await new Promise<boolean>((accept, reject) => {
    guard.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') accept(false)
      else reject(error)
    })
    const ready = () => {
      guard.unref()
      accept(true)
    }
    if (process.platform === 'win32') guard.listen(`\\\\.\\pipe\\earth-news-lock-${hash}`, ready)
    else if (process.platform === 'linux') guard.listen(`\0earth-news-lock-${hash}`, ready)
    // Other platforms lack abstract sockets. Port collisions fail closed as busy.
    else
      guard.listen(
        {
          host: '127.0.0.1',
          port: 20000 + (parseInt(hash.slice(0, 8), 16) % 40000),
          exclusive: true,
        },
        ready,
      )
  })
  if (!acquired) return null
  const closeGuard = () =>
    new Promise<void>((done, reject) => guard.close((error) => (error ? reject(error) : done())))
  const marker = JSON.stringify({ pid: process.pid, token: randomUUID() })
  const temporary = `${canonical}.${randomUUID()}.tmp`
  try {
    let existing: string | undefined
    try {
      existing = await readFile(canonical, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (existing !== undefined) {
      let owner: unknown
      try {
        const value: unknown = JSON.parse(existing)
        owner =
          typeof value === 'number'
            ? value
            : value && typeof value === 'object' && 'pid' in value
              ? value.pid
              : undefined
      } catch {
        /* Legacy empty or damaged files have unknown owners: do not steal. */
      }
      let alive = true
      if (typeof owner === 'number' && Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false
        }
      }
      if (alive) {
        await closeGuard()
        return null
      }
    }
    // Publish a complete marker atomically; a crash cannot leave a new empty lock.
    await writeFile(temporary, marker, { encoding: 'utf8', flag: 'wx' })
    await renameWithRetry(temporary, canonical)
    let released: Promise<void> | undefined
    return {
      close: () =>
        (released ??= (async () => {
          try {
            if ((await readFile(canonical, 'utf8')) === marker) await unlink(canonical)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          } finally {
            await closeGuard()
          }
        })()),
    }
  } catch (error) {
    await closeGuard()
    throw error
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
