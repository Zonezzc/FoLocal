const GENERIC_TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'spm',
  'from',
  'share_source',
])

const WECHAT_TRACKING_PARAMS = new Set([
  'scene',
  'subscene',
  'clicktime',
  'enterid',
  'sessionid',
  'ascene',
  'fasttmpl_type',
  'fasttmpl_fullversion',
  'fasttmpl_flag',
  'realreporttime',
  'devicetype',
  'version',
  'nettype',
  'lang',
  'countrycode',
  'exportkey',
  'pass_ticket',
  'wx_header',
])

/**
 * 纯函数：把分享/追踪地址规范化为可长期保存的原文地址。
 * 不负责把地址写入文档、属性或历史记录。
 */
export function canonicalizeSourceUrl(input: string): string {
  try {
    const url = new URL(input)
    url.hash = ''
    if (url.hostname.toLowerCase() === 'mp.weixin.qq.com') {
      url.protocol = 'https:'
      url.hostname = 'mp.weixin.qq.com'
      if (/^\/s\/[^/]+/.test(url.pathname)) {
        url.search = ''
      } else {
        removeParams(url, new Set([...GENERIC_TRACKING_PARAMS, ...WECHAT_TRACKING_PARAMS]))
      }
    } else {
      removeParams(url, GENERIC_TRACKING_PARAMS)
    }
    return url.toString()
  } catch {
    return input
  }
}

function removeParams(url: URL, params: Set<string>): void {
  for (const name of Array.from(url.searchParams.keys())) {
    if (params.has(name.toLowerCase())) url.searchParams.delete(name)
  }
}
