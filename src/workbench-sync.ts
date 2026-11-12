/**
 * 打开训练台时自动增量同步：POST /icpc-workbench/sync
 *
 * 节流：同一平台距上次同步 < 30 分钟直接跳过，避免每次切面板都打 API。
 * 顺带做两件事：题库为空时补一次题库；同步完成后从本地 Codeforces 目录收复习题。
 */

import type { IcpcHost } from './index.ts'
import type { PlatformId } from './types.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { syncPlatform, syncBank } from './tools/sync-helpers.ts'
import { buildTodayStatus, localDay } from './workbench-overview.ts'

const THROTTLE_MS = 30 * 60 * 1000
const FORCE_THROTTLE_MS = 5 * 60 * 1000
const BANK_BOOTSTRAP_THRESHOLD = 1000
const BANK_REFRESH_MS = 24 * 60 * 60 * 1000

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function trustedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  return origin === `http://${host}` || origin === `https://${host}`
}

interface SyncSummary {
  ok: true
  synced: Array<{ platform: string; skipped: boolean; imported?: number; errors?: string[] }>
  bank: { platform: string; fetched: number; inserted: number } | null
  reviews: { added: number; localProblems: number } | null
  /** 今日训练完成后自动勾选的计划任务数 */
  throttled: boolean
}

async function runSync(host: IcpcHost, force = false): Promise<SyncSummary> {
  const settings = host.store.getSettings()
  const summary: SyncSummary = { ok: true, synced: [], bank: null, reviews: null, throttled: false }
  const now = Date.now()
  const threshold = force ? FORCE_THROTTLE_MS : THROTTLE_MS

  for (const [pf, account] of Object.entries(settings.accounts)) {
    if (!account?.handle || !account.enabled) continue
    const last = account.lastSyncAt ? Date.parse(account.lastSyncAt) : 0
    if (Number.isFinite(last) && now - last < threshold) {
      summary.synced.push({ platform: pf, skipped: true })
      continue
    }
    const result = await syncPlatform(host, pf as PlatformId, account.handle)
    summary.synced.push({
      platform: pf,
      skipped: false,
      imported: result.imported,
      errors: result.errors,
    })
  }

  const didSync = summary.synced.some((s) => !s.skipped)
  if (!didSync) {
    summary.throttled = summary.synced.length > 0
    return summary
  }

  // 题库：首次（没同步过）或距上次刷新超过 24 小时 → 自动拉最新题目
  const bankAt = host.store.getBankSyncedAt()
  const bankStale = !bankAt || now - Date.parse(bankAt) > BANK_REFRESH_MS
  if (host.store.countProblems('codeforces') < BANK_BOOTSTRAP_THRESHOLD || bankStale) {
    const bank = await syncBank(host, 'codeforces')
    summary.bank = { platform: bank.platform, fetched: bank.fetched, inserted: bank.inserted }
  }

  // 今日训练已完成 → 自动勾掉当天的计划任务，避免计划与日历两套账
  const today = localDay()
  if (buildTodayStatus(host.store, today).done) {
  }

  return summary
}

export function registerSyncRoute(
  ctx: { webServer?: { register: (r: unknown) => () => void }; effect: (fn: () => void | (() => void)) => unknown },
  host: IcpcHost,
): void {
  if (!ctx.webServer) return
  let inFlight: Promise<SyncSummary> | null = null

  const run = (force = false): Promise<SyncSummary> => {
    if (!inFlight) {
      inFlight = runSync(host, force).finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }

  ctx.effect(() => {
    const off = ctx.webServer!.register({
      kind: 'exact',
      path: '/icpc-workbench/sync',
      async handler(req: IncomingMessage, res: ServerResponse) {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!trustedOrigin(req)) {
          sendJson(res, 403, { ok: false, error: 'origin-not-allowed' })
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const force = url.searchParams.get('force') === '1'
          sendJson(res, 200, await run(force))
        } catch (e) {
          sendJson(res, 500, { ok: false, error: (e as Error).message })
        }
      },
    })
    return () => off()
  })
}
