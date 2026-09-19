/** Keep transport injectable so desktop requests use Chromium's system/PAC/SOCKS proxy support. */
let transport: typeof fetch | undefined
export const setNetworkFetch = (fetcher: typeof fetch) => {
  transport = fetcher
}
export const networkFetch: typeof fetch = (input, init) =>
  (transport ?? globalThis.fetch)(input, init)

export const describeNetworkError = (error: unknown): string => {
  const parts: string[] = []
  const visited = new Set<unknown>()
  let current = error
  while (current && !visited.has(current) && parts.length < 4) {
    visited.add(current)
    if (typeof current !== "object") {
      parts.push(String(current))
      break
    }
    const item = current as { message?: string; code?: string; cause?: unknown }
    if (item.code) parts.push(item.code)
    if (item.message) parts.push(item.message)
    current = item.cause
  }
  return (
    [...new Set(parts)]
      .join(": ")
      .replace(/https?:\/\/\S+/g, "[URL]")
      .slice(0, 1000) || "Unknown network error"
  )
}
