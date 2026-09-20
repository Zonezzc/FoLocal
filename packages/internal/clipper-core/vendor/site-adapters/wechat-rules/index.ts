import type { AccountConfig, HeadingRule } from './types'
import { ggGithub } from './gg-github'
import { shengcai } from './shengcai'

/** 所有公众号规则，按 biz 索引 */
const allRules: AccountConfig[] = [
  ggGithub,
  shengcai,
]

const ruleMap = new Map<string, AccountConfig>(
  allRules.map(r => [r.biz, r]),
)

/** 根据 biz 查找公众号规则 */
export function getAccountRules(biz: string): AccountConfig | undefined {
  return ruleMap.get(biz)
}

/** 找到下一个非空的兄弟元素 */
function nextNonEmptySibling(el: Element): Element | null {
  let sib = el.nextElementSibling
  while (sib && !sib.textContent?.trim()) {
    sib = sib.nextElementSibling
  }
  return sib
}

/** 根据公众号规则推断标题 */
export function applyHeadingRules(wrapper: HTMLElement, rules: HeadingRule[]) {
  const processed = new Set<Element>()

  for (const rule of rules) {
    const pattern = rule.textPattern ? new RegExp(rule.textPattern) : null

    wrapper.querySelectorAll(rule.selector).forEach((el) => {
      if (processed.has(el)) return

      const text = el.textContent?.trim() || ''
      if (!text || text.length > (rule.maxTextLength || 80)) return

      // 文本模式过滤
      if (pattern && !pattern.test(text)) return

      // 跳过包含匹配子元素的容器
      if (el.querySelector(rule.selector)) return

      // 找到最近的块级容器
      // p 优先，但如果 p 是父 section 的唯一子元素，用 section（因为副标题是 section 的兄弟）
      let container = el.closest('p') || el.closest('section')
      if (!container || !container.parentElement) return
      const parent = container.parentElement
      if (container.tagName === 'P' && parent.tagName === 'SECTION' && parent.children.length === 1) {
        container = parent
      }
      if (processed.has(container)) return
      processed.add(container)

      const parts: string[] = [container.textContent?.trim() || '']

      // 合并下一个非空兄弟元素的文字
      if (rule.mergeNext) {
        const nextSib = nextNonEmptySibling(container)
        if (
          nextSib
          && !nextSib.querySelector('img, ul, ol, pre, table')
        ) {
          const nextText = nextSib.textContent?.trim() || ''
          if (nextText && nextText.length <= 60) {
            parts.push(nextText)
            processed.add(nextSib)
            nextSib.remove()
          }
        }
      }

      const headingText = parts.filter(Boolean).join(' ')
      if (!headingText) return

      const heading = wrapper.ownerDocument.createElement(rule.level)
      heading.textContent = headingText
      container.replaceWith(heading)
    })
  }
}

export type { AccountConfig, HeadingRule } from './types'
