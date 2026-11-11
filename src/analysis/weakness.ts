/** 弱项画像（移植自原 icpc-workbench，纯函数） */

import type { WeaknessProfile, WeaknessItem, DifficultyWeakness } from '../types.ts'
import type { SubmissionRow } from '../store/index.ts'
import { bucketForDifficulty, rate, round2 } from './stats.ts'
import { filterNoiseTags } from './tags.ts'

export interface WeaknessOptions {
  minAttempts?: number
  topN?: number
}

interface MutableStat {
  attempts: number
  ac: number
}

function bump(map: Map<string, MutableStat>, key: string, isAc: boolean): void {
  const cur = map.get(key) ?? { attempts: 0, ac: 0 }
  cur.attempts += 1
  if (isAc) cur.ac += 1
  map.set(key, cur)
}

export function computeWeakness(rows: SubmissionRow[], opts: WeaknessOptions = {}): WeaknessProfile {
  const minAttempts = opts.minAttempts ?? 5
  const topN = opts.topN ?? 10
  const totalAc = rows.filter((r) => r.verdict === 'AC').length
  const avgAcRate = rate(rows.length, totalAc)

  const tagMap = new Map<string, MutableStat>()
  const solvedByTag = new Map<string, Set<string>>()
  for (const r of rows) {
    const isAc = r.verdict === 'AC'
    for (const tag of filterNoiseTags(r.tags)) {
      bump(tagMap, tag, isAc)
      if (isAc) {
        if (!solvedByTag.has(tag)) solvedByTag.set(tag, new Set())
        solvedByTag.get(tag)!.add(`${r.platform}:${r.problemKey}`)
      }
    }
  }

  const avgSolved = tagMap.size
    ? [...tagMap.keys()].reduce((sum, tag) => sum + (solvedByTag.get(tag)?.size ?? 0), 0) / tagMap.size
    : 0

  const items: WeaknessItem[] = [...tagMap.entries()]
    .map(([tag, s]) => {
      const solved = solvedByTag.get(tag)?.size ?? 0
      return {
        tag,
        attempts: s.attempts,
        ac: s.ac,
        acRate: rate(s.attempts, s.ac),
        avgAcRate,
        gap: round2(avgSolved - solved),
        solved,
      }
    })
    .filter((i) => i.attempts >= minAttempts)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, topN)

  const diffMap = new Map<string, MutableStat>()
  const solvedByDiff = new Map<string, Set<string>>()
  for (const r of rows) {
    const bucket = bucketForDifficulty(r.difficulty)
    bump(diffMap, bucket, r.verdict === 'AC')
    if (r.verdict === 'AC') {
      if (!solvedByDiff.has(bucket)) solvedByDiff.set(bucket, new Set())
      solvedByDiff.get(bucket)!.add(`${r.platform}:${r.problemKey}`)
    }
  }
  const avgSolvedDiff = diffMap.size
    ? [...diffMap.keys()].reduce((sum, bucket) => sum + (solvedByDiff.get(bucket)?.size ?? 0), 0) / diffMap.size
    : 0
  const byDifficulty: DifficultyWeakness[] = [...diffMap.entries()]
    .map(([bucket, s]) => {
      const solved = solvedByDiff.get(bucket)?.size ?? 0
      return {
        bucket,
        attempts: s.attempts,
        ac: s.ac,
        acRate: rate(s.attempts, s.ac),
        gap: round2(avgSolvedDiff - solved),
        solved,
      }
    })
    .filter((i) => i.attempts >= minAttempts)
    .sort((a, b) => b.gap - a.gap)

  return { items, byDifficulty, generatedAt: new Date().toISOString() }
}
