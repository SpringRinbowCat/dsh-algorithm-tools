import type { IcpcStore } from '../store/index.ts'
import { scanLocalProblems } from './local.ts'

export interface CollectStats {
  scannedRoots: string[]
  localProblems: number
  added: number
  skipped: number
  unknown: number
  notAc: number
  errors: string[]
}

/**
 * 把本地 Codeforces 目录里出现过的题收进复习库：
 * - 题库里有这道题 → 入队（未 AC 的标注「本地 · 待补」）
 * - 题库里没有 → 计入 unknown（通常是还没同步题库）
 * - 已在复习库 → 跳过
 */
export function collectLocalReviews(store: IcpcStore, opts: { root?: string } = {}): CollectStats {
  const { scanned, problems } = scanLocalProblems(opts.root || store.getLocalRoot() || undefined)
  const stats: CollectStats = {
    scannedRoots: scanned.map((s) => s.root),
    localProblems: problems.length,
    added: 0,
    skipped: 0,
    unknown: 0,
    notAc: 0,
    errors: scanned.flatMap((s) => s.errors),
  }

  const acKeys = store.getAcKeys()
  const existing = new Set(store.listReviews(false).map((r) => `${r.platform}:${r.problemKey}`))

  for (const item of problems) {
    const problem = store.findProblem('codeforces', item.problemKey)
    if (!problem) {
      stats.unknown++
      continue
    }
    if (existing.has(`codeforces:${item.problemKey}`)) {
      stats.skipped++
      continue
    }
    const ac = acKeys.has(`codeforces:${item.problemKey}`)
    const review = store.addReview(problem)
    if (!ac) {
      stats.notAc++
      store.updateReview(review.id, { note: `本地文件 · 待补（${item.file}）` })
    }
    existing.add(`codeforces:${item.problemKey}`)
    stats.added++
  }

  return stats
}
