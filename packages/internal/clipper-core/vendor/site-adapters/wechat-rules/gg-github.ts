import type { AccountConfig } from './types'

/** 逛逛GitHub —— "01"(36px) + 下一个 section 是标题文字 */
export const ggGithub: AccountConfig = {
  biz: 'MzUxNjg4NDEzNA==',
  name: '逛逛GitHub',
  rules: [
    { selector: 'span', textPattern: '^0[1-9]$', level: 'h2', mergeNext: true, maxTextLength: 4 },
  ],
}
