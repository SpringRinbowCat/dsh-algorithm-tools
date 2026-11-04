import type { TodayBandKey } from '../types.ts'
import type { IcpcHost } from '../index.ts'
import type { Context, ToolDefinition } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT, num } from './helpers.ts'
import { computeWeakness } from '../analysis/weakness.ts'
import { localDay } from '../util/local-date.ts'
import { replayTagScores, type ContestMeta } from '../analysis/replay.ts'
import { bandRanges, estimateLevel, pickBand, type CandidateProblem } from '../analysis/today.ts'

const DEFAULT_COUNTS: Record<TodayBandKey, number> = { consolidation: 2, core: 3, challenge: 1 }
const BAND_KEYS: TodayBandKey[] = ['consolidation', 'core', 'challenge']

export function registerTodayTool(host: IcpcHost, ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'icpc_today',
    description:
      '获取今日三档训练推荐。系统根据近期 AC 难度中位数估算能力值，' +
      '按巩固区/同段区/挑战区三档推荐题目，弱项标签优先。' +
      '同时返回到期复习数和今日计划进度。',
    parameters: {
      consolidation: { type: 'number', description: '巩固区题量（默认 2）' },
      core: { type: 'number', description: '同段区题量（默认 3）' },
      challenge: { type: 'number', description: '挑战区题量（默认 1）' },
      rotate: { type: 'number', description: '换一批偏移量' },
      windowDays: { type: 'number', description: '能力值窗口天数（默认 60）' },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const todayStr = localDay()
      const windowDays = num(args.windowDays, 60, 7, 365)
      const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

      // 能力值
      let recentDiffs = store.getRecentAcDifficulties(since)
      if (recentDiffs.length < 5) recentDiffs = store.getRecentAcDifficulties('1970-01-01')
      const level = estimateLevel(recentDiffs)

      // 计划里今天已经指派了题的话，今日三档不再重复抽它们（否则 0/6 + 0/2 会重题）
      const planKeys = new Set(
        store.getTasksByDate(todayStr)
          .filter((t) => t.problemKey && t.platform)
          .map((t) => String(t.platform) + ':' + String(t.problemKey)),
      )

      // 候选题
      const candidates: CandidateProblem[] = store.getUnsolvedCandidates()
        .filter((p) => !planKeys.has(p.platform + ':' + p.problemKey))
        .map((p) => ({
        id: p.id,
        platform: p.platform,
        problemKey: p.problemKey,
        title: p.title,
        difficulty: p.difficulty,
        url: p.url,
        tags: p.tags,
      }))

      // 历史弱项（占 50% 权重）
      const rows = store.getSubmissionRows()
      const weakness = computeWeakness(rows, { minAttempts: 5, topN: 15 })
      const weakItems = weakness.items.filter((i) => i.gap > 0)
      const weakTags = weakItems.map((i) => i.tag)

      // 最近比赛复盘（占另外 50%）：最近 3 场里没做出/多次提交的标签
      const metaMap = new Map<number, ContestMeta>()
      try {
        for (const c of await host.adapters['codeforces'].fetchContests()) {
          const id = Number(String(c.id).replace(/^cf-/, ''))
          if (Number.isFinite(id)) {
            metaMap.set(id, { name: c.name, startTimeIso: c.startTimeIso, durationMinutes: c.durationMinutes })
          }
        }
      } catch { /* 拉不到比赛元数据就只用历史弱项 */ }
      const replayScores = replayTagScores(store, (id) => metaMap.get(id) ?? null)

      // 两路归一化后各占 50%
      const maxGap = Math.max(1, ...weakItems.map((i) => i.gap))
      const tagScores = new Map<string, number>()
      for (const [tag, v] of replayScores) tagScores.set(tag, 0.5 * v)
      for (const i of weakItems) {
        tagScores.set(i.tag, (tagScores.get(i.tag) ?? 0) + 0.5 * (i.gap / maxGap))
      }

      // 本周计划方向（v4.1）：命中的题优先
      const focus = store.currentFocus(todayStr)
      const focusTags = focus?.tags ?? []

      // 逐档选题
      const ranges = bandRanges(level)
      const rotate = num(args.rotate, 0, 0, 500)
      const exclude = new Set<number>()
      const bands = BAND_KEYS.map((key) => {
        const q = Number(args[key])
        const count = Number.isInteger(q) && q >= 0 && q <= 6 ? q : DEFAULT_COUNTS[key]
        const picked = pickBand(candidates, ranges[key], count, weakTags, exclude, rotate, focusTags, tagScores)
        for (const p of picked.problems) exclude.add(p.id)
        return {
          key, label: ranges[key].label, description: ranges[key].description,
          range: [ranges[key].min, ranges[key].max] as [number | null, number | null],
          problems: picked.problems, pool: picked.pool,
        }
      })

      // 把今天抽到的题记为「今日训练索引」：日历完成度与红点都以它判定
      const indexed = bands.flatMap((b) => b.problems.map((p) => `${p.platform}:${p.problemKey}`))
      if (indexed.length > 0) store.setTrainingIndex(todayStr, indexed)

      // 到期复习 + 计划进度
      const dueReviews = store.getDueCount()
      const tasks = store.getTasksByDate(todayStr)
      const checked = tasks.filter((t) => t.checked).length
      const planProblems = tasks
        .filter((t) => t.problemKey && t.platform)
        .map((t) => ({ problemKey: t.problemKey, url: t.url ?? null, title: t.title }))

      return {
        ok: true,
        data: {
          date: todayStr, level, bands, dueReviews,
          focus: focus ? { week: focus.week, direction: focus.direction, tags: focus.tags } : null,
          planProblems,
          planProgress: tasks.length > 0 ? { total: tasks.length, checked } : null,
        },
      }
    },
    presentCall: () => ({ card: 'generic', title: '今日训练推荐' }),
  }))
}
