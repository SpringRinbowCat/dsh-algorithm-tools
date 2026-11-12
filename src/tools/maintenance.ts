import type { IcpcHost } from '../index.ts'
import type { Context } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT } from './helpers.ts'

/**
 * 维护工具：在插件进程内部清理数据。
 * 直接在磁盘上改 state 会被运行中的进程用内存副本覆盖，所以清库必须走这里。
 */
export function registerMaintenanceTool(host: IcpcHost, ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'icpc_maintenance',
    description:
      '数据维护。action=clear_submissions 清空全部提交记录（换号或清理历史时用）；' +
      'action=clear_all 同时清空提交和复习库；action=stats 只查看当前数据量。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['stats', 'clear_submissions', 'clear_all'],
      },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const action = String(args.action)
      if (action === 'stats') {
        return {
          action,
          submissions: store.getSubmissionRows().length,
          handle: store.getAccount('codeforces')?.handle ?? null,
        }
      }
      const includeReviews = action === 'clear_all'
      const removed = store.clearSubmissions({ includeReviews })
      await store.flush()
      return {
        action,
        removedSubmissions: removed.submissions,
        removedReviews: removed.reviews,
        handle: store.getAccount('codeforces')?.handle ?? null,
        flushed: true,
      }
    },
  }))
}
