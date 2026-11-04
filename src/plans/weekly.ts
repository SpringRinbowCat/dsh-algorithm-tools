/**
 * 训练计划 v4.1：**每周固定一个大方向，具体题目交给「今日训练」现选**。
 *
 * 与旧版（逐日指定题目）的区别：
 * - 周主题由「弱项 gap + 近期过题分布」推出，一周只练一个方向，避免每天换花样；
 * - 计划里的每日任务只排「题量 + 难度区间」，不写死 problemKey（题库每天都在变）；
 * - 完成度靠 icpc_checkin 的任务勾选 / 当日 AC 记录来统计。
 */

import type { IcpcStore } from '../store/index.ts'
import type { PlanInput, PlanTaskInput } from './planService.ts'
import { addDays } from './planService.ts'
import { localDay } from '../workbench-overview.ts'
import { computeWeakness } from '../analysis/weakness.ts'

const DIRECTION_BY_TAG: Record<string, string> = {
  'data structures': '数据结构：前缀和 / 树状数组 / 线段树',
  trees: '树上算法：DFS 序、LCA、子树统计',
  'dfs and similar': '搜索与连通性：DFS/BFS 建模',
  graphs: '图论基础：最短路、拓扑排序、并查集',
  dsu: '图论基础：并查集',
  'binary search': '二分：二分答案与判定函数',
  dp: '动态规划：状态设计与转移',
  bitmasks: '位运算：掩码枚举与贪心配对',
  geometry: '计算几何：向量与叉积',
  strings: '字符串：哈希、KMP、字典树',
  hashing: '字符串：哈希',
  'constructive algorithms': '构造：找不变量与特例',
  sortings: '排序与贪心：排序后扫描',
  greedy: '贪心：交换论证',
  'number theory': '数论：整除、同余、筛法',
  'two pointers': '双指针：单调性维护',
  implementation: '实现：细节与边界',
  'brute force': '暴力与剪枝',
  combinatorics: '组合计数：容斥与组合数',
  games: '博弈：状态与奇偶性',
}

export interface WeekPlan {
  week: number
  startDate: string
  endDate: string
  direction: string
  tags: string[]
  rationale: string
}

export interface WeeklyPlanResult {
  title: string
  goal: string
  level: number
  weeks: WeekPlan[]
  plan: PlanInput
}

function shortDirection(title: string): string {
  const i = title.indexOf('：')
  return i > 0 ? title.slice(0, i) : title
}

/** 近期（默认 28 天）每个 tag 的 AC 题数，用来避免连续几周练同一个方向 */
function recentAcByTag(store: IcpcStore, sinceDays = 28): Map<string, number> {
  const since = localDay(new Date(Date.now() - sinceDays * 86_400_000))
  const map = new Map<string, number>()
  const seen = new Set<string>()
  for (const s of store.getSubmissionRows()) {
    if (s.verdict !== 'AC' || s.submittedAt.slice(0, 10) < since) continue
    const key = `${s.platform}:${s.problemKey}`
    if (seen.has(key)) continue
    seen.add(key)
    for (const tag of s.tags) map.set(tag, (map.get(tag) ?? 0) + 1)
  }
  return map
}

