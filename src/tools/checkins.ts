import type { IcpcHost } from '../index.ts'
import type { Context } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT, str } from './helpers.ts'
import { buildTodayStatus, acStreak, localDay } from '../workbench-overview.ts'

export function registerCheckinTool(host: IcpcHost, ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'icpc_checkin',
    description:
      '今日训练完成度与日历打卡。action=status 今天是否完成（含补题/加训建议）；' +
      'action=streak 连续打卡（以「当天有 AC」为准）；action=month 月视图；action=date 某天摘要。',
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['status', 'streak', 'month', 'date'],
      },
      month: { type: 'string', description: '月份 YYYY-MM（month）' },
      date: { type: 'string', description: '日期 YYYY-MM-DD（date）' },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const action = args.action as string
      const todayStr = localDay()

      switch (action) {
        case 'status': {
          const status = buildTodayStatus(store, todayStr)
          return { ok: true, ...status, streak: acStreak(store, todayStr) }
        }

        case 'streak':
          return { ok: true, ...acStreak(store, todayStr) }

        case 'month': {
          const month = str(args.month) ?? todayStr.slice(0, 7)
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
            return { ok: false, error: 'month 格式需为 YYYY-MM' }
          return { ok: true, days: store.getMonthView(month) }
        }

        case 'date': {
          const date = str(args.date)
          if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
            return { ok: false, error: 'date 格式需为 YYYY-MM-DD' }
          return { ok: true, message: '该日期的训练与提交记录见 icpc_stats', date }
        }

        default:
          return { ok: false, error: `未知 action: ${action}` }
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `打卡：${args.action}` }),
  }))
}
