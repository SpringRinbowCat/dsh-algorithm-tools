/**
 * 训练台总览：今日完成度 + 连续打卡 + 每日活动（供客户端日历可视化）。
 * 只读，不写盘。
 */

import type { IcpcStore } from './store/index.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { computeOverall } from './analysis/stats.ts'
import { computeWeakness } from './analysis/weakness.ts'
import { localDay, addDaysLocal } from './util/local-date.ts'

export interface DayCell {
  date: string
  ac: number
  submissions: number
  trainingTotal: number
  trainingDone: number
  done: boolean
}

export interface TodayStatus {
  date: string
  /** 今日 AC 总数（所有题，不限于训练题） */
  ac: number
  submissions: number
  training: {
    total: number
    completed: number
    started: boolean
    done: boolean
    /** 还没 AC 的今日训练题（带可跳转链接），供面板渲染成超链接 */
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
    const index = store.getTrainingIndex(date)
    const trainingDone = index.filter((k) => acSet.has(k)).length
    cells.push({
      date,
      ac: acSet.size,
      submissions: activity?.submissions ?? 0,
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

  const acKeys = store.getAcKeys()
  const index = store.getTrainingIndex(todayStr)
  const completed = index.filter((k) => acKeys.has(k))
  const training = {
    total: index.length,
    completed: completed.length,
    started: completed.length > 0,
    done: index.length > 0 && completed.length === index.length,
  }

  const unresolved: string[] = []
  const seen = new Set<string>()
  for (const s of store.getSubmissionRows()) {
    if (dayKey(s.submittedAt) !== todayStr) continue
    const key = `${s.platform}:${s.problemKey}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!acKeys.has(key)) unresolved.push(s.problemKey)
  }

  if (!training.done) {
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
    if (unresolved.length > 0 && !training.done) items.push(`今天试过但没 AC：${unresolved.slice(0, 3).join('、')}`)
    return {
      date: todayStr,
      ac: cell.ac,
      submissions: cell.submissions,
      training: { ...training, remaining: left },
      done: false,
      advice: {
        kind: 'catchup',
        title: index.length === 0
          ? '今日未开始'
          : `今日训练 ${completed.length}/${index.length}`,
        items,
      },
    }
  }

  return {
    date: todayStr,
    ac: cell.ac,
    submissions: cell.submissions,
    training: { ...training, remaining: [] },
    done: true,
    advice: {
      kind: 'extra',
      title: '今日训练完成',
      items: [],
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
  rating: number | null
  totals: { attempts: number; ac: number; acRate: number; solvedProblems: number; touched: number }
  byDifficulty: Array<{ bucket: string; attempts: number; ac: number; acRate: number; solved: number; score: number }>
  platforms: Array<{ platform: string; attempts: number; ac: number; acRate: number; solved: number }>
  byTag: Array<{ tag: string; solved: number; weight: number; gap: number }>
}

/** 数据概览（客户端右侧视图用的快照，和 icpc_stats 同源） */
export function buildStats(store: IcpcStore, level?: number | null, rating?: number | null): StatsSnapshot {
  const rows = store.getSubmissionRows()
  const overall = computeOverall(rows)
  const allTags = store.getAllTags()
  const weakness = computeWeakness(rows, {
    minAttempts: 5,
    topN: allTags.length + 10,
    minDifficulty: level ?? undefined,
    allTags,
    includeUnseenTags: true,
  })
  return {
    rating: rating ?? null,
    totals: {
      attempts: overall.attempts,
      ac: overall.ac,
      acRate: overall.acRate,
      solvedProblems: overall.solvedProblems,
      touched: new Set(rows.map((r) => `${r.platform}:${r.problemKey}`)).size,
    },
    byDifficulty: overall.byDifficulty,
    byTag: weakness.items
      .slice()
      .sort((a, b) => b.solved - a.solved || a.tag.localeCompare(b.tag))
      .map((i) => ({
        tag: i.tag,
        solved: i.solved,
        weight: i.weight,
        gap: i.gap,
      })),
    platforms: overall.byPlatform,
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

export function registerOverviewRoute(ctx: { webServer?: { register: (r: unknown) => () => void }; effect: (fn: () => void | (() => void)) => unknown }, store: IcpcStore, getProfile?: () => Promise<{ level: number | null; rating: number | null }>): void {
  if (!ctx.webServer) return
  ctx.effect(() => {
    const off = ctx.webServer!.register({
      kind: 'exact',
      path: '/icpc-workbench/overview',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
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
      handler: async (req: IncomingMessage, res: ServerResponse) => {
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
          const profile = getProfile
            ? await getProfile().catch(() => ({ level: null, rating: null }))
            : { level: null, rating: null }
          sendJson(res, 200, { ok: true, stats: buildStats(store, profile.level, profile.rating) })
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
