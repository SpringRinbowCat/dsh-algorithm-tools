/**
 * 训练计划工具函数：保留导入计划所需的 JSON 解析与日期工具。
 */

import type { PlatformId } from '../types.ts'
import { localDay } from '../util/local-date.ts'

export const TASK_KINDS = ['practice', 'review', 'topic', 'contest'] as readonly string[]

export interface PlanTaskInput {
  date: string
  title: string
  kind?: string
  platform?: PlatformId
  problemKey?: string
  url?: string
  note?: string
}

export interface PlanInput {
  title: string
  goal: string
  startDate: string
  days: number
  tasks: PlanTaskInput[]
}

// ---------- Date helpers ----------

export function today(): string {
  return localDay()
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ---------- Plan JSON parsing ----------

export function parsePlanJson(raw: string, startDate: string, days: number): PlanInput {
  let text = raw.trim()
  if (text.includes('```')) text = text.replace(/```[a-zA-Z]*\s*/g, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) text = text.slice(start, end + 1)
  let obj: { title?: unknown; goal?: unknown; tasks?: unknown }
  try {
    obj = JSON.parse(text) as typeof obj
  } catch (e) {
    try {
      obj = JSON.parse(text.replace(/,\s*([}\]])/g, '$1')) as typeof obj
    } catch {
      throw new Error(`AI 输出不是合法 JSON: ${(e as Error).message}`)
    }
  }
  if (typeof obj.title !== 'string' || !obj.title.trim()) throw new Error('AI 输出缺少 title')
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) throw new Error('AI 输出缺少 tasks')
  const startMs = Date.parse(`${startDate}T00:00:00Z`)
  const endMs = startMs + (days - 1) * 86_400_000
  const inRange = (d: string): boolean => {
    const ms = Date.parse(`${d}T00:00:00Z`)
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs
  }
  const tasks = (obj.tasks as unknown[])
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .filter((t) => typeof t.title === 'string' && t.title.trim() && typeof t.date === 'string')
    .filter((t) => inRange(t.date as string))
    .map((t) => ({
      date: t.date as string,
      title: t.title as string,
      kind: (TASK_KINDS as readonly string[]).includes(t.kind as string) ? (t.kind as string) : 'practice',
      platform: t.platform as PlatformId | undefined,
      problemKey: t.problemKey as string | undefined,
      url: t.url as string | undefined,
      note: t.note as string | undefined,
    }))
  if (tasks.length === 0) throw new Error('AI 输出 tasks 中没有有效任务')
  return { title: obj.title, goal: typeof obj.goal === 'string' ? obj.goal : '', startDate, days, tasks }
}
