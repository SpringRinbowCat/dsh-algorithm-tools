import type { IcpcHost } from '../index.ts'
import type { Context, ToolDefinition } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT } from './helpers.ts'
import { scheduleNext, intervalDaysForStage } from '../reviews/schedule.ts'
import { collectLocalReviews } from '../reviews/collect.ts'
import { scanLocalProblems } from '../reviews/local.ts'
import { localDay } from '../util/local-date.ts'
import { buildReplay, recentContestIds, isFinalized, type ContestMeta } from '../analysis/replay.ts'

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
      'Rank 复盘与间隔复习。action=contests 列出近期参与过的比赛（按提交聚合）；' +
      'action=contest 复盘单场（每题用时/尝试/失败原因/暴露的薄弱标签，并给本地赛事代码路径）；' +
      'action=list 复习队列（due=true 只看到期）；action=scan 从本地目录自动收题；' +
      'action=add 手动加题；action=feedback 反馈排期（hard/ok/easy）；action=note 笔记；action=remove 移出。',
    parameters: {
      action: { type: 'string', required: true, enum: ['contests', 'contest', 'list', 'scan', 'add', 'feedback', 'note', 'remove'] },
      contestId: { type: 'number', description: '比赛号，如 2283（contest 动作）' },
      due: { type: 'boolean', description: 'list 时只看到期（默认 false）' },
      root: { type: 'string', description: 'scan 的根目录（默认 D:\\codeforces）' },
      platform: { type: 'string', enum: ['codeforces', 'atcoder'], description: '平台（add）' },
      problemKey: { type: 'string', description: '题目标识（add）' },
      id: { type: 'number', description: '复习条目 ID（feedback/note/remove）' },
      feedback: { type: 'string', enum: ['hard', 'ok', 'easy'], description: '复习反馈' },
      note: { type: 'string', description: '笔记内容（note）' },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const action = args.action as string

      switch (action) {
        case 'contests': {
          const metas = await contestMetaMap(host)
          const ids = recentContestIds(store, 30)
          const rows = ids
            .map((id) => ({ id, meta: metas.get(id) }))
            .filter((x) => x.meta && isFinalized(x.meta))
            .map(({ id, meta }) => {
            const r = buildReplay(store, id, meta)
            return {
              contestId: id, name: r.name, startAt: r.startAt,
              problems: r.summary.problems, solved: r.summary.solved, attempts: r.summary.attempts,
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
          const local = scanLocalProblems().problems.filter((p) => report.problems.some((x) => x.problemKey === p.problemKey))
          return { ok: true, report, codeFiles: local.map((p) => ({ problemKey: p.problemKey, file: p.file })) }
        }

        case 'list':
          return { ok: true, items: store.listReviews(args.due === true).map((r) => ({ ...r, intervalDays: intervalDaysForStage(r.stage) })) }

        case 'scan': {
          const stats = collectLocalReviews(store, typeof args.root === 'string' && args.root.trim() ? { root: args.root.trim() } : {})
          return { ok: true, ...stats }
        }

        case 'add': {
          const platform = args.platform as string
          const problemKey = typeof args.problemKey === 'string' ? args.problemKey.trim() : ''
          if (!platform || !problemKey) return { ok: false, error: 'platform 与 problemKey 必填' }
          const problem = store.findProblem(platform as never, problemKey)
          if (!problem) return { ok: false, error: `题库中不存在 ${platform}/${problemKey}，请先同步` }
          const review = store.addReview(problem)
          return { ok: true, id: review.id }
        }

        case 'feedback': {
          const id = Number(args.id)
          const feedback = args.feedback as 'hard' | 'ok' | 'easy' | undefined
          if (!Number.isInteger(id)) return { ok: false, error: 'id 必填' }
          if (!feedback || !['hard', 'ok', 'easy'].includes(feedback)) return { ok: false, error: "feedback 需为 'hard' | 'ok' | 'easy'" }
          const item = store.getReview(id)
          if (!item) return { ok: false, error: '复习条目不存在' }
          const todayStr = localDay()
          const next = scheduleNext(item.stage, feedback, todayStr)
          store.updateReview(id, { stage: next.stage, nextDueOn: next.nextDueOn, lastReviewedAt: new Date().toISOString() })
          return { ok: true, ...next }
        }

        case 'note': {
          const id = Number(args.id)
          if (!Number.isInteger(id)) return { ok: false, error: 'id 必填' }
          if (typeof args.note !== 'string') return { ok: false, error: 'note 需为字符串' }
          if (!store.updateReview(id, { note: args.note.trim() === '' ? null : args.note })) return { ok: false, error: '复习条目不存在' }
          return { ok: true }
        }

        case 'remove': {
          const id = Number(args.id)
          if (!Number.isInteger(id)) return { ok: false, error: 'id 必填' }
          if (!store.deleteReview(id)) return { ok: false, error: '复习条目不存在' }
          return { ok: true }
        }

        default:
          return { ok: false, error: `未知 action: ${action}` }
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `复盘/复习：${args.action}` }),
  }))
}
