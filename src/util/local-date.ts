/** 本地日期工具：插件内部所有「今天」都走这里，避免 UTC 偏移（东八区凌晨会差一天） */

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function localDay(input: string | Date = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function addDaysLocal(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localDay(d)
}
