/**
 * Rank 复盘：按比赛聚合提交，算出每题用时、失败原因、暴露的薄弱标签。
 *
 * 数据全部来自已同步的提交（CF user.status），不需要额外接口；
 * 比赛名/开始时间由调用方（工具层）用 contest.list 补齐。
 */

import type { IcpcStore } from '../store/index.ts'

export interface ContestMeta {
  name: string
  startTimeIso: string | null
  durationMinutes: number
}

export interface ReplayProblem {
  problemKey: string
  index: string
  attempts: number
  verdicts: string[]
  firstAt: string | null
  solvedAt: string | null
  /** 从开赛到首次提交 / 到 AC 的分钟数 */
  firstMinutes: number | null
  solvedMinutes: number | null
  difficulty: number | null
  tags: string[]
  solved: boolean
  /** 未通过的主要原因（按出现次数排序） */
  failReasons: string[]
}

/** 赛后 60 分钟（黑盒 hack + 系统测试）后才算「出分」，此前不允许复盘 */
export function isFinalized(meta: ContestMeta, now = Date.now()): boolean {
  if (!meta.startTimeIso) return false
  const end = new Date(meta.startTimeIso).getTime() + meta.durationMinutes * 60_000
  return now >= end + 60 * 60_000
}

export interface ReplayReport {
  contestId: number
  name: string
  startAt: string | null
  durationMinutes: number
  problems: ReplayProblem[]
  summary: { problems: number; solved: number; attempts: number; solvedMinutes: number }
  weakTags: Array<{ tag: string; weight: number }>
}

/** 从 problemKey 推出比赛号：2283C → 2283，1858E1 → 1858 */
export function contestIdOf(problemKey: string): number | null {
  const m = /^(\d{3,6})([A-Z]\d?)$/.exec(problemKey)
  return m ? Number(m[1]) : null
}

function minutesBetween(startIso: string, atIso: string): number {
  return Math.max(0, Math.round((new Date(atIso).getTime() - new Date(startIso).getTime()) / 60_000))
}

/** 最近 days 天内有过提交的比赛号（按最近提交时间倒序） */
export function recentContestIds(store: IcpcStore, days = 30): number[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const seen = new Map<number, string>()
  for (const s of store.getSubmissionRows()) {
    if (s.platform !== 'codeforces' || s.submittedAt < since) continue
    const id = contestIdOf(s.problemKey)
    if (id === null) continue
    const prev = seen.get(id)
    if (!prev || s.submittedAt > prev) seen.set(id, s.submittedAt)
  }
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id)
}

export function buildReplay(store: IcpcStore, contestId: number, meta: ContestMeta): ReplayReport {
  const byKey = new Map<string, { verdicts: string[]; times: string[] }>()
  for (const s of store.getSubmissionRows()) {
    if (s.platform !== 'codeforces') continue
    if (contestIdOf(s.problemKey) !== contestId) continue
    const cur = byKey.get(s.problemKey) ?? { verdicts: [], times: [] }
    cur.verdicts.push(s.verdict)
    cur.times.push(s.submittedAt)
    byKey.set(s.problemKey, cur)
  }

  const startIso = meta.startTimeIso
  const problems: ReplayProblem[] = []
  for (const [problemKey, data] of byKey) {
    const problem = store.findProblem('codeforces', problemKey)
    const ordered = data.verdicts
      .map((v, i) => ({ v, t: data.times[i] }))
      .sort((a, b) => a.t.localeCompare(b.t))
    const times = ordered.map((o) => o.t)
    const solvedAt = ordered.find((o) => o.v === 'AC')?.t ?? null
    const failCounts = new Map<string, number>()
    for (const o of ordered) {
      if (o.v === 'AC') continue
      failCounts.set(o.v, (failCounts.get(o.v) ?? 0) + 1)
    }
    problems.push({
      problemKey,
      index: problemKey.replace(/^\d+/, ''),
      attempts: ordered.length,
      verdicts: ordered.map((o) => o.v),
      firstAt: times[0] ?? null,
      solvedAt,
      firstMinutes: startIso && times[0] ? minutesBetween(startIso, times[0]) : null,
      solvedMinutes: startIso && solvedAt ? minutesBetween(startIso, solvedAt) : null,
      difficulty: problem?.difficulty ?? null,
      tags: problem?.tags ?? [],
      solved: solvedAt !== null,
      failReasons: [...failCounts.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}×${n}`),
    })
  }

  problems.sort((a, b) => (a.firstMinutes ?? 1e9) - (b.firstMinutes ?? 1e9))

  // 薄弱标签：没做出来的标签权重 2，做出来但提交 ≥3 次的权重 1
  const weights = new Map<string, number>()
  for (const p of problems) {
    const w = !p.solved ? 2 : p.attempts >= 3 ? 1 : 0
    if (w === 0) continue
    for (const tag of p.tags) weights.set(tag, (weights.get(tag) ?? 0) + w)
  }

  return {
    contestId,
    name: meta.name,
    startAt: meta.startTimeIso,
    durationMinutes: meta.durationMinutes,
    problems,
    summary: {
      problems: problems.length,
      solved: problems.filter((p) => p.solved).length,
      attempts: problems.reduce((n, p) => n + p.attempts, 0),
      solvedMinutes: problems.reduce((n, p) => n + (p.solvedMinutes ?? 0), 0),
    },
    weakTags: [...weights.entries()].map(([tag, weight]) => ({ tag, weight })).sort((a, b) => b.weight - a.weight),
  }
}

/** 最近几场比赛暴露的标签分数（归一化到 0..1），供今日训练与历史弱项各占 50% 融合 */
export function replayTagScores(store: IcpcStore, metaOf: (id: number) => ContestMeta | null, opts: { days?: number; contests?: number } = {}): Map<string, number> {
  const ids = recentContestIds(store, opts.days ?? 30)
    .map((id) => ({ id, meta: metaOf(id) }))
    .filter((x): x is { id: number; meta: ContestMeta } => x.meta !== null && isFinalized(x.meta))
    .sort((a, b) => (b.meta.startTimeIso ?? '').localeCompare(a.meta.startTimeIso ?? ''))
    .slice(0, opts.contests ?? 3)
    .map((x) => x.id)
  const raw = new Map<string, number>()
  for (const id of ids) {
    const meta = metaOf(id)
    if (!meta) continue
    const report = buildReplay(store, id, meta)
    for (const w of report.weakTags) raw.set(w.tag, (raw.get(w.tag) ?? 0) + w.weight)
  }
  const max = Math.max(1, ...raw.values())
  const out = new Map<string, number>()
  for (const [tag, v] of raw) out.set(tag, v / max)
  return out
}
