/**
 * 训练计划快照：GET /icpc-workbench/plan（供面板「计划」视图）
 */

import type { IcpcStore } from './store/index.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { localDay, addDaysLocal } from './util/local-date.ts'

export interface PlanWeekView {
  index: number
  startDate: string
  direction: string
  tags: string[]
  total: number
  checked: number
  done: boolean
}

export interface PlanSnapshot {
  plan: { id: number; title: string; goal: string; startDate: string; endDate: string } | null
  currentWeek: { index: number; direction: string; tags: string[] } | null
  weeks: PlanWeekView[]
  today: { total: number; checked: number } | null
  progress: { checked: number; total: number } | null
  daysLeft: number | null
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000)
}

export function buildPlanSnapshot(store: IcpcStore, todayStr: string): PlanSnapshot {
  const plan = store.getActivePlan(todayStr)
  if (!plan) return { plan: null, currentWeek: null, weeks: [], today: null, progress: null, daysLeft: null }

  const weeks: PlanWeekView[] = (plan.weeks ?? []).map((w) => {
    const end = addDaysLocal(w.startDate, 6)
    const tasks = plan.tasks.filter((t) => t.taskDate >= w.startDate && t.taskDate <= end)
    const checked = tasks.filter((t) => t.checked).length
    return {
      index: w.index, startDate: w.startDate, direction: w.direction, tags: w.tags,
      total: tasks.length, checked, done: tasks.length > 0 && checked === tasks.length,
    }
  })

  const todayTasks = plan.tasks.filter((t) => t.taskDate === todayStr)
  const checkedAll = plan.tasks.filter((t) => t.checked).length
  const focus = store.currentFocus(todayStr)

  return {
    plan: { id: plan.id, title: plan.title, goal: plan.goal, startDate: plan.startDate, endDate: plan.endDate },
    currentWeek: focus ? { index: focus.week, direction: focus.direction, tags: focus.tags } : null,
    weeks,
    today: { total: todayTasks.length, checked: todayTasks.filter((t) => t.checked).length },
    progress: { checked: checkedAll, total: plan.tasks.length },
    daysLeft: Math.max(0, dayDiff(todayStr, plan.endDate)),
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function trustedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  return origin === `http://${host}` || origin === `https://${host}`
}

export function registerPlanRoute(
  ctx: { webServer?: { register: (r: unknown) => () => void }; effect: (fn: () => void | (() => void)) => unknown },
  store: IcpcStore,
): void {
  if (!ctx.webServer) return
  ctx.effect(() => {
    const off = ctx.webServer!.register({
      kind: 'exact',
      path: '/icpc-workbench/plan',
      handler(req: IncomingMessage, res: ServerResponse) {
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET')
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!trustedOrigin(req)) {
          sendJson(res, 403, { ok: false, error: 'origin-not-allowed' })
          return
        }
        try {
          sendJson(res, 200, { ok: true, plan: buildPlanSnapshot(store, localDay()) })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: (e as Error).message })
        }
      },
    })
    return () => off()
  })
}
