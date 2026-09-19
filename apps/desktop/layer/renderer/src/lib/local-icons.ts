export const getLocalUrlIcon = (value: string) => {
  let url: URL | undefined
  try {
    const parsed = new URL(value)
    if (["http:", "https:"].includes(parsed.protocol)) url = parsed
  } catch {
    // Invalid feed URLs still receive an offline placeholder.
  }
  const label = ((url?.hostname || value).replace(/^www\./, "").match(/[a-z\d]/gi) || ["R", "S"])
    .slice(0, 2)
    .join("")
    .toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#e9edf4"/><text x="32" y="41" text-anchor="middle" font-family="system-ui,sans-serif" font-size="27" fill="#526178">${label}</text></svg>`
  const fallbackUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return { src: url ? `${url.origin}/favicon.ico` : fallbackUrl, fallbackUrl }
}
