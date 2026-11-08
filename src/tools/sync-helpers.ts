/**
 * 共享同步逻辑：供 sync 工具和 templates sync_examples 复用。
 * 调用适配器拉取提交 → upsert problems → insert submissions → 更新账号同步时间。
 */

import type { PlatformId } from '../types.ts'
import type { IcpcHost } from '../index.ts'

export interface SyncResult {
  platform: PlatformId
  handle: string
  imported: number
  skipped: number
  errors: string[]
}

export interface BankSyncResult {
  platform: PlatformId
  fetched: number
  inserted: number
  updated: number
  errors: string[]
}

export async function syncPlatform(
  host: IcpcHost,
  platform: PlatformId,
  handle: string,
): Promise<SyncResult> {
  const { store, adapters } = host
  const result: SyncResult = { platform, handle, imported: 0, skipped: 0, errors: [] }

  // 检查适配器开关
  if (!store.getAdapterEnabled(platform)) {
    result.errors.push(`平台 ${platform} 已禁用（可在设置中开启）`)
    return result
  }

  const adapter = adapters[platform]
  if (!adapter) {
    result.errors.push(`未注册适配器: ${platform}`)
    return result
  }

  // 增量同步：读取上次同步时间
  const account = store.getAccount(platform)
  const since = account?.lastSyncAt ?? undefined
  const known = store.getKnownExternalIds(platform)

  try {
    const subs = await adapter.fetchUserSubmissions(handle, {
      ...(since ? { since } : {}),
      knownExternalIds: known,
    })

    // upsert problem metadata
    for (const s of subs) {
      store.upsertProblem({
        platform: s.problem.platform,
        problemKey: s.problem.problemKey,
        title: s.problem.title,
        difficulty: s.problem.difficulty ?? null,
        url: s.problem.url ?? null,
        tags: s.problem.tags,
      })
    }

    const insertResult = store.insertSubmissions(
      subs.map((s) => ({
        platform: s.problem.platform,
        problemKey: s.problem.problemKey,
        verdict: s.verdict,
        language: s.language,
        submittedAt: s.submittedAt,
        externalId: s.externalId,
      })),
    )
    result.imported = insertResult.imported
    result.skipped = insertResult.skipped

    // 更新账号同步时间
    store.setAccountSyncTime(platform, new Date().toISOString())
  } catch (e) {
    result.errors.push((e as Error).message)
  }

  return result
}

/** 同步平台题库（题目元数据，不产生提交）：让「今日三档」能从未做过的题里出题 */
export async function syncBank(host: IcpcHost, platform: PlatformId): Promise<BankSyncResult> {
  const { store, adapters } = host
  const result: BankSyncResult = { platform, fetched: 0, inserted: 0, updated: 0, errors: [] }

  const adapter = adapters[platform]
  if (!adapter?.fetchProblemBank) {
    result.errors.push(`平台 ${platform} 没有题库接口`)
    return result
  }

  try {
    const rows = await adapter.fetchProblemBank()
    result.fetched = rows.length
    const stats = store.upsertBankProblems(
      rows.map((r) => ({
        platform: r.platform,
        problemKey: r.problemKey,
        title: r.title,
        difficulty: r.difficulty,
        url: r.url,
        tags: r.tags,
      })),
    )
    const mine = stats.find((s) => s.platform === platform)
    result.inserted = mine?.inserted ?? 0
    result.updated = mine?.updated ?? 0
    if (result.errors.length === 0) {
      host.store.setBankSyncedAt(new Date().toISOString())
    }
  } catch (e) {
    result.errors.push((e as Error).message)
  }

  return result
}
