const chineseMonths = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"]
const englishMonths = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** Some publishers localize RFC 822 dates instead of using English month names. */
export const parseFeedDate = (value: string | null): string | null => {
  if (!value?.trim()) return null
  const normalized = value
    .trim()
    .replace(/^(?:週|周|星期)[一二三四五六日天],?\s*/, "")
    .replace(
      /(十一|十二|[十一二三四五六七八九])月/g,
      (_, month: string) => englishMonths[chineseMonths.indexOf(month)]!,
    )
  const timestamp = Date.parse(normalized)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

export const entryPublishedAt = (dates: (string | null)[], fallback: string): string => {
  for (const date of dates) {
    const parsed = parseFeedDate(date)
    if (parsed) return parsed
  }
  return fallback
}
