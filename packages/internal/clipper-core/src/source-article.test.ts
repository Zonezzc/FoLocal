import { describe, expect, it } from "vitest"

import { extractSourceArticle } from "./source-article"

const text =
  "This is the complete original article from the source website, with substantial paragraphs that are never supplied by an RSS feed. ".repeat(
    8,
  )
const extract = (body: string, head = "") =>
  extractSourceArticle({
    url: "https://example.org/posts/article?utm_source=rss",
    html: `<html><head><title>Original article</title>${head}</head><body><article><h1>Original article</h1><p>${text}</p>${body}</article></body></html>`,
    mode: "static",
    fetchedAt: "2026-09-20T00:00:00Z",
  })

describe("source article extraction", () => {
  it("extracts source paragraphs, code, tables and absolute links without a feed body", () => {
    const result = extract(
      '<a href="/other">Details</a><pre><code>const answer = 42</code></pre><table><tr><th>A</th><th>B</th></tr><tr><td>one</td><td>two</td></tr></table>',
    )
    expect(result.markdown).toContain("complete original article")
    expect(result.markdown).toContain("https://example.org/other")
    expect(result.markdown).toContain("const answer = 42")
    expect(result.markdown).toContain("one")
    expect(result.images).toHaveLength(0)
  })
  it("normalizes lazy images and uniquely delimits placeholders even beyond ten images", () => {
    const result = extract(
      Array.from(
        { length: 12 },
        (_, index) => `<img data-src="/images/${index}.png" src="/blank.png" alt="Image ${index}">`,
      ).join(""),
    )
    expect(result.images).toHaveLength(12)
    expect(result.images[1]?.url).toBe("https://example.org/images/1.png")
    expect(result.markdown.replaceAll(result.images[1]!.placeholder, "assets/one.png")).toContain(
      result.images[10]!.placeholder,
    )
    expect(result.html).not.toContain("folocal.invalid")
  })
  it("rejects verification and empty pages rather than inventing a full article", () => {
    expect(() =>
      extractSourceArticle({
        url: "https://example.org/login",
        html: "<title>Sign in</title><p>Login required</p>",
        mode: "rendered",
        fetchedAt: "now",
      }),
    ).toThrow()
    expect(() =>
      extractSourceArticle({
        url: "https://example.org/",
        html: "<p>Loading...</p>",
        mode: "static",
        fetchedAt: "now",
      }),
    ).toThrow()
  })
  it("ignores cross-origin canonical and hostile base tags", () => {
    const result = extract(
      '<a href="/safe">safe</a>',
      '<link rel="canonical" href="https://evil.test/"><base href="https://evil.test/">',
    )
    expect(new URL(result.canonicalUrl).hostname).toBe("example.org")
    expect(result.markdown).toContain("https://example.org/safe")
  })
})
