/** 今日训练选题（移植自原 icpc-workbench，纯函数） */

import type { TodayBandKey, TodayProblem } from '../types.ts'

export interface CandidateProblem {
  id: number
  platform: string
  problemKey: string
  title: string
  difficulty: number | null
  url: string | null
  tags: string[]
}

export interface BandRange {
  key: TodayBandKey
  label: string
  description: string
  min: number | null
  max: number | null
  center: number | null
}

export const BAND_LABELS: Record<TodayBandKey, { label: string; description: string }> = {
  consolidation: { label: '巩固区', description: '略低于当前水平，练稳定性和手感' },
  core: { label: '同段区', description: '贴合当前水平，每天最主要的能力训练' },
  challenge: { label: '挑战区', description: '略高于当前水平，试探新的上限' },
}

export function bandRanges(level: number): Record<TodayBandKey, BandRange> {
  return {
    consolidation: {
      ...BAND_LABELS.consolidation, key: 'consolidation',
      min: level - 200, max: level - 1, center: level - 100,
    },
    core: {
      ...BAND_LABELS.core, key: 'core',
      min: level, max: level + 200, center: level + 100,
    },
    challenge: {
      ...BAND_LABELS.challenge, key: 'challenge',
      min: level + 201, max: level + 400, center: level + 300,
    },
  }
}

export function estimateLevel(acDifficulties: number[], fallback = 1200): number {
  const xs = acDifficulties.filter((d) => Number.isFinite(d)).sort((a, b) => a - b)
  if (xs.length === 0) return fallback
  const mid = Math.floor(xs.length / 2)
  const median = xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2)
  return Math.round(median / 100) * 100
}

function weakOverlap(tags: string[], weakTags: string[]): string[] {
  const weak = new Set(weakTags)
  return tags.filter((t) => weak.has(t))
}

export function pickBand(
  candidates: CandidateProblem[],
  band: BandRange,
  count: number,
  weakTags: string[],
  excludeIds: Set<number>,
  rotate = 0,
  focusTags: string[] = [],
  tagScores?: Map<string, number>,
): { problems: TodayProblem[]; pool: number } {
  const inBand = candidates.filter(
    (c) =>
      c.difficulty != null &&
      band.min != null &&
      band.max != null &&
      c.difficulty >= band.min &&
      c.difficulty <= band.max &&
      !excludeIds.has(c.id),
  )
  const focus = new Set(focusTags)
  const scoreOf = (tags: string[]): number =>
    tagScores ? tags.reduce((s, t) => s + (tagScores.get(t) ?? 0), 0) : 0
  const ordered = inBand
    .map((c) => ({ c, weak: weakOverlap(c.tags, weakTags), focus: c.tags.filter((t) => focus.has(t)) }))
    .sort(
      (a, b) =>
        // 本周计划方向优先，其次「历史弱项 50% + 最近比赛复盘 50%」的加权标签分
        b.focus.length * 2 + scoreOf(b.c.tags) - (a.focus.length * 2 + scoreOf(a.c.tags)) ||
        Math.abs((a.c.difficulty ?? 0) - (band.center ?? 0)) -
          Math.abs((b.c.difficulty ?? 0) - (band.center ?? 0)) ||
        a.c.id - b.c.id,
    )
  const start = ordered.length ? rotate % ordered.length : 0
  const picked = [...ordered.slice(start), ...ordered.slice(0, start)].slice(0, count)
  return {
    pool: inBand.length,
    problems: picked.map(({ c, weak, focus: hit }) => ({
      id: c.id,
      platform: c.platform as TodayProblem['platform'],
      problemKey: c.problemKey,
      title: c.title,
      difficulty: c.difficulty,
      url: c.url,
      tags: c.tags,
      weakTags: hit.length > 0 ? [...new Set([...hit, ...weak])] : weak,
    })),
  }
}

// ---------------------------------------------------------------------------
// 能力值估算：近 N 天刷题数据 + 比赛数据（不使用 rating）
// ---------------------------------------------------------------------------

export interface LevelEstimate {
  /** 综合能力值（取整到 100） */
  level: number
  /** 刷题侧：近窗口内 AC 难度中位数 */
  practiceLevel: number | null
  /** 比赛侧：近窗口内比赛中 AC 的题目难度中位数 */
  contestLevel: number | null
  practiceCount: number
  contestCount: number
}

function medianRounded(xs: number[]): number | null {
  const arr = xs.filter((d) => Number.isFinite(d)).sort((a, b) => a - b)
  if (arr.length === 0) return null
  const mid = Math.floor(arr.length / 2)
  const median = arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2)
  return Math.round(median / 100) * 100
}

