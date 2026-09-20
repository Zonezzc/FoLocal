/**
 * 公众号标题推断规则
 *
 * selector: 匹配标题元素的 CSS 选择器
 * textPattern: 可选正则，进一步过滤匹配元素的文本内容
 * level: 转为的 heading 级别
 * mergeNext: 是否合并下一个兄弟元素的文字（编号+标题分开的场景）
 * maxTextLength: 标题文字最大长度（超过则跳过）
 */
export interface HeadingRule {
  selector: string
  textPattern?: string
  level: 'h2' | 'h3'
  mergeNext?: boolean
  maxTextLength?: number
}

export interface AccountConfig {
  biz: string
  name: string
  rules: HeadingRule[]
}
