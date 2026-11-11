import type { IcpcHost } from '../index.ts'
import type { Context } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT } from './helpers.ts'
import { buildReplay, recentContestIds, isFinalized, type ContestMeta } from '../analysis/replay.ts'
import { scanLocalProblems } from '../util/local-scan.ts'

async function contestMetaMap(host: IcpcHost): Promise<Map<number, ContestMeta>> {
  const map = new Map<number, ContestMeta>()
  try {
    const list = await host.adapters['codeforces'].fetchContests()
    for (const c of list) {
      const id = Number(String(c.id).replace(/^cf-/, ''))
      if (!Number.isFinite(id)) continue
      map.set(id, { name: c.name, startTimeIso: c.startTimeIso, durationMinutes: c.durationMinutes })
    }
  } catch {
    // 拉不到比赛元数据时，复盘仍可用提交数据（只是没有开赛时间）
  }
  return map
}

export function registerReviewTool(host: IcpcHost, ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'icpc_review',
    description:
      'Rank 复盘（间隔复习库已下线，训练质量改由复盘判断）。' +
      'action=contests 列出近期参与过的比赛（按提交聚合，默认最近 30 天）；' +
      'action=contest 复盘单场：每题用时/尝试/失败原因/暴露的薄弱标签，并给本地赛事代码路径。',
    parameters: {
      action: { type: 'string', required: true, enum: ['contests', 'contest'] },
      contestId: { type: 'number', description: '比赛号，如 2283（contest 动作）' },
      days: { type: 'number', description: 'contests 的窗口天数（默认 30）' },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const action = args.action as string

      switch (action) {
        case 'contests': {
          const metas = await contestMetaMap(host)
          const days = Number(args.days) > 0 ? Number(args.days) : 30
          const ids = recentContestIds(store, days)
          const rows = ids
            .map((id) => ({ id, meta: metas.get(id) }))
            .filter((x) => x.meta && isFinalized(x.meta))
            .map(({ id, meta }) => {
              const r = buildReplay(store, id, meta!)
              return {
                contestId: id,
                name: r.name,
                startAt: r.startAt,
                problems: r.summary.problems,
                solved: r.summary.solved,
                attempts: r.summary.attempts,
                weakTags: r.weakTags.slice(0, 3),
              }
            })
          return { ok: true, contests: rows }
        }

        case 'contest': {
          const id = Number(args.contestId)
          if (!Number.isInteger(id)) return { ok: false, error: 'contestId 必填' }
          const metas = await contestMetaMap(host)
          const meta = metas.get(id)
          if (!meta) return { ok: false, error: '未找到比赛 ' + id + ' 的赛程信息（contest.list 里没有）' }
          if (!isFinalized(meta)) return { ok: false, error: '这场还没出分：赛后有 hack 环节，等系统测试结束再复盘' }
          const report = buildReplay(store, id, meta)
          // 本地赛事代码：按题号找到 .cpp，交给模型评估写法/复杂度
          const local = scanLocalProblems(store.getLocalRoot() || undefined).problems
            .filter((p) => report.problems.some((x) => x.problemKey === p.problemKey))
          return { ok: true, report, codeFiles: local.map((p) => ({ problemKey: p.problemKey, file: p.file })) }
        }

        default:
          return { ok: false, error: `未知 action: ${action}` }
      }
    },
  }))
}
