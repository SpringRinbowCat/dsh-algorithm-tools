/**
 * 训练台总览：今日完成度 + 连续打卡 + 每日活动（供客户端日历可视化）。
 * 只读，不写盘。
 */

import type { IcpcStore } from '../store/index.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { computeOverall } from './analysis/stats.ts'
import { computeWeakness } from './analysis/weakness.ts'
import { localDay, addDaysLocal } from './util/local-date.ts'

export interface DayCell {
  date: string
  ac: number
  submissions: number
  tasks: number
  checked: number
  trainingTotal: number
  trainingDone: number
  done: boolean
}

export interface TodayStatus {
  date: string
  /** 今日 AC 总数（所有题，不限于训练题） */
  ac: number
  submissions: number
  tasks: { total: number; checked: number }
  training: {
    total: number
    completed: number
    started: boolean
    done: boolean
    /** 还没 AC 的今日训练题（带可跳转链接），供面板渲染成超链接 */
    remaining: Array<{ problemKey: string; url: string | null }>
  }
  /** 计划里今天的任务题（单独计数，面板显示成「训练 0/6 + 计划 0/2」） */
  planTasks: {
    total: number
    completed: number
    remaining: Array<{ problemKey: string; url: string | null }>
  }
  done: boolean
  advice: { kind: 'catchup' | 'extra'; title: string; items: string[] }
}

export { localDay } from './util/local-date.ts'

function dayKey(iso: string): string {
  return localDay(iso)
}

/** 每天的活动：AC 题数（去重）/ 提交数 / 计划任务 / 今日训练完成度 */
export function buildDayCells(store: IcpcStore, days: number, todayStr: string): DayCell[] {
  const since = addDaysLocal(todayStr, -(days - 1))

  const map = new Map<string, { ac: Set<string>; submissions: number }>()
  for (const s of store.getSubmissionRows()) {
    const day = dayKey(s.submittedAt)
    if (day < since) continue
    const cur = map.get(day) ?? { ac: new Set<string>(), submissions: 0 }
    cur.submissions++
    if (s.verdict === 'AC') cur.ac.add(`${s.platform}:${s.problemKey}`)
    map.set(day, cur)
  }

  const cells: DayCell[] = []
  for (let i = 0; i < days; i++) {
    const date = addDaysLocal(since, i)
    const activity = map.get(date)
    const acSet = activity?.ac ?? new Set<string>()
    const tasks = store.getTasksByDate(date)
    const checked = tasks.filter((t) => t.checked).length
    const index = store.getTrainingIndex(date)
    const trainingDone = index.filter((k) => acSet.has(k)).length
    cells.push({
      date,
      ac: acSet.size,
      submissions: activity?.submissions ?? 0,
      tasks: tasks.length,
      checked,
      trainingTotal: index.length,
      trainingDone,
      // 有训练索引 → 以索引里的题全部 AC 为准；没有索引（历史数据）→ 回退为「当天有 AC」
      done: index.length > 0 ? trainingDone === index.length : acSet.size > 0,
    })
  }
  return cells
}

