import { XMLParser } from "fast-xml-parser"

import { FeedFetchError } from "./feed-errors.js"

export const MAX_FEED_BYTES = 10 * 1024 * 1024
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#text",
  maxNestedTags: 100,
})

export const readFeedBody = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let bytes = 0
  let content = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_FEED_BYTES) throw new FeedFetchError("parse", "Feed exceeds the 10 MiB limit")
      content += decoder.decode(chunk.value, { stream: true })
    }
    return content + decoder.decode()
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

export const parseFeedDocument = (content: string): Record<string, unknown> => {
  if (Buffer.byteLength(content) > MAX_FEED_BYTES)
    throw new FeedFetchError("parse", "Feed exceeds the 10 MiB limit")
  // Repair only a mismatched CDATA wrapper in known article text fields. Do not unescape XML.
  const normalized = content.replace(
    /(<(description|content:encoded|content|summary)(?:\s[^>]*)?>)([\s\S]*?)(<\/\2\s*>)/g,
    (match, opening: string, _tag: string, body: string, closing: string) => {
      const text = body.trim()
      const prefix = "&lt;![CDATA["
      if (!text.startsWith(prefix) || !text.endsWith("]]>")) return match
      return `${opening}<![CDATA[${text.slice(prefix.length, -3)}]]>${closing}`
    },
  )
  try {
    return parser.parse(normalized) as Record<string, unknown>
  } catch (error) {
    throw new FeedFetchError("parse", error instanceof Error ? error.message : "Invalid feed XML")
  }
}
