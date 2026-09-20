import { getAccountRules, applyHeadingRules } from './wechat-rules'

export interface WechatExtractOptions {
  sourceUrl?: string
  fallbackTitle?: string
}

interface JsStringToken {
  value: string
  end: number
}

/** 微信公众号正文提取的唯一实现，供油猴入口和思源插件共同调用。 */
export function extractWechatArticle(
  doc: Document,
  options: WechatExtractOptions = {},
): { title: string; content: HTMLElement } | null {
    const metaTitle = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')
      ?.getAttribute('content')?.trim()
    const titleEl = doc.querySelector('#activity-name') || doc.querySelector('h1')
    const title = metaTitle
      || titleEl?.textContent?.trim()
      || options.fallbackTitle?.trim()
      || doc.title

    const imageDetail = extractWechatImageDetail(doc, options, title)
    if (imageDetail) return imageDetail

    const content = doc.querySelector('#js_content')
    if (!content) return null

    const wrapper = doc.createElement('div')
    wrapper.innerHTML = (content as HTMLElement).innerHTML

    // 还原懒加载图片并清理响应式候选，确保两个入口得到相同的图片集合。
    wrapper.querySelectorAll('img').forEach((img) => {
      const source = img.getAttribute('data-src')
        || img.getAttribute('data-original')
        || img.getAttribute('src')
      if (source) img.setAttribute('src', source)
      img.removeAttribute('data-src')
      img.removeAttribute('data-original')
      img.removeAttribute('srcset')
    })

    // 移除公众号名片卡片
    wrapper.querySelectorAll('mp-common-profile, mpprofile').forEach(el => el.remove())

    // 移除视频播放器（保留不了视频，清理播放器 UI 文字）
    wrapper.querySelectorAll('.wx_video_iframe, .js_mpvedio, .mp-video-player, .js_video_channel_card').forEach(el => el.remove())
    // 兜底：移除所有视频容器
    // 1. 通过 <video> 标签（如果 innerHTML 保留了的话）
    wrapper.querySelectorAll('video').forEach((v) => {
      const container = v.closest('section, div') || v.parentElement
      if (container && container !== wrapper) container.remove()
    })
    // 2. 从内部查找视频 UI 叶子元素，逐个向上删除小容器
    wrapper.querySelectorAll('*').forEach((el) => {
      if (el.children.length > 0) return // 只处理叶子节点
      const text = el.textContent?.trim() || ''
      if (text === '已关注' || text === '播放视频' || text === '视频详情'
        || text === '观看更多' || text === '退出全屏' || text === '您的浏览器不支持 video 标签') {
        el.remove()
      }
    })

    // 移除打赏区域：按 class 精确匹配
    wrapper.querySelectorAll([
      '#js_reward_area', '.reward-entry', '.reward_area',
      '.reward_qr_tips', '.reward_qr_code', '.dialog-pay',
    ].join(', ')).forEach(el => el.remove())
    // 兜底：按文本特征截断尾部非正文内容（打赏、推广等）
    // 从内部找到包含关键词的叶子元素，删除它及后续兄弟
    const tailKeywords = [
      '微信扫一扫赞赏作者', '喜欢作者', '赞赏后展示我的头像',
      '点击下方卡片，关注',
    ]
    const allLeaves = wrapper.querySelectorAll('*')
    for (const leaf of allLeaves) {
      if (leaf.children.length > 0) continue
      const text = leaf.textContent?.trim() || ''
      if (!tailKeywords.some(kw => text.includes(kw))) continue
      // 找到包含关键词的叶子，往上找到合适的块级祖先（但不能是 wrapper 本身）
      let target: Element | null = leaf
      while (target && target.parentElement !== wrapper && target.parentElement?.children.length === 1) {
        target = target.parentElement
      }
      if (!target || target === wrapper) continue
      // 删除 target 及其后面所有兄弟
      let sibling = target.nextSibling
      while (sibling) {
        const next = sibling.nextSibling
        sibling.parentNode?.removeChild(sibling)
        sibling = next
      }
      target.remove()
      break
    }

    // 移除不可进入 Markdown 的运行时代码和交互控件。
    wrapper.querySelectorAll('style, script, noscript, iframe, button').forEach(el => el.remove())

    // 移除尾部的发布地点+时间（如 "广东,2026年3月9日 12:30"）
    const allChildren = wrapper.children
    for (let i = allChildren.length - 1; i >= 0; i--) {
      const child = allChildren.item(i)
      if (!child) continue
      const text = child.textContent?.trim() || ''
      if (/^[\u4e00-\u9fa5]+,\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text)) {
        child.remove()
        break
      }
      if (text) break
    }

    // 移除空标题标签
    wrapper.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      if (!h.textContent?.trim()) h.remove()
    })

    // 按公众号精确推断标题（未匹配的不处理）
    const sourceUrl = options.sourceUrl
      || (typeof location === 'undefined' ? '' : location.href)
    const bizMatch = sourceUrl.match(/[?&]__biz=([^&]+)/)
    if (bizMatch?.[1]) {
      const account = getAccountRules(bizMatch[1])
      if (account) {
        applyHeadingRules(wrapper, account.rules)
      }
    }

    // 最终清理：移除空标题（可能由截断+标题推断产生）
    wrapper.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      if (!h.textContent?.trim()) h.remove()
    })

    return { title, content: wrapper }
}