/**
 * 刷题 60% + 比赛 40% 加权；某一侧没有数据时退化为另一侧。
 * 两边都没有才回落到 fallback（默认 1200）。
 */
export function estimateLevelDetail(
  practiceDiffs: number[],
  contestDiffs: number[],
  fallback = 1200,
): LevelEstimate {
  const practiceLevel = medianRounded(practiceDiffs)
  const contestLevel = medianRounded(contestDiffs)
  let level: number
  if (practiceLevel != null && contestLevel != null) {
    level = Math.round((practiceLevel * 0.6 + contestLevel * 0.4) / 100) * 100
  } else if (practiceLevel != null) {
    level = practiceLevel
  } else if (contestLevel != null) {
    level = contestLevel
  } else {
    level = fallback
  }
  return {
    level,
    practiceLevel,
    contestLevel,
    practiceCount: practiceDiffs.length,
    contestCount: contestDiffs.length,
  }
}

/** 按难度落到三档里；难度未知时归到同段区 */
export function bandForDifficulty(level: number, difficulty: number | null): TodayBandKey {
  if (difficulty == null) return 'core'
  const ranges = bandRanges(level)
  const order: TodayBandKey[] = ['consolidation', 'core', 'challenge']
  for (const key of order) {
    const b = ranges[key]
    if (b.min != null && b.max != null && difficulty >= b.min && difficulty <= b.max) return key
  }
  const boundary = ranges.consolidation.min ?? level
  return difficulty < boundary ? 'consolidation' : 'challenge'
}

// ---------------------------------------------------------------------------
// 今日训练 Markdown（写进 practice/<日期>/<日期>.md，随仓库同步）
// ---------------------------------------------------------------------------

export interface TodayMdProblem extends TodayProblem {
  reason: string
}

export interface TodayMdBand {
  key: TodayBandKey
  label: string
  description: string
  range: [number | null, number | null]
  problems: TodayMdProblem[]
}

export interface TodayMdInput {
  date: string
  level: LevelEstimate
  windowDays: number
  /** true = 本目录已有题目，按本地文件锁定，不再重新抽题 */
  locked: boolean
  mdPath: string
  focus: { week: number; direction: string; tags: string[] } | null
  bands: TodayMdBand[]
}

function fmtRange(range: [number | null, number | null]): string {
  if (range[0] == null || range[1] == null) return '不限'
  return `${range[0]}–${range[1]}`
}

export function renderTodayMarkdown(input: TodayMdInput): string {
  const { level } = input
  const parts: string[] = []
  parts.push(`# ${input.date} 今日训练`)
  parts.push('')

  const sources = [
    level.practiceLevel != null ? `刷题 ${level.practiceLevel}` : '刷题 数据不足',
    level.contestLevel != null ? `比赛 ${level.contestLevel}` : '比赛 数据不足',
  ].join(' · ')
  parts.push(`- **能力值**：${level.level}（${sources}）`)
  parts.push(
    `- **口径**：近 ${input.windowDays} 天 AC 难度中位数（刷题 60%）+ 近 ${input.windowDays} 天比赛中 AC 难度中位数（比赛 40%），不使用 rating`,
  )
  parts.push(
    input.locked
      ? `- **题目来源**：本地已锁定（该日期目录下已有题目，多设备共用这份，不再重新抽题）`
      : `- **题目来源**：本次新抽取（该日期目录下还没有题目）`,
  )
  if (input.focus) {
    parts.push(`- **本周方向**：W${input.focus.week} · ${input.focus.direction}（${input.focus.tags.join(', ')}）`)
  }
  parts.push('')

  for (const band of input.bands) {
    parts.push(`## ${band.label}（${fmtRange(band.range)}）`)
    parts.push('')
    parts.push(`> ${band.description}`)
    parts.push('')
    if (band.problems.length === 0) {
      parts.push('_本档暂无推荐_')
      parts.push('')
      continue
    }
    parts.push('| 题号 | 难度 | 标签 | 选题理由 |')
    parts.push('|---|---|---|---|')
    for (const p of band.problems) {
      const title = p.url ? `[${p.problemKey}](${p.url})` : p.problemKey
      const tags = p.tags.slice(0, 4).join(', ') || '—'
      parts.push(`| ${title} | ${p.difficulty ?? '?'} | ${tags} | ${p.reason} |`)
    }
    parts.push('')
  }

  parts.push('---')
  parts.push('')
  parts.push('<!-- 由 icpc_today 生成；改动会在下次生成时被覆盖 -->')
  return parts.join('\n')
}
