/**
 * Codeforces 赛事可视化：GET /algorithm-tools/contests
 * 只取「还没结束」的 CF 比赛，按开始时间升序，10 分钟内存缓存。
 */

import type { IcpcHost } from './index.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ContestItem {
  id: string
  name: string
  startTimeIso: string | null
  durationMinutes: number
  phase: string
  url: string
}

const CACHE_TTL_MS = 10 * 60 * 1000
let cache: { at: number; items: ContestItem[] } | null = null

export async function getUpcomingContests(host: IcpcHost): Promise<ContestItem[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items
  const adapter = host.adapters['codeforces']
  if (!adapter) return []
  const list = await adapter.fetchContests()
  const now = Date.now()
  const items = list
    .filter((c) => {
      if (!c.startTimeIso) return false
      const start = new Date(c.startTimeIso).getTime()
      return start + c.durationMinutes * 60_000 > now
    })
    .sort((a, b) => new Date(a.startTimeIso!).getTime() - new Date(b.startTimeIso!).getTime())
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      name: c.name,
      startTimeIso: c.startTimeIso,
      durationMinutes: c.durationMinutes,
      phase: c.phase,
      url: c.url,
    }))
  cache = { at: now, items }
  return items
}

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

export function registerContestsRoute(
  ctx: { webServer?: { register: (r: unknown) => () => void }; effect: (fn: () => void | (() => void)) => unknown },
  host: IcpcHost,
): void {
  if (!ctx.webServer) return
  ctx.effect(() => {
    const off = ctx.webServer!.register({
      kind: 'exact',
      path: '/algorithm-tools/contests',
      async handler(req: IncomingMessage, res: ServerResponse) {
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET')
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!trustedOrigin(req)) {
          sendJson(res, 403, { ok: false, error: 'origin-not-allowed' })
          return
        }
        try {
          sendJson(res, 200, { ok: true, contests: await getUpcomingContests(host) })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: (e as Error).message })
        }
      },
    })
    return () => off()
  })
}