/**
 * 微信“图片详情”页的原始 HTML 不包含 #js_content，正文和原图列表只存在于
 * window.cgiDataNew 中。这里仅解析所需的字符串字段，绝不执行页面脚本。
 */
function extractWechatImageDetail(
  doc: Document,
  options: WechatExtractOptions,
  fallbackTitle: string,
): { title: string; content: HTMLElement } | null {
  if (!isWechatImageDetailPage(doc, options.sourceUrl)) return null

  const cgiObject = findWechatCgiObject(doc)
  const images = cgiObject
    ? extractConfiguredImageUrls(doc, cgiObject)
    : []
  if (images.length === 0) images.push(...extractRenderedImageUrls(doc))
  if (images.length === 0) return null

  const configuredTitleToken = cgiObject
    ? readTopLevelStringProperty(cgiObject, 'title')
    : null
  const descriptionToken = cgiObject
    ? readTopLevelStringProperty(cgiObject, 'desc')
    : null
  const configuredTitle = configuredTitleToken
    ? decodeHtmlEntities(doc, configuredTitleToken.value).trim()
    : ''
  const description = descriptionToken
    ? decodeHtmlEntities(doc, descriptionToken.value).trim()
    : extractRenderedImageDescription(doc)
  const title = configuredTitle || fallbackTitle
  const wrapper = doc.createElement('div')

  appendDescription(doc, wrapper, description)
  images.forEach((source, index) => {
    const image = doc.createElement('img')
    image.setAttribute('src', source)
    image.setAttribute('alt', title
      ? `${title}（${index + 1}/${images.length}）`
      : `图片 ${index + 1}/${images.length}`)
    wrapper.appendChild(image)
  })

  return { title, content: wrapper }
}

function findWechatCgiObject(doc: Document): string | null {
  for (const element of Array.from(doc.scripts)) {
    const script = element.textContent || ''
    if (!script.includes('window.cgiDataNew') || !script.includes('picture_page_info_list')) continue

    const cgiSource = script.slice(script.indexOf('window.cgiDataNew'))
    const objectStart = cgiSource.indexOf('{')
    if (objectStart < 0) continue
    const objectEnd = findMatchingDelimiter(cgiSource, objectStart, '{', '}')
    if (objectEnd < 0) continue
    const cgiObject = cgiSource.slice(objectStart, objectEnd + 1)
    const listStart = findTopLevelPropertyValue(cgiObject, 'picture_page_info_list')
    if (listStart >= 0 && cgiObject[listStart] === '[') return cgiObject
  }
  return null
}

