/** 弱项画像（按当前分数以上的已解决题目分布计算） */

import type { WeaknessProfile, WeaknessItem, DifficultyWeakness } from '../types.ts'
import type { SubmissionRow } from '../store/index.ts'
import { bucketForDifficulty, rate, round2 } from './stats.ts'
import { filterNoiseTags } from './tags.ts'

export interface WeaknessOptions {
  minAttempts?: number
  topN?: number
  /** 只统计 difficulty >= 该值的已解决题目；不传则统计全部 */
  minDifficulty?: number
  /** 全部算法标签；用于把从未出现的标签也纳入平均权重 */
  allTags?: string[]
  /** 是否输出从未出现的标签（默认 false） */
  includeUnseenTags?: boolean
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
  const minDifficulty = opts.minDifficulty
  const totalAc = rows.filter((r) => r.verdict === 'AC').length
  const avgAcRate = rate(rows.length, totalAc)

  const tagMap = new Map<string, MutableStat>()
  for (const tag of opts.allTags ?? []) tagMap.set(tag, { attempts: 0, ac: 0 })
  const solvedByTag = new Map<string, Set<string>>()
  const highLevelSolved = new Set<string>()

  for (const r of rows) {
    const isAc = r.verdict === 'AC'
    const key = `${r.platform}:${r.problemKey}`
    const highLevel = isAc && (minDifficulty == null || (r.difficulty != null && r.difficulty >= minDifficulty))
    if (highLevel) highLevelSolved.add(key)

    for (const tag of filterNoiseTags(r.tags)) {
      bump(tagMap, tag, isAc)
      if (highLevel) {
        if (!solvedByTag.has(tag)) solvedByTag.set(tag, new Set())
        solvedByTag.get(tag)!.add(key)
      }
    }
  }

  const allTagNames = [...new Set([...(opts.allTags ?? []), ...tagMap.keys()])]
  const totalHigh = highLevelSolved.size
  const tagWeights = new Map<string, number>()
  for (const tag of allTagNames) {
    tagWeights.set(tag, totalHigh > 0 ? (solvedByTag.get(tag)?.size ?? 0) / totalHigh : 0)
  }
  const avgWeight = allTagNames.length > 0
    ? [...tagWeights.values()].reduce((sum, weight) => sum + weight, 0) / allTagNames.length
    : 0

  const items: WeaknessItem[] = [...tagMap.entries()]
    .map(([tag, s]) => {
      const weight = tagWeights.get(tag) ?? 0
      return {
        tag,
        attempts: s.attempts,
        ac: s.ac,
        acRate: rate(s.attempts, s.ac),
        avgAcRate,
        gap: round2((avgWeight - weight) * 100),
        solved: solvedByTag.get(tag)?.size ?? 0,
        weight,
      }
    })
    .filter((i) => opts.includeUnseenTags || i.attempts >= minAttempts)
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
