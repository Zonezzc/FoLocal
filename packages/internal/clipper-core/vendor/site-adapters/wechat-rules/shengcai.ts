import type { AccountConfig } from './types'

/** 生财有术 —— "<strong>Part 1</strong>" + 下一个 <p> 副标题 */
export const shengcai: AccountConfig = {
  biz: 'Mzg5MTkwNjUxNQ==',
  name: '生财有术',
  rules: [
    { selector: 'p > strong', textPattern: '^Part \\d+$', level: 'h2', mergeNext: true, maxTextLength: 40 },
    { selector: 'p', textPattern: '^0[1-9]$', level: 'h3', mergeNext: true, maxTextLength: 4 },
  ],
}
