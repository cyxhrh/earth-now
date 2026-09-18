import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Only Vite starts: no worker, database or model environment file is loaded.
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: { ...process.env, VITE_NEWS_PROVIDER: 'mock' } },
)
child.on('error', () => {
  console.error('无法启动演示，请先执行 npm ci。')
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
