export function allowedUrl(value: string, hosts: string[], base?: string): URL | null {
  try {
    const url = new URL(value, base)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      !hosts.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))
    )
      return null
    return url
  } catch {
    return null
  }
}

export async function readRemoteText(
  value: string,
  hosts = [new URL(value).hostname],
): Promise<string> {
  return (await readRemoteDocument(value, hosts)).text
}

export async function readRemoteDocument(
  value: string,
  hosts = [new URL(value).hostname],
  validators: { etag?: string; modified?: string } = {},
): Promise<{ text: string; notModified?: boolean; etag?: string; modified?: string }> {
  let url = allowedUrl(value, hosts)
  const signal = AbortSignal.timeout(12_000)
  for (let hop = 0; hop < 4 && url; hop++) {
    const response = await fetch(url, {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'EarthNow/0.2 (news reader)',
        Accept: 'application/xml,text/html,application/json',
        ...(validators.etag ? { 'If-None-Match': validators.etag } : {}),
        ...(validators.modified ? { 'If-Modified-Since': validators.modified } : {}),
      },
    })
    if (response.status === 304) {
      await response.body?.cancel()
      return { text: '', notModified: true, ...validators }
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      await response.body?.cancel()
      url = next ? allowedUrl(next, hosts, url.href) : null
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('来源内容为空')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        size += chunk.length
        if (size > 2_000_000) throw new Error('来源超过大小限制')
        chunks.push(chunk)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    return {
      text: Buffer.concat(chunks).toString('utf8'),
      etag: response.headers.get('etag') ?? undefined,
      modified: response.headers.get('last-modified') ?? undefined,
    }
  }
  throw new Error('来源跳转不在允许范围内')
}
