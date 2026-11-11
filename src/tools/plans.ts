import type { IcpcHost } from '../index.ts'
import type { Context } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT, num, str } from './helpers.ts'
import { parsePlanJson, today, addDays, TASK_KINDS } from '../plans/planService.ts'
import { buildWeeklyPlan } from '../plans/weekly.ts'
import { localDay } from '../workbench-overview.ts'
import { gitCommitPush, gitPullForceRemote } from '../util/git.ts'
import {
  readPlanFile,
  removePlanFile,
  taskFileRel,
  writePlanFromRecord,
} from '../plans/taskList.ts'
import type { TaskKind } from '../types.ts'

export function registerPlanTools(host: IcpcHost, ctx: Context): () => void {
  // 计划文件 → 远端：只提交 taskList/ 下的文件，不碰题目代码
  const persist = (store: typeof host.store, message: string) => {
    const root = store.getLocalRoot() || host.localRoot
    if (!root) return { ok: false, message: 'no-root' }
    const plans = store.listPlans()
    for (const p of plans) writePlanFromRecord(root, p)
    return gitCommitPush(root, plans.map((p) => taskFileRel(p.startDate)), message)
  }

  const disposeGenerate = ctx.tools.register(defineTool({
    name: 'icpc_generate_plan',
    description:
      '生成训练计划（v4.1：每周固定一个大方向）。按弱项 gap 排序，每周一个方向；' +
      '每日只排题量与难度区间，具体题目在「今日训练」里现选。',
    parameters: {
      days: { type: 'number', description: '计划天数（默认 14，范围 1-90）' },
      startDate: { type: 'string', description: '起始日期 YYYY-MM-DD（默认今天）' },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const days = num(args.days, 14, 1, 90)
      const startDate = str(args.startDate) ?? localDay()
      const root = host.store.getLocalRoot() || host.localRoot
      // 远端优先：先拉，再看 taskList/<startDate>.json 是否已有安排
      const pull = gitPullForceRemote(root, [`taskList/${startDate}.json`])
      const remotePlan = readPlanFile(root, startDate)
      if (remotePlan) {
        const existing = host.store.findPlanByStartDate(startDate)
        if (existing) host.store.replacePlanTasks(existing.id, remotePlan.tasks.map((t) => ({ ...t, id: 0 })))
        const plan = existing ?? host.store.createPlan({
          title: remotePlan.title,
          goal: remotePlan.goal,
          startDate: remotePlan.startDate,
          endDate: remotePlan.endDate,
          source: remotePlan.source,
          weeks: remotePlan.weeks,
          tasks: remotePlan.tasks.map((t) => ({ ...t, id: 0 })),
        })
        return {
          ok: true,
          planId: plan.id,
          title: remotePlan.title,
          goal: remotePlan.goal,
          taskCount: remotePlan.tasks.length,
          scheduledBy: 'remote',
          gitSync: pull,
        }
      }
      try {
        let planLevel: number | undefined
        try {
          const account = host.store.getAccount('codeforces')
          if (account?.handle) {
            const rating = await host.adapters.codeforces.fetchCurrentRating?.(account.handle)
            if (rating != null) planLevel = Math.round(rating / 100) * 100
          }
        } catch { /* 拉不到 rating 时用历史 AC 中位数 */ }

        const built = buildWeeklyPlan(host.store, { days, startDate, level: planLevel })
        const plan = host.store.createPlan({
          ...built.plan,
          // PlanInput 用 date，PlanRecord 用 taskDate，这里做一次边界转换
          tasks: built.plan.tasks.map((t) => ({
            id: 0,
            taskDate: t.date,
            title: t.title,
            kind: t.kind,
            platform: t.platform,
            problemKey: t.problemKey,
            url: t.url ?? null,
            note: t.note ?? null,
            checked: false,
          })),
        })
        const pushed = persist(host.store, `chore(taskList): 生成 ${startDate} 训练计划`)
        return {
          ok: true,
          planId: plan.id,
          title: built.title,
          goal: built.goal,
          level: built.level,
          weeks: built.weeks,
          taskCount: plan.tasks.length,
          scheduledBy: 'local',
          gitSync: { ...pull, push: pushed },
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    presentCall: () => ({ card: 'generic', title: '生成训练计划' }),
  }))

  const disposeManage = ctx.tools.register(defineTool({
    name: 'icpc_manage_plan',
    description:
      '管理训练计划。action=list 列出所有计划；action=detail 查看计划详情；' +
      'action=checkin 打卡；action=uncheck 取消打卡；action=delete 删除计划；' +
      'action=import 导入 AI 返回的 JSON 计划文本；' +
      'action=update_task 编辑单条任务（taskDate/title/kind/url/note）；' +
      'action=delete_task 删除单条任务。',
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['list', 'detail', 'checkin', 'uncheck', 'delete', 'import', 'update_task', 'delete_task'],
      },
      planId: { type: 'number', description: '计划 ID（detail/delete）' },
      taskId: { type: 'number', description: '任务 ID（checkin/uncheck/update_task/delete_task）' },
      raw: { type: 'string', description: 'AI JSON 文本（import）' },
      days: { type: 'number', description: '计划天数（import，默认 14）' },
      startDate: { type: 'string', description: '起始日期（import）' },
      taskDate: { type: 'string', description: '任务日期 YYYY-MM-DD（update_task）' },
      title: { type: 'string', description: '任务标题（update_task）' },
      kind: { type: 'string', enum: ['practice', 'review', 'topic', 'contest'], description: '任务类型（update_task）' },
      url: { type: 'string', description: '跳转链接（update_task，空串清除）' },
      note: { type: 'string', description: '备注（update_task，空串清除）' },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const action = args.action as string

      switch (action) {
        case 'list':
          return { ok: true, plans: store.listPlans().map((p) => ({
            id: p.id, title: p.title, goal: p.goal, startDate: p.startDate, endDate: p.endDate,
            source: p.source, createdAt: p.createdAt,
            taskCount: p.tasks.length, checkedCount: p.tasks.filter((t) => t.checked).length,
          })) }

        case 'detail': {
          const id = Number(args.planId)
          const plan = store.getPlan(id)
          if (!plan) return { ok: false, error: '计划不存在' }
          // 归一化可选字段，避免 undefined 让工具结果无法无损序列化
          return {
            ok: true,
            plan: {
              ...plan,
              tasks: plan.tasks.map((t) => ({
                ...t,
                platform: t.platform ?? null,
                problemKey: t.problemKey ?? null,
                url: t.url ?? null,
                note: t.note ?? null,
              })),
            },
          }
        }

        case 'checkin': {
          const taskId = Number(args.taskId)
          if (!Number.isInteger(taskId)) return { ok: false, error: 'taskId 必填' }
          if (!store.findTask(taskId)) return { ok: false, error: '任务不存在' }
          store.toggleCheckin(taskId, true)
          return { ok: true, gitSync: persist(store, 'chore(taskList): 打卡') }
        }

        case 'uncheck': {
          const taskId = Number(args.taskId)
          if (!Number.isInteger(taskId)) return { ok: false, error: 'taskId 必填' }
          store.toggleCheckin(taskId, false)
          return { ok: true, gitSync: persist(store, 'chore(taskList): 取消打卡') }
        }

        case 'delete': {
          const id = Number(args.planId)
          if (!Number.isInteger(id)) return { ok: false, error: 'planId 必填' }
          const target = store.getPlan(id)
          if (!target) return { ok: false, error: '计划不存在' }
          const root = store.getLocalRoot() || host.localRoot
          removePlanFile(root, target.startDate)
          const gone = store.deletePlan(id)
          const sync = persist(store, `chore(taskList): 删除计划 ${target.startDate}`)
          return { ok: gone, gitSync: sync }
        }

        case 'import': {
          const raw = args.raw
          if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'raw 必填' }
          const sd = str(args.startDate) ?? today()
          const d = num(args.days, 14, 1, 90)
          try {
            const parsed = parsePlanJson(raw, sd, d)
            const plan = store.createPlan({
              title: parsed.title, goal: parsed.goal,
              startDate: parsed.startDate, endDate: addDays(sd, d - 1),
              source: 'ai', rawPrompt: raw,
              tasks: parsed.tasks.map((t) => ({
                id: 0, taskDate: t.date, title: t.title,
                kind: (TASK_KINDS as readonly string[]).includes(t.kind ?? '') ? (t.kind as TaskKind) : 'practice',
                url: t.url ?? null, note: t.note ?? null, checked: false,
              })),
            })
            const sync = persist(store, `chore(taskList): 导入计划 ${sd}`)
            return { ok: true, planId: plan.id, title: plan.title, taskCount: plan.tasks.length, gitSync: sync }
          } catch (e) {
            return { ok: false, error: `导入失败：${(e as Error).message}` }
          }
        }

        case 'update_task': {
          const taskId = Number(args.taskId)
          if (!Number.isInteger(taskId)) return { ok: false, error: 'taskId 必填' }
          const found = store.findTask(taskId)
          if (!found) return { ok: false, error: '任务不存在' }
          const patch: Record<string, unknown> = {}
          if (args.taskDate !== undefined) {
            if (typeof args.taskDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args.taskDate)) return { ok: false, error: 'taskDate 格式需为 YYYY-MM-DD' }
            patch.taskDate = args.taskDate
          }
          if (args.title !== undefined) {
            if (typeof args.title !== 'string' || !args.title.trim()) return { ok: false, error: 'title 不能为空' }
            patch.title = args.title.trim()
          }
          if (args.kind !== undefined) {
            const kind = args.kind as string
            if (!(TASK_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `kind 非法` }
            patch.kind = kind
          }
          if (args.url !== undefined) patch.url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : null
          if (args.note !== undefined) patch.note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : null
          if (Object.keys(patch).length === 0) return { ok: false, error: '没有可更新字段' }
          store.updateTask(taskId, patch as never)
          return { ok: true, gitSync: persist(store, 'chore(taskList): 修改任务') }
        }

        case 'delete_task': {
          const taskId = Number(args.taskId)
          if (!Number.isInteger(taskId)) return { ok: false, error: 'taskId 必填' }
          const done = store.deleteTask(taskId)
          return done
            ? { ok: true, gitSync: persist(store, 'chore(taskList): 删除任务') }
            : { ok: false, error: '任务不存在' }
        }

        default:
          return { ok: false, error: `未知 action: ${action}` }
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `计划：${args.action}` }),
  }))

  return () => {
    disposeGenerate()
    disposeManage()
  }
}
