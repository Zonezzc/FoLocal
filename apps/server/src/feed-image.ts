export const normalizeFeedImage = (image: unknown, site: unknown): string | null => {
  if (typeof image !== "string" || !image.trim()) return null
  try {
    const url = new URL(image.trim(), typeof site === "string" ? site : undefined)
    return ["http:", "https:", "data:"].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
