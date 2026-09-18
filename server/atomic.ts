import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// Windows readers/antivirus can briefly hold a destination handle during atomic replace.
export async function renameWithRetry(from: string, to: string, move = rename) {
  for (let attempt = 0; ; attempt++) {
    try {
      await move(from, to)
      return
    } catch (error) {
      if (
        attempt >= 5 ||
        !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')
      )
        throw error
      await delay(40 * 2 ** attempt)
    }
  }
}