export function buildWeeklyPlan(
  store: IcpcStore,
  opts: { days?: number; startDate?: string } = {},
): WeeklyPlanResult {
  const days = Math.min(90, Math.max(7, opts.days ?? 28))
  const startDate = opts.startDate ?? localDay()
  const weekCount = Math.ceil(days / 7)

  const rows = store.getSubmissionRows()
  const weakness = computeWeakness(rows, { minAttempts: 5, topN: 40 })
  const recent = recentAcByTag(store)

  // 候选方向：gap 大 → 优先级高；最近 28 天练得多的往后排
  const ranked = weakness.items
    .filter((i) => i.gap > 0)
    .map((i) => ({
      tag: i.tag,
      weight: i.gap - (recent.get(i.tag) ?? 0) * 2,
      gap: i.gap,
      attempts: i.attempts,
    }))
    .sort((a, b) => b.weight - a.weight)

  const picked: Array<{ tag: string; gap: number; attempts: number }> = []
  for (const item of ranked) {
    if (picked.length >= weekCount) break
    if (picked.some((p) => p.tag === item.tag)) continue
    picked.push(item)
  }
  // 弱项覆盖不满全部周次时，用通用方向轮转补齐，保证「每周换一个方向」
  const FALLBACK = [
    'implementation', 'greedy', 'binary search', 'sortings', 'dp', 'data structures',
    'trees', 'graphs', 'constructive algorithms', 'two pointers', 'bitmasks', 'strings',
    'number theory', 'geometry',
  ]
  for (let k = 0; picked.length < weekCount; k++) {
    picked.push({ tag: FALLBACK[k % FALLBACK.length], gap: 0, attempts: 0 })
  }

  const diffs = store.getRecentAcDifficulties('1970-01-01').sort((a, b) => a - b)
  const median = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 1200
  const level = Math.round(median / 100) * 100
  const low = Math.max(800, level - 100)
  const high = level + 300

  const weeks: WeekPlan[] = []
  const tasks: PlanTaskInput[] = []
  const usedKeys = new Set<string>()

  /** 某方向的候选题（题库里未做过的，难度落在计划区间），按离区间中心由近到远 */
  const poolFor = (tag: string): Array<{ platform: string; problemKey: string; title: string; url: string | null }> => {
    const center = (low + high) / 2
    return store.browseProblems({ bank: true, tag, limit: 8000 })
      .filter((p) => p.difficulty != null && p.difficulty >= low && p.difficulty <= high && p.attempts === 0)
      .sort((a, b) => Math.abs((a.difficulty ?? 0) - center) - Math.abs((b.difficulty ?? 0) - center))
      .map((p) => ({ platform: p.platform, problemKey: p.problemKey, title: p.title, url: p.url }))
  }

  for (let w = 0; w < weekCount; w++) {
    const pick = picked[w] ?? { tag: 'implementation', gap: 0, attempts: 0 }
    const direction = DIRECTION_BY_TAG[pick.tag] ?? `专项：${pick.tag}`
    const weekStart = addDays(startDate, w * 7)
    const weekEnd = addDays(weekStart, 6)
    const rationale = pick.gap > 0
      ? `${pick.tag} 的 AC 率比你的平均低 ${pick.gap.toFixed(1)} 个百分点（${pick.attempts} 次尝试），这周集中补它。`
      : `巩固 ${pick.tag}：上一轮已经练过，这周用更高一档难度再走一遍。`
    weeks.push({ week: w + 1, startDate: weekStart, endDate: weekEnd, direction, tags: [pick.tag], rationale })

    const pool = poolFor(pick.tag)
    let cursor = 0
    const take = (n: number): typeof pool => {
      const out: typeof pool = []
      while (out.length < n && cursor < pool.length) {
        const p = pool[cursor++]
        const key = `${p.platform}:${p.problemKey}`
        if (usedKeys.has(key)) continue
        usedKeys.add(key)
        out.push(p)
      }
      return out
    }

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d)
      if (date > addDays(startDate, days - 1)) break
      if (d === 6) {
        tasks.push({
          date,
          title: `W${w + 1} 复盘：${shortDirection(direction)} · 回看本周错题`,
          kind: 'review',
          platform: 'codeforces',
          note: '把本周没做出来的题重写一遍；到期复习用 icpc_review list。',
        })
        continue
      }

      const count = 2 + (w > 0 ? 1 : 0)
      const picks = take(count)
      if (picks.length === 0) {
        tasks.push({
          date,
          title: `W${w + 1} ${shortDirection(direction)} · ${count} 题（${low}–${high}）`,
          kind: 'practice',
          platform: 'codeforces',
          note: '题库里这个方向的题不够了，用 icpc_today 现选。',
        })
        continue
      }
      // 一道题一个任务：这样计划里的题能直接计入今日训练完成度
      for (const p of picks) {
        tasks.push({
          date,
          title: `W${w + 1} ${shortDirection(direction)} · ${p.problemKey} ${p.title}`,
          kind: 'practice',
          platform: p.platform,
          problemKey: p.problemKey,
          url: p.url,
          note: `${shortDirection(direction)} · 难度区间 ${low}–${high}`,
        })
      }
    }
  }

  const head = weeks[0]?.direction ?? '基础巩固'
  return {
    title: `${weekCount} 周训练计划 · 每周一个方向`,
    goal: `按周推进：第 1 周「${head}」，之后每周换一个弱项方向。每天题量固定，题目由今日训练按方向现选。`,
    level,
    weeks,
    plan: {
      title: `${weekCount} 周训练计划`,
      goal: `每周一个固定方向，题目在今日训练中现选；难度区间 ${low}–${high}。`,
      startDate,
      endDate: addDays(startDate, days - 1),
      source: 'template',
      weeks: weeks.map((w) => ({ index: w.week, startDate: w.startDate, direction: w.direction, tags: w.tags })),
      tasks,
    },
  }
}