export function buildTodayStatus(store: IcpcStore, todayStr: string): TodayStatus {
  const cell = buildDayCells(store, 1, todayStr)[0]
  const tasks = store.getTasksByDate(todayStr)
  const pending = tasks.filter((t) => !t.checked)

  const acKeys = store.getAcKeys()
  const index = store.getTrainingIndex(todayStr)
  const completed = index.filter((k) => acKeys.has(k))
  const training = {
    total: index.length,
    completed: completed.length,
    started: completed.length > 0,
    done: index.length > 0 && completed.length === index.length,
  }

  // 计划里今天带题号的任务（v4.1 起计划任务具体到题），单独计数
  const planTaskList = tasks.filter((t) => t.problemKey && t.platform)
  const planRemaining = planTaskList
    .filter((t) => !acKeys.has(`${t.platform}:${t.problemKey}`))
    .map((t) => ({ problemKey: t.problemKey as string, url: t.url ?? null }))
  const planTasks = {
    total: planTaskList.length,
    completed: planTaskList.length - planRemaining.length,
    remaining: planRemaining,
  }
  const planDone = planTaskList.length === 0 || planRemaining.length === 0

  const unresolved: string[] = []
  const seen = new Set<string>()
  for (const s of store.getSubmissionRows()) {
    if (dayKey(s.submittedAt) !== todayStr) continue
    const key = `${s.platform}:${s.problemKey}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!acKeys.has(key)) unresolved.push(s.problemKey)
  }

  if (!training.done || !planDone) {
    const left = index
      .filter((k) => !acKeys.has(k))
      .map((k) => {
        const [platform, problemKey] = k.split(':')
        const problem = store.findProblem(platform as never, problemKey)
        return { problemKey, url: problem?.url ?? null }
      })
    const items: string[] = []
    if (index.length === 0) {
      items.push('今天还没开始训练：点「今日训练」抽出今天的 3 档题')
    } else if (!training.done) {
      items.push(`今日训练还剩 ${left.length} 题`)
    }
    if (!planDone) items.push(`计划任务还剩 ${planRemaining.length} 题：${planRemaining.map((p) => p.problemKey).join('、')}`)
    if (pending.length > 0) items.push(`未完成任务：${pending.slice(0, 3).map((t) => t.title).join('；')}`)
    if (unresolved.length > 0 && !training.done) items.push(`今天试过但没 AC：${unresolved.slice(0, 3).join('、')}`)
    return {
      date: todayStr,
      ac: cell.ac,
      submissions: cell.submissions,
      tasks: { total: tasks.length, checked: tasks.length - pending.length },
      training: { ...training, remaining: left },
      planTasks,
      done: false,
      advice: {
        kind: 'catchup',
        title: index.length === 0 && planTasks.total === 0
          ? '今日未开始'
          : `今日训练 ${completed.length}/${index.length} + 计划 ${planTasks.completed}/${planTasks.total}`,
        items,
      },
    }
  }

  return {
    date: todayStr,
    ac: cell.ac,
    submissions: cell.submissions,
    tasks: { total: tasks.length, checked: tasks.length },
    training: { ...training, remaining: [] },
    planTasks: { ...planTasks, remaining: [] },
    done: true,
    advice: {
      kind: 'extra',
      title: '今日训练完成，可以加训',
      items: [
        `今天 AC 了 ${cell.ac} 题（含训练外），可以再从「今日训练」换一批挑战题`,
        unresolved.length > 0 ? `顺手把没 AC 的 ${unresolved.slice(0, 3).join('、')} 加进复习库` : '把今天的新题型加进复习库（icpc_review add）',
      ],
    },
  }
}

/** 连续打卡：以「当天有 AC」为准，而不是手动勾选 */
export function acStreak(store: IcpcStore, todayStr: string): { current: number; longest: number; totalDays: number } {
  const days = new Set<string>()
  for (const s of store.getSubmissionRows()) {
    if (s.verdict === 'AC') days.add(dayKey(s.submittedAt))
  }
  if (days.size === 0) return { current: 0, longest: 0, totalDays: 0 }
  const toNum = (d: string): number => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 86_400_000)
  const nums = [...days].map(toNum).sort((a, b) => a - b)
  let longest = 1
  let run = 1
  for (let i = 1; i < nums.length; i++) {
    run = nums[i] - nums[i - 1] === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  const set = new Set(nums)
  const today = toNum(todayStr)
  let cursor = set.has(today) ? today : today - 1
  let current = 0
  while (set.has(cursor)) {
    current++
    cursor--
  }
  return { current, longest, totalDays: days.size }
}

export interface StatsSnapshot {
  totals: { attempts: number; ac: number; acRate: number; solvedProblems: number; touched: number }
  byDifficulty: Array<{ bucket: string; attempts: number; ac: number; acRate: number }>
  platforms: Array<{ platform: string; attempts: number; ac: number; acRate: number; solved: number }>
  weakTags: Array<{ tag: string; attempts: number; acRate: number; gap: number }>
}

/** 数据概览（客户端右侧视图用的快照，和 icpc_stats 同源） */
export function buildStats(store: IcpcStore): StatsSnapshot {
  const rows = store.getSubmissionRows()
  const overall = computeOverall(rows)
  const weakness = computeWeakness(rows, { minAttempts: 5, topN: 6 })
  return {
    totals: {
      attempts: overall.attempts,
      ac: overall.ac,
      acRate: overall.acRate,
      solvedProblems: overall.solvedProblems,
      touched: new Set(rows.map((r) => `${r.platform}:${r.problemKey}`)).size,
    },
    byDifficulty: overall.byDifficulty,
    platforms: overall.byPlatform,
    weakTags: weakness.items
      .filter((i) => i.gap > 0)
      .slice(0, 6)
      .map((i) => ({ tag: i.tag, attempts: i.attempts, acRate: i.acRate, gap: i.gap })),
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

export function registerOverviewRoute(ctx: { webServer?: { register: (r: unknown) => () => void }; effect: (fn: () => void | (() => void)) => unknown }, store: IcpcStore): void {
  if (!ctx.webServer) return
  ctx.effect(() => {
    const off = ctx.webServer!.register({
      kind: 'exact',
      path: '/icpc-workbench/overview',
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
          const url = new URL(req.url ?? '/', 'http://localhost')
          const days = Math.min(371, Math.max(7, Number(url.searchParams.get('days') ?? 84) || 84))
          const todayStr = localDay()
          sendJson(res, 200, {
            ok: true,
            today: buildTodayStatus(store, todayStr),
            streak: acStreak(store, todayStr),
            days: buildDayCells(store, days, todayStr),
          })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: (e as Error).message })
        }
      },
    })

    const offStats = ctx.webServer!.register({
      kind: 'exact',
      path: '/icpc-workbench/stats',
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
          sendJson(res, 200, { ok: true, stats: buildStats(store) })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: (e as Error).message })
        }
      },
    })

    return () => {
      off()
      offStats()
    }
  })
}
