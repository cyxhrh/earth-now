import { loadEnvFile } from 'node:process'

// Server-only file. Never use VITE_ for API credentials.
try {
  loadEnvFile('.env.translation.local')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
