import type { PlatformId } from '../types.ts'
import type { IcpcHost } from '../index.ts'
import type { Context, ToolDefinition } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT } from './helpers.ts'
import { syncPlatform, syncBank } from './sync-helpers.ts'

export function registerSyncTool(host: IcpcHost, ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'icpc_sync',
    description:
      '同步 OJ 平台刷题记录与题库。platform=all 同步所有已绑定账号；指定平台时需提供 handle 或使用已绑定账号。' +
      '同步为增量：仅拉取上次同步后的新提交。' +
      'bank=true 时额外拉取题库（Codeforces 约 1 万题，首次 10-30 秒），题库让「今日三档」从未做过的题里选题。',
    parameters: {
      platform: {
        type: 'string', required: true,
        enum: ['all', 'codeforces', 'atcoder'],
        description: '同步平台',
      },
      handle: {
        type: 'string',
        description: '平台用户名（留空则使用已绑定的 handle）',
      },
      bank: {
        type: 'boolean',
        description: '是否同时同步题库（默认 false）',
      },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store, adapters } = host
      const platform = args.platform as string
      const wantBank = args.bank === true
      const bankTargets = Object.keys(adapters)
        .filter((pf) => typeof adapters[pf]?.fetchProblemBank === 'function') as PlatformId[]

      if (platform === 'all') {
        const settings = store.getSettings()
        const results = []
        for (const [pf, account] of Object.entries(settings.accounts)) {
          if (!account?.handle || !account.enabled) continue
          const r = await syncPlatform(host, pf as PlatformId, account.handle)
          results.push({ ...r, durationMs: 0 })
        }
        const banks = []
        if (wantBank) {
          for (const pf of bankTargets) banks.push(await syncBank(host, pf))
        }
        if (results.length === 0 && banks.length === 0) {
          return { ok: false, error: '没有已绑定的启用账号，请先通过 icpc_settings 绑定平台账号' }
        }
        await store.flush()
        return { ok: true, results, ...(banks.length > 0 ? { banks } : {}) }
      }

      if (platform !== 'codeforces' && platform !== 'atcoder') {
        return { ok: false, error: `platform 非法: ${platform}` }
      }

      let handle = typeof args.handle === 'string' ? args.handle.trim() : ''
      if (!handle) handle = store.getHandle(platform) ?? ''
      if (!handle && !wantBank) {
        return { ok: false, error: `未提供 handle 且没有已绑定的 ${platform} 账号` }
      }

      const out: Record<string, unknown> = { ok: true }
      if (handle) out.result = await syncPlatform(host, platform, handle)
      if (wantBank) out.bank = await syncBank(host, platform)
      // 显式落盘：别依赖 500ms 防抖，退出/重启时数据才不会丢
      await store.flush()
      return out
    },
    presentCall: (args) => ({ card: 'generic', title: `同步 ${args.platform}` }),
  }))
}
