/**
 * dsh-algorithm-tools — 算法学习训练插件 for DeepSeek Harness
 *
 * Host 半边：按会话激活 agent tools。
 * 数据层用 JSON 文件持久化（替代 SQLite），通过 Node fs 落盘到 DSH_HOME/.icpc-data。
 * 适配层用 fetch 调公开 API（Codeforces + AtCoder）。
 *
 * 注意：本插件以「文件插件」形式通过 cordis.patch.yml 挂载（非动态 Cordis 插件），
 * 因此不使用 harness.handle / host.call（那是动态插件的 Package-private RPC 通道），
 * client 半边仅注册一个静态引导面板；数据读写全部走 icpc_* 工具。
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Context, PluginConfig, FsService } from './dsh-compat.ts'
import { Config, resolveConfig } from './dsh-compat.ts'
import { IcpcStore } from './store/index.ts'
import { createCodeforcesAdapter } from './adapters/codeforces.ts'
import { createAtcoderAdapter } from './adapters/atcoder.ts'
import type { PlatformAdapter, ContestAdapter } from './adapters/types.ts'
import { registerActivationRoute } from './activation.ts'
import { registerOverviewRoute } from './workbench-overview.ts'
import { registerSyncRoute } from './workbench-sync.ts'
import { registerContestsRoute } from './workbench-contests.ts'
import { defaultLocalRoots } from './util/local-scan.ts'
import { registerPlanRoute } from './workbench-plan.ts'

export const name = 'dsh-algorithm-tools'
export const inject = ['tools', 'agents', 'webServer']
export { Config }

export interface IcpcHost {
  store: IcpcStore
  adapters: Record<string, PlatformAdapter & ContestAdapter>
  /** 本地题目根目录（例如 /Volumes/kingston/codeforces） */
  localRoot: string
}

/**
 * Node 原生 fs 包装为 FsService 接口。
 * 文件插件运行在 Host Node 进程中，node:fs 是唯一可靠的数据落盘通道；
 * dsh 的 ctx.fs 服务接口（resolve/readText/writeText/stat）与本层不兼容，故不使用。
 */
function nodeFs(): FsService {
  return {
    async readFile(p: string): Promise<string> {
      return fs.promises.readFile(p, 'utf8')
    },
    async writeFile(p: string, content: string): Promise<void> {
      await fs.promises.writeFile(p, content, 'utf8')
    },
    async mkdir(p: string): Promise<void> {
      await fs.promises.mkdir(p, { recursive: true })
    },
    async exists(p: string): Promise<boolean> {
      return fs.existsSync(p)
    },
    async readdir(p: string): Promise<string[]> {
      return fs.promises.readdir(p)
    },
    async rename(from: string, to: string): Promise<void> {
      await fs.promises.rename(from, to)
    },
  }
}

export function apply(ctx: Context, rawConfig: Partial<PluginConfig> = {}): void {
  const config = resolveConfig(rawConfig)
  // dataDir 留空时使用 DSH 主目录下的 .icpc-data（与 harness 数据目录同级，重启后仍保留）
  const dataDir = config.dataDir || path.join(
    process.env.DSH_HOME || process.env.HOME || process.env.USERPROFILE || '.',
    '.icpc-data',
  )

  const store = new IcpcStore(nodeFs(), dataDir)

  // 启动探针：记录宿主进程真正用的目录 + 是否可写，排查「同步完数据没落盘」用
  void (async () => {
    try {
      await fs.promises.mkdir(dataDir, { recursive: true })
      await fs.promises.appendFile(
        path.join(dataDir, 'icpc-boot.log'),
        `${new Date().toISOString()} pid=${process.pid} dataDir=${dataDir} cwd=${process.cwd()} DSH_HOME=${process.env.DSH_HOME ?? '(unset)'} HOME=${process.env.HOME ?? '(unset)'}\n`,
      )
    } catch (e) {
      console.error(`[icpc-boot] cannot write boot log to ${dataDir}: ${(e as Error).message}`)
    }
  })()
  const localRoot = config.localRoot || defaultLocalRoots()[0] || ''
  // load() 已在构造器中启动；工具在 ready 之前注册无害（写盘已等待 ready）

  const adapters: Record<string, PlatformAdapter & ContestAdapter> = {
    codeforces: createCodeforcesAdapter(),
    atcoder: createAtcoderAdapter(),
  }

  const host: IcpcHost = { store, adapters, localRoot }

  ctx.effect(() => () => { void store.flush() })

  registerActivationRoute(ctx, host)
  registerOverviewRoute(ctx, store, async () => {
    const account = store.getAccount('codeforces')
    if (!account?.handle) return null
    const rating = await adapters.codeforces.fetchCurrentRating?.(account.handle) ?? null
    return rating == null ? null : Math.round(rating / 100) * 100
  })
  registerSyncRoute(ctx, host)
  registerContestsRoute(ctx, host)
  registerPlanRoute(ctx, store)
}
