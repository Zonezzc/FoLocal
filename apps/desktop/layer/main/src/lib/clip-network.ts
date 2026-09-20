export const isClipRendererURL = (value: string, developmentURL?: string): boolean => {
  if (value.startsWith("app://folo.is/")) return true
  try {
    return !!developmentURL && new URL(value).origin === new URL(developmentURL).origin
  } catch {
    return false
  }
}

export const httpURL = (value: string): string => {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Use an HTTP or HTTPS URL without embedded credentials")
  url.hash = ""
  return url.href
}

export const readLimited = async (
  response: Response,
  limit = 10 * 1024 * 1024,
  onProgress?: (received: number, total?: number) => void,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Empty response body")
  const chunks: Uint8Array[] = []
  let size = 0
  const length = Number(response.headers.get("content-length"))
  const total = length > 0 && Number.isFinite(length) ? length : undefined
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > limit) throw new Error("Response exceeds the size limit")
      chunks.push(chunk.value)
      onProgress?.(size, total)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
