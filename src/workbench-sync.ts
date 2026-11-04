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
import { collectLocalReviews } from './reviews/collect.ts'

const THROTTLE_MS = 30 * 60 * 1000
const BANK_BOOTSTRAP_THRESHOLD = 1000

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
  throttled: boolean
}

async function runSync(host: IcpcHost): Promise<SyncSummary> {
  const settings = host.store.getSettings()
  const summary: SyncSummary = { ok: true, synced: [], bank: null, reviews: null, throttled: false }
  const now = Date.now()

  for (const [pf, account] of Object.entries(settings.accounts)) {
    if (!account?.handle || !account.enabled) continue
    const last = account.lastSyncAt ? Date.parse(account.lastSyncAt) : 0
    if (Number.isFinite(last) && now - last < THROTTLE_MS) {
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

  // 题库为空（还没同步过）时顺手补一次，让「今日训练」不再只从做过的题里选
  if (host.store.countProblems('codeforces') < BANK_BOOTSTRAP_THRESHOLD) {
    const bank = await syncBank(host, 'codeforces')
    summary.bank = { platform: bank.platform, fetched: bank.fetched, inserted: bank.inserted }
  }

  // 本地 Codeforces 目录 → 复习库
  const reviews = collectLocalReviews(host.store)
  summary.reviews = { added: reviews.added, localProblems: reviews.localProblems }

  return summary
}

export function registerSyncRoute(
  ctx: { webServer?: { register: (r: unknown) => () => void }; effect: (fn: () => void | (() => void)) => unknown },
  host: IcpcHost,
): void {
  if (!ctx.webServer) return
  let inFlight: Promise<SyncSummary> | null = null

  const run = (): Promise<SyncSummary> => {
    if (!inFlight) {
      inFlight = runSync(host).finally(() => {
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
          sendJson(res, 200, await run())
        } catch (e) {
          sendJson(res, 500, { ok: false, error: (e as Error).message })
        }
      },
    })
    return () => off()
  })
}
