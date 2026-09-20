/// <reference path="./env.d.ts" />

import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { ImageInfo } from './types'
import { normalizeHtmlTables, restoreTablePipes } from './table-normalizer'

export interface HtmlToMarkdownInput {
  html: string
  baseUrl?: string
}

/**
 * 宿主无关的统一 HTML → Markdown 入口。
 * 调用方负责提取正文、权限控制、资源本地化与最终写入。
 */
export function convertHtmlToMarkdown(input: HtmlToMarkdownInput): string {
  return new Converter().convert(input.html, input.baseUrl)
}

export class Converter {
  private turndown: TurndownService
  private baseUrl = ''

  /** 将可能的相对路径解析为绝对 URL */
  private resolveUrl(src: string): string {
    if (
      !src
      || src.startsWith('http://')
      || src.startsWith('https://')
      || src.startsWith('data:')
      || src.startsWith('assets/')
    ) {
      return src
    }
    try {
      return new URL(src, this.baseUrl).href
    } catch {
      return src
    }
  }

  constructor() {
    const self = this
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      hr: '---',
    })
    this.turndown.use(gfm)
    this.turndown.remove(['style', 'script', 'noscript'])

    // 确保图片语法不被拆行，并将相对路径转为绝对路径
    this.turndown.addRule('images', {
      filter: 'img',
      replacement(_content, node) {
        const el = node as HTMLElement
        const src = el.getAttribute('src') || ''
        const alt = el.getAttribute('alt') || ''
        if (!src) return ''
        return `![${alt}](${self.resolveUrl(src)})`
      },
    })

    // 处理 figure > img 结构
    this.turndown.addRule('figure', {
      filter: 'figure',
      replacement(_content, node) {
        const el = node as HTMLElement
        const img = el.querySelector('img')
        if (!img) return _content
        const src = img.getAttribute('src') || ''
        const alt = img.getAttribute('alt') || ''
        const caption = el.querySelector('figcaption')?.textContent || ''
        if (!src) return ''
        return `\n\n![${alt || caption}](${self.resolveUrl(src)})\n\n`
      },
    })

    // 处理 picture > source/img 结构
    this.turndown.addRule('picture', {
      filter: 'picture',
      replacement(_content, node) {
        const el = node as HTMLElement
        const img = el.querySelector('img')
        if (!img) return ''
        const src = img.getAttribute('src') || ''
        const alt = img.getAttribute('alt') || ''
        return `![${alt}](${self.resolveUrl(src)})`
      },
    })

    // 过滤空锚点链接（如 GitHub 标题锚点 <a href="#xxx"></a>）
    this.turndown.addRule('emptyAnchor', {
      filter(node) {
        return (
          node.nodeName === 'A'
          && !node.textContent?.trim()
          && !node.querySelector('img')
          && (node as HTMLAnchorElement).getAttribute('href')?.startsWith('#') === true
        )
      },
      replacement() {
        return ''
      },
    })

    // 优化代码块：支持多种结构（单 code、多 code 并列等）
    this.turndown.addRule('fencedCodeBlock', {
      filter(node) {
        return node.nodeName === 'PRE' && !!node.querySelector('code')
      },
      replacement(_content, node) {
        const el = node as HTMLElement
        const codes = el.querySelectorAll('code')
        // 提取语言标识
        let lang = ''
        for (const code of codes) {
          const className = code.getAttribute('class') || ''
          const langMatch = className.match(/(?:language-|lang-)(\w+)/)
          if (langMatch?.[1]) { lang = langMatch[1]; break }
        }
        // 多个 code 子元素时每个是一行，单个 code 时取完整文本
        const text = codes.length > 1
          ? Array.from(codes).map(c => c.textContent || '').join('\n')
          : (codes[0]?.textContent || '')
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`
      },
    })
  }

  convert(html: string, baseUrl?: string): string {
    this.baseUrl = baseUrl || globalThis.location?.href || ''
    html = normalizeHtmlTables(html)
    // 预处理：移除 <code> 内的格式标签，避免 **bold** 在 backtick 内变成字面文本
    html = html.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (_match, attrs, inner) => {
      const cleaned = inner.replace(/<\/?(strong|em|b|i|span)[^>]*>/gi, '')
      return `<code${attrs}>${cleaned}</code>`
    })
    let md = this.turndown.turndown(html).trim()
    md = restoreTablePipes(md)
    // 修复 ![]和() 之间被拆行的图片语法
    md = md.replace(/!\[([^\]]*)\][\s\r\n]+\(/g, '![$1](')
    // 清理空锚点链接残留（如 GitHub 标题锚点 [](#xxx)）
    md = md.replace(/\[]\(#[^)]*\)\n*/g, '')
    return md
  }

  extractImages(html: string): ImageInfo[] {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const imgs = doc.querySelectorAll('img[src]')
    const seen = new Set<string>()
    const images: ImageInfo[] = []

    imgs.forEach(img => {
      const src = img.getAttribute('src') || ''
      if (src && !seen.has(src) && src.startsWith('http')) {
        seen.add(src)
        images.push({
          originalUrl: src,
          alt: img.getAttribute('alt') || '',
        })
      }
    })

    return images
  }
}
