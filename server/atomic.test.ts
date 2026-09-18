import { expect, it, vi } from 'vitest'
import { renameWithRetry } from './atomic'
it('retries a transient Windows sharing violation without deleting the published file', async () => {
  const move = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error('sharing violation'), { code: 'EPERM' }))
    .mockResolvedValue(undefined)
  await renameWithRetry('temp', 'snapshot', move)
  expect(move).toHaveBeenCalledTimes(2)
})
it('does not hide a missing temporary file', async () => {
  const move = vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  await expect(renameWithRetry('temp', 'snapshot', move)).rejects.toThrow('missing')
  expect(move).toHaveBeenCalledTimes(1)
})
