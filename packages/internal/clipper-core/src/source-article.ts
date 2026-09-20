import { Readability } from "@mozilla/readability"

import { canonicalizeSourceUrl, convertHtmlToMarkdown, extractWechatArticle } from "../vendor/index"

export interface SourcePage {
  url: string
  html: string
  mode: "static" | "rendered"
  fetchedAt: string
}
export interface SourceArticle {
  url: string
  canonicalUrl: string
  title: string
  author: string
  publishedAt: string
  html: string
  markdown: string
  images: { url: string; placeholder: string }[]
  mode: SourcePage["mode"]
  fetchedAt: string
  extractorVersion: 1
}

const absoluteURL = (value: string, base: string): string => {
  try {
    const url = new URL(value, base)
    return ["http:", "https:"].includes(url.protocol) ? url.href : ""
  } catch {
    return ""
  }
}

/** Takes only a source-page snapshot. Feed content cannot become a fallback. */
export const extractSourceArticle = (page: SourcePage): SourceArticle => {
  if (!absoluteURL(page.url, page.url)) throw new Error("Invalid source URL")
  const doc = new DOMParser().parseFromString(page.html, "text/html")
  const meta = (selector: string) =>
    doc.querySelector(selector)?.getAttribute("content")?.trim() || ""
  const pageText = doc.body.textContent?.trim() || ""
  const title = meta('meta[property="og:title"]') || doc.title.trim()
  if (
    /^(?:just a moment|access denied|安全验证|访问验证|登录|sign in)/i.test(title) ||
    /该内容已被发布者删除|该内容暂时无法查看|访问过于频繁/.test(pageText.slice(0, 1500))
  )
    throw new Error("Source page requires access or manual verification")
  const author = meta('meta[name="author"]') || meta('meta[property="article:author"]')
  const publishedAt =
    meta('meta[property="article:published_time"]') ||
    doc.querySelector("time[datetime]")?.getAttribute("datetime") ||
    ""
  const declared = doc.querySelector('link[rel="canonical"]')?.getAttribute("href")
  const canonical = declared ? absoluteURL(declared, page.url) : page.url
  const canonicalUrl = canonicalizeSourceUrl(
    canonical && new URL(canonical).origin === new URL(page.url).origin ? canonical : page.url,
  )
  const wechat =
    new URL(page.url).hostname === "mp.weixin.qq.com"
      ? extractWechatArticle(doc, { sourceUrl: page.url })
      : null
  doc.querySelectorAll("script,style,noscript,iframe,form").forEach((el) => el.remove())
  doc.querySelectorAll("base").forEach((el) => el.remove())
  const base = doc.createElement("base")
  base.href = page.url
  doc.head.prepend(base)
  const readable = wechat
    ? null
    : new Readability(doc.cloneNode(true) as Document, {
        charThreshold: 80,
        keepClasses: true,
      }).parse()
  const content =
    wechat?.content ?? new DOMParser().parseFromString(readable?.content || "", "text/html").body
  content.querySelectorAll("script,style,iframe,form,object,embed").forEach((el) => el.remove())
  const text = content.textContent?.trim() || ""
  if (text.length < 80 && !content.querySelector("img"))
    throw new Error("No usable article found; open the source page and retry")
  for (const el of content.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes))
      if (attr.name.startsWith("on") || attr.name === "style") el.removeAttribute(attr.name)
  }
  for (const link of content.querySelectorAll("a[href]")) {
    const href = absoluteURL(link.getAttribute("href") || "", page.url)
    if (href) link.setAttribute("href", href)
    else link.removeAttribute("href")
  }
  const images: SourceArticle["images"] = []
  const seen = new Map<string, string>()
  for (const image of content.querySelectorAll("img")) {
    const raw =
      image.getAttribute("data-src") ||
      image.getAttribute("data-original") ||
      image.getAttribute("src") ||
      ""
    const url = absoluteURL(raw, page.url)
    if (!url) throw new Error("An article image has no downloadable source URL")
    let placeholder = seen.get(url)
    if (!placeholder) {
      placeholder = `https://folocal.invalid/clip-image/${images.length}/`
      seen.set(url, placeholder)
      images.push({ url, placeholder })
    }
    image.setAttribute("src", url)
    image.removeAttribute("srcset")
    image.removeAttribute("loading")
  }
  if (images.length > 100) throw new Error("Article exceeds the 100 image limit")
  const html = content.innerHTML
  const converted = content.cloneNode(true) as HTMLElement
  converted
    .querySelectorAll("img")
    .forEach((image) => image.setAttribute("src", seen.get(image.getAttribute("src")!)!))
  const markdown = convertHtmlToMarkdown({ html: converted.innerHTML, baseUrl: page.url })
  if (!markdown.trim()) throw new Error("Article conversion returned no content")
  return {
    url: page.url,
    canonicalUrl,
    title: wechat?.title || readable?.title || title || new URL(page.url).hostname,
    author: readable?.byline || author,
    publishedAt,
    html,
    markdown,
    images,
    mode: page.mode,
    fetchedAt: page.fetchedAt,
    extractorVersion: 1,
  }
}
