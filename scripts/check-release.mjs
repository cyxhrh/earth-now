import { execFileSync } from 'node:child_process'
import { dirname, posix } from 'node:path'

// Scan only the exact Git index, never print matching content or credentials.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
if (!files.length) throw Error('Nothing staged/tracked: stage the reviewed release files first.')
const known = new Set(files)
const problems = []
const allowedEnv = new Set(['.env.example', '.env.translation.example'])
for (const file of files) {
  if (
    /(^|\/)(data|output|node_modules|dist|\.git)\//.test(file) ||
    (/(^|\/)\.env(?:\.|$)/.test(file) && !allowedEnv.has(file)) ||
    /\.(?:local|log|pem|key)$/.test(file)
  )
    problems.push(`${file}: private/generated path`)
  if (
    !/\.(?:md|json|ts|tsx|js|mjs|yml|yaml|html|css|svg|example)$/.test(file) &&
    file !== 'LICENSE'
  )
    continue
  const body = execFileSync('git', ['show', `:${file}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  for (const [name, pattern] of [
    [
      'credential-shaped value',
      /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
    ],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['personal Windows path', /[A-Z]:[\\/]Users[\\/](?!Public[\\/])[^\s"'<>]+/],
  ])
    if (pattern.test(body)) problems.push(`${file}: ${name}`)
  if (file.endsWith('.md')) {
    for (const match of body.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1].split('#')[0]
      if (!link || /^(?:[a-z]+:|\/\/)/i.test(link)) continue
      const target = posix.normalize(
        posix.join(dirname(file).replaceAll('\\', '/'), decodeURIComponent(link)),
      )
      if (!known.has(target)) problems.push(`${file}: untracked link target ${target}`)
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else
  console.log(
    `PASS: ${files.length} tracked files checked for excluded paths, credential patterns and local documentation links. This is a release guard, not a comprehensive security audit.`,
  )