function extractConfiguredImageUrls(doc: Document, cgiObject: string): string[] {
  const listStart = findTopLevelPropertyValue(cgiObject, 'picture_page_info_list')
  if (listStart < 0 || cgiObject[listStart] !== '[') return []
  const listEnd = findMatchingDelimiter(cgiObject, listStart, '[', ']')
  if (listEnd < 0) return []

  const images: string[] = []
  const seen = new Set<string>()
  for (const item of extractTopLevelObjects(cgiObject.slice(listStart, listEnd + 1))) {
    const token = readTopLevelStringProperty(item, 'cdn_url')
    const source = token ? decodeHtmlEntities(doc, token.value).trim() : ''
    if (!/^https?:\/\//i.test(source) || seen.has(source)) continue
    seen.add(source)
    images.push(source)
  }
  return images
}

function extractRenderedImageUrls(doc: Document): string[] {
  const selectors = [
    '#page_top_area .swiper_item_img img',
    '#img_swiper_placeholder .swiper_item_img img',
    '.img_swiper_area .swiper_item_img img',
  ]

  for (const selector of selectors) {
    const images: string[] = []
    const seen = new Set<string>()
    doc.querySelectorAll<HTMLImageElement>(selector).forEach((image) => {
      const source = image.getAttribute('data-src')
        || image.getAttribute('data-original')
        || image.getAttribute('src')
        || image.currentSrc
      const normalized = source ? decodeHtmlEntities(doc, source).trim() : ''
      if (!/^https?:\/\//i.test(normalized) || seen.has(normalized)) return
      seen.add(normalized)
      images.push(normalized)
    })
    if (images.length > 0) return images
  }
  return []
}

function extractRenderedImageDescription(doc: Document): string {
  const description = doc.querySelector('#js_image_desc')
  if (!description) return ''
  const clone = description.cloneNode(true) as HTMLElement
  clone.querySelectorAll('br').forEach((br) => {
    br.replaceWith(doc.createTextNode('\n'))
  })
  return clone.textContent?.trim() || ''
}

function isWechatImageDetailPage(doc: Document, sourceUrl?: string): boolean {
  if (doc.body.classList.contains('page_share_img')) return true
  if (!sourceUrl) return false
  try {
    return new URL(sourceUrl).searchParams.get('t') === 'pages/image_detail'
  } catch {
    return false
  }
}

function appendDescription(doc: Document, wrapper: HTMLElement, description: string): void {
  const blocks = description
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)

  for (const block of blocks) {
    const paragraph = doc.createElement('p')
    const lines = block.split('\n')
    lines.forEach((line, index) => {
      if (index > 0) paragraph.appendChild(doc.createElement('br'))
      paragraph.appendChild(doc.createTextNode(line))
    })
    wrapper.appendChild(paragraph)
  }
}

function readTopLevelStringProperty(source: string, property: string): JsStringToken | null {
  const valueStart = findTopLevelPropertyValue(source, property)
  if (valueStart < 0) return null
  return readJsString(source, valueStart)
}

function findTopLevelPropertyValue(source: string, property: string): number {
  let braces = 0
  let brackets = 0
  let parentheses = 0

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\'' || char === '"') {
      const token = readJsString(source, index)
      if (!token) return -1
      index = token.end - 1
      continue
    }
    if (char === '{') { braces += 1; continue }
    if (char === '}') { braces -= 1; continue }
    if (char === '[') { brackets += 1; continue }
    if (char === ']') { brackets -= 1; continue }
    if (char === '(') { parentheses += 1; continue }
    if (char === ')') { parentheses -= 1; continue }
    if (braces !== 1 || brackets !== 0 || parentheses !== 0 || !/[A-Za-z_$]/.test(char || '')) continue

    let end = index + 1
    while (/[\w$]/.test(source[end] || '')) end += 1
    if (source.slice(index, end) !== property) {
      index = end - 1
      continue
    }

    let cursor = end
    while (/\s/.test(source[cursor] || '')) cursor += 1
    if (source[cursor] !== ':') {
      index = end - 1
      continue
    }
    cursor += 1
    while (/\s/.test(source[cursor] || '')) cursor += 1
    return cursor
  }
  return -1
}

function extractTopLevelObjects(arraySource: string): string[] {
  const objects: string[] = []
  let braces = 0
  let brackets = 0
  let objectStart = -1

  for (let index = 0; index < arraySource.length; index += 1) {
    const char = arraySource[index]
    if (char === '\'' || char === '"') {
      const token = readJsString(arraySource, index)
      if (!token) return objects
      index = token.end - 1
      continue
    }
    if (char === '[') { brackets += 1; continue }
    if (char === ']') { brackets -= 1; continue }
    if (char === '{') {
      if (brackets === 1 && braces === 0) objectStart = index
      braces += 1
      continue
    }
    if (char !== '}') continue
    braces -= 1
    if (brackets === 1 && braces === 0 && objectStart >= 0) {
      objects.push(arraySource.slice(objectStart, index + 1))
      objectStart = -1
    }
  }

  return objects
}

function findMatchingDelimiter(
  source: string,
  start: number,
  open: '{' | '[',
  close: '}' | ']',
): number {
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\'' || char === '"') {
      const token = readJsString(source, index)
      if (!token) return -1
      index = token.end - 1
      continue
    }
    if (char === open) depth += 1
    if (char !== close) continue
    depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function readJsString(source: string, start: number): JsStringToken | null {
  const quote = source[start]
  if (quote !== '\'' && quote !== '"') return null
  let value = ''

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === quote) return { value, end: index + 1 }
    if (char !== '\\') {
      value += char
      continue
    }

    index += 1
    if (index >= source.length) return null
    const escaped = source[index] || ''
    const simpleEscapes: Record<string, string> = {
      b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
      '\\': '\\', '\'': '\'', '"': '"',
    }
    if (escaped in simpleEscapes) {
      value += simpleEscapes[escaped]
      continue
    }
    if (escaped === '\n') continue
    if (escaped === '\r') {
      if (source[index + 1] === '\n') index += 1
      continue
    }
    if (escaped === 'x') {
      const hex = source.slice(index + 1, index + 3)
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null
      value += String.fromCharCode(Number.parseInt(hex, 16))
      index += 2
      continue
    }
    if (escaped === 'u') {
      if (source[index + 1] === '{') {
        const end = source.indexOf('}', index + 2)
        if (end < 0) return null
        const hex = source.slice(index + 2, end)
        if (!/^[0-9A-Fa-f]{1,6}$/.test(hex)) return null
        value += String.fromCodePoint(Number.parseInt(hex, 16))
        index = end
        continue
      }
      const hex = source.slice(index + 1, index + 5)
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return null
      value += String.fromCharCode(Number.parseInt(hex, 16))
      index += 4
      continue
    }
    value += escaped
  }
  return null
}

function decodeHtmlEntities(doc: Document, value: string): string {
  const textarea = doc.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}
