import fs from 'node:fs'
import path from 'node:path'

import type { TodayBandKey, TodayProblem } from '../types.ts'
import type { IcpcHost } from '../index.ts'
import type { Context, ToolDefinition } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT, num } from './helpers.ts'
import { computeWeakness } from '../analysis/weakness.ts'
import { localDay } from '../util/local-date.ts'
import { gitCommitPush, gitPullForceRemote } from '../util/git.ts'
import { syncPlatform } from './sync-helpers.ts'
import { contestIdOf, replayTagScores, type ContestMeta } from '../analysis/replay.ts'
import {
  bandForDifficulty,
  bandRanges,
  estimateLevelDetail,
  estimateLevelFromRating,
  pickBand,
  renderTodayMarkdown,
  type CandidateProblem,
  type TodayMdProblem,
} from '../analysis/today.ts'

const DEFAULT_COUNTS: Record<TodayBandKey, number> = { consolidation: 2, core: 3, challenge: 1 }
const BAND_KEYS: TodayBandKey[] = ['consolidation', 'core', 'challenge']
const KEY_RE = /^(\d{3,6})([A-Z]\d?)$/


interface DayMdEntry {
  band: TodayBandKey
  problemKey: string
  reason: string
}

interface DayMdBandRange {
  min: number | null
  max: number | null
}

/** 解析 practice/<日期>/<日期>.md：保留原分档和选题理由（md 是远端安排的真相） */
function parseDayMd(md: string): { entries: DayMdEntry[]; ranges: Map<TodayBandKey, DayMdBandRange> } {
  const mdRanges = new Map<TodayBandKey, DayMdBandRange>()
  const labelToKey: Record<string, TodayBandKey> = {
    巩固区: 'consolidation',
    同段区: 'core',
    挑战区: 'challenge',
  }
  const out: DayMdEntry[] = []
  let band: TodayBandKey | null = null
  for (const line of md.split('\n')) {
    const head = /^##\s*(巩固区|同段区|挑战区)\s*[（(]?\s*(\d+)?\s*[–\-~]?\s*(\d+)?\s*[）)]?/.exec(line)
    if (head) {
      band = labelToKey[head[1]!] ?? null
      if (band) {
        const lo = head[2] ? Number(head[2]) : null
        const hi = head[3] ? Number(head[3]) : null
        if (lo !== null && hi !== null) mdRanges.set(band, { min: lo, max: hi })
      }
      continue
    }
    if (!band) continue
    const row = /^\|\s*\[(\d{3,6}[A-Z]\d?)\]\(([^)]+)\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/.exec(line)
    if (row) out.push({ band, problemKey: row[1]!, reason: (row[5] ?? '').trim() })
  }
  return { entries: out, ranges: mdRanges }
}

interface LocalProblem {
  problemKey: string
  platform: 'codeforces' | 'atcoder'
}

/** 扫「今天」这个目录，看已经有哪些题目（目录名或 KEY.cpp 都认） */
function listDayProblems(root: string, day: string): { dir: string; problems: LocalProblem[] } {
  const dir = path.join(root, 'practice', day)
  const problems: LocalProblem[] = []
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      let isDir = false
      try {
        isDir = fs.statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        if (KEY_RE.test(name)) problems.push({ problemKey: name, platform: 'codeforces' })
      } else if (name.endsWith('.cpp')) {
        const key = name.slice(0, -4)
        if (KEY_RE.test(key)) problems.push({ problemKey: key, platform: 'codeforces' })
      }
    }
  } catch {
    // 目录还不存在
  }
  return { dir, problems }
}

/** 近 windowDays 天内举行的比赛里，比赛时间窗内 AC 的题难度（比赛侧能力值） */
function contestAcDifficulties(
  host: IcpcHost,
  metaMap: Map<number, ContestMeta>,
  sinceMs: number,
  difficulties: Map<string, number | null>,
): number[] {
  const out: number[] = []
  const seen = new Set<string>()
  for (const [contestId, meta] of metaMap) {
    if (!meta.startTimeIso) continue
    const start = new Date(meta.startTimeIso).getTime()
    if (!Number.isFinite(start) || start < sinceMs) continue
    const end = start + meta.durationMinutes * 60_000 + 60 * 60_000
    for (const s of host.store.getSubmissionRows()) {
      if (s.platform !== 'codeforces' || s.verdict !== 'AC') continue
      if (contestIdOf(s.problemKey) !== contestId) continue
      const at = new Date(s.submittedAt).getTime()
      if (!Number.isFinite(at) || at < start || at > end) continue
      const key = `codeforces:${s.problemKey}`
      if (seen.has(key)) continue
      seen.add(key)
      const d = difficulties.get(key)
      if (d != null) out.push(d)
    }
  }
  return out
}

export function registerTodayTool(host: IcpcHost, ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'icpc_today',
    description:
      '获取今日三档训练推荐。能力值直接使用 Codeforces 当前 rating（四舍五入到 100），' +
      '按巩固区/同段区/挑战区推荐题目，弱项标签与比赛复盘命中优先。' +
      '会先 git pull 再读当天目录：已经有 .md 或题目就按已有安排锁定，避免多设备各抽一套；缺失时才生成并写入同名 .md。',
    parameters: {
      consolidation: { type: 'number', description: '巩固区题量（默认 2）' },
      core: { type: 'number', description: '同段区题量（默认 3）' },
      challenge: { type: 'number', description: '挑战区题量（默认 1）' },
      rotate: { type: 'number', description: '换一批偏移量（仅未锁定时有效）' },
      windowDays: { type: 'number', description: '能力值窗口天数（默认 60）' },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const todayStr = localDay()
      const windowDays = num(args.windowDays, 60, 7, 365)
      const sinceMs = Date.now() - windowDays * 86_400_000
      const since = new Date(sinceMs).toISOString()

      // 题目难度索引（比赛侧也要用）
      const difficulties = new Map<string, number | null>()
      for (const p of store.state.problems) difficulties.set(`${p.platform}:${p.problemKey}`, p.difficulty)

      // 进度以 Codeforces 官方判定为准：超过 10 分钟没同步就增量拉一次提交
      const REFRESH_MS = 10 * 60_000
      let refreshed: { imported: number } | null = null
      try {
        const account = store.getAccount('codeforces')
        const last = account?.lastSyncAt ? Date.parse(account.lastSyncAt) : 0
        if (account?.handle && (!last || Date.now() - last > REFRESH_MS)) {
          const r = await syncPlatform(host, 'codeforces', account.handle)
          refreshed = { imported: r.imported }
          await store.flush()
        }
      } catch { /* 拉不到就按已有数据算，不影响出题 */ }

      // ---------- 能力值：刷题 + 比赛 两路 ----------
      let practiceDiffs = store.getRecentAcDifficulties(since)
      if (practiceDiffs.length < 5) practiceDiffs = store.getRecentAcDifficulties('1970-01-01')

      const metaMap = new Map<number, ContestMeta>()
      try {
        for (const c of await host.adapters['codeforces'].fetchContests()) {
          const id = Number(String(c.id).replace(/^cf-/, ''))
          if (Number.isFinite(id)) {
            metaMap.set(id, { name: c.name, startTimeIso: c.startTimeIso, durationMinutes: c.durationMinutes })
          }
        }
      } catch { /* 拉不到比赛元数据就只用刷题侧 */ }

      const contestDiffs = contestAcDifficulties(host, metaMap, sinceMs, difficulties)
      let rating: number | null = null
      try {
        const account = store.getAccount('codeforces')
        if (account?.handle) {
          rating = await host.adapters['codeforces'].fetchCurrentRating?.(account.handle) ?? null
        }
      } catch { /* 拉不到 rating 时回退到难度中位数 */ }
      const levelInfo = rating != null
        ? estimateLevelFromRating(rating)
        : estimateLevelDetail(practiceDiffs, contestDiffs)
      const level = levelInfo.level
      const ranges = bandRanges(level)

      // ---------- 弱项标签：历史 50% + 比赛复盘 50% ----------
      const rows = store.getSubmissionRows()
      const weakness = computeWeakness(rows, { minAttempts: 5, topN: 15 })
      const weakItems = weakness.items.filter((i) => i.gap > 0)
      const weakTags = weakItems.map((i) => i.tag)

      const replayScores = replayTagScores(store, (id) => metaMap.get(id) ?? null)
      const maxGap = Math.max(1, ...weakItems.map((i) => i.gap))
      const tagScores = new Map<string, number>()
      for (const [tag, v] of replayScores) tagScores.set(tag, 0.5 * v)
      for (const i of weakItems) {
        tagScores.set(i.tag, (tagScores.get(i.tag) ?? 0) + 0.5 * (i.gap / maxGap))
      }

      const focus = store.currentFocus(todayStr)
      const focusTags = focus?.tags ?? []

      // 计划里今天已经指派了题的话，不再重复抽它们
      const planKeys = new Set(
        store.getTasksByDate(todayStr)
          .filter((t) => t.problemKey && t.platform)
          .map((t) => String(t.platform) + ':' + String(t.problemKey)),
      )

      const reasonOf = (p: { problemKey: string; difficulty: number | null; tags: string[] }): string => {
        const bits: string[] = []
        const hitWeak = p.tags.filter((t) => weakTags.includes(t))
        if (hitWeak.length) bits.push(`命中弱项 ${hitWeak.slice(0, 3).join('/')}`)
        const hitReplay = p.tags.filter((t) => (replayScores.get(t) ?? 0) > 0)
        if (hitReplay.length) bits.push(`近期比赛在 ${hitReplay.slice(0, 2).join('/')} 上失分`)
        const hitFocus = p.tags.filter((t) => focusTags.includes(t))
        if (hitFocus.length) bits.push(`贴合本周方向 ${focus?.direction ?? ''}`.trim())
        if (p.difficulty != null) {
          const band = bandForDifficulty(level, p.difficulty)
          const center = ranges[band].center
          const near = center != null ? Math.abs(p.difficulty - center) : null
          if (near != null) bits.push(`距本档中心 ${near}`)
        }
        if (bits.length === 0) bits.push('补足本档难度覆盖')
        return bits.join('；')
      }

      // ---------- 先看本地当天目录 ----------
      const localRoot = store.getLocalRoot() || host.localRoot

      // 多端一致：先把远端拉到本地，再看今天是否已经有远端安排的 .md
      // 冲突时以远端为准：只强制对齐今日 md，不碰题目代码
      const sync = gitPullForceRemote(localRoot, [`practice/${todayStr}/${todayStr}.md`])
      const dayDir = path.join(localRoot, 'practice', todayStr)
      const mdFile = path.join(dayDir, `${todayStr}.md`)
      const remoteScheduled = fs.existsSync(mdFile)
      const local = listDayProblems(localRoot, todayStr)

      // md 里有安排但对应 .cpp 还没 checkout 时，从 md 的题号链接里把安排读出来
      // 远端 md 是安排的唯一真相：题目集合和分档都以它为准
      const parsedMd = remoteScheduled
        ? parseDayMd(fs.readFileSync(mdFile, 'utf8'))
        : { entries: [] as DayMdEntry[], ranges: new Map<TodayBandKey, DayMdBandRange>() }
      const mdEntries = parsedMd.entries
      if (mdEntries.length > 0 && local.problems.length === 0) {
        for (const e of mdEntries) local.problems.push({ problemKey: e.problemKey, platform: 'codeforces' })
      }
      const locked = local.problems.length > 0 || remoteScheduled

      let bands: Array<{
        key: TodayBandKey
        label: string
        description: string
        range: [number | null, number | null]
        problems: TodayMdProblem[]
        pool: number
      }>

      if (locked) {
        // 按本地已有题目锁定：难度已知的按档分组，未知的放同段区
        const groups: Record<TodayBandKey, TodayMdProblem[]> = { consolidation: [], core: [], challenge: [] }
        const mdBandOf = new Map(mdEntries.map((e) => [e.problemKey, e.band]))
        const mdReasonOf = new Map(mdEntries.map((e) => [e.problemKey, e.reason]))
        // md 里列了几题就用几题（本地 .cpp 只是其中已开工的部分）
        const items: LocalProblem[] = mdEntries.length > 0
          ? mdEntries.map((e) => ({ problemKey: e.problemKey, platform: 'codeforces' as const }))
          : local.problems
        for (const item of items) {
          const rec = store.getProblemByKey(item.platform, item.problemKey)
          const p = {
            id: rec ? store.state.problems.indexOf(rec) + 1 : 0,
            platform: item.platform as TodayProblem['platform'],
            problemKey: item.problemKey,
            title: rec?.title ?? item.problemKey,
            difficulty: rec?.difficulty ?? null,
            url: rec?.url ?? null,
            tags: rec?.tags ?? [],
            weakTags: [] as string[],
          }
          const band = mdBandOf.get(p.problemKey) ?? bandForDifficulty(level, p.difficulty)
          const fromMd = mdReasonOf.get(p.problemKey)
          const reason = fromMd || (rec
            ? `本地已锁定；${reasonOf(p)}`
            : '本地已锁定；题库里没有这道题的元数据')
          groups[band].push({ ...p, reason })
        }
        bands = BAND_KEYS.map((key) => ({
          key,
          label: ranges[key].label,
          description: ranges[key].description,
          range: ((): [number | null, number | null] => {
            const mdRange = parsedMd.ranges.get(key)
            return mdRange ? [mdRange.min, mdRange.max] : [ranges[key].min, ranges[key].max]
          })(),
          problems: groups[key].sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0)),
          pool: groups[key].length,
        }))
      } else {
        const candidates: CandidateProblem[] = store.getUnsolvedCandidates()
          .filter((p) => !planKeys.has(p.platform + ':' + p.problemKey))
          .map((p) => ({
            id: p.id,
            platform: p.platform,
            problemKey: p.problemKey,
            title: p.title,
            difficulty: p.difficulty,
            url: p.url,
            tags: p.tags,
          }))

        const rotate = num(args.rotate, 0, 0, 500)
        const exclude = new Set<number>()
        bands = BAND_KEYS.map((key) => {
          const q = Number(args[key])
          const count = Number.isInteger(q) && q >= 0 && q <= 6 ? q : DEFAULT_COUNTS[key]
          const picked = pickBand(candidates, ranges[key], count, weakTags, exclude, rotate, focusTags, tagScores)
          for (const p of picked.problems) exclude.add(p.id)
          return {
            key,
            label: ranges[key].label,
            description: ranges[key].description,
            range: [ranges[key].min, ranges[key].max] as [number | null, number | null],
            problems: picked.problems.map((p) => ({ ...p, reason: reasonOf(p) })),
            pool: picked.pool,
          }
        })
      }

      // 把今天的题记为「今日训练索引」：日历完成度与红点都以它判定
      const indexed = bands.flatMap((b) => b.problems.map((p) => `${p.platform}:${p.problemKey}`))
      if (indexed.length > 0) store.setTrainingIndex(todayStr, indexed)

      // ---------- 写下今日训练 .md（随仓库同步） ----------
      const mdPath = mdFile
      let mdWritten = false
      if (!remoteScheduled) try {
        fs.mkdirSync(local.dir, { recursive: true })
        fs.writeFileSync(
          mdPath,
          renderTodayMarkdown({
            date: todayStr,
            level: levelInfo,
            windowDays,
            locked,
            mdPath,
            focus,
            bands,
          }),
          'utf8',
        )
        mdWritten = true
      } catch { /* 磁盘不可写时不影响推荐结果 */ }

      // 新生成的今日安排立即推回远端，另一台设备 pull 一下就能看到同一份
      let mdPush: { ok: boolean; message: string } | null = null
      if (mdWritten) {
        mdPush = gitCommitPush(localRoot, [path.join('practice', todayStr, `${todayStr}.md`)],
          `chore(today): ${todayStr} 今日训练安排`)
      }

      // 到期复习 + 计划进度
      const tasks = store.getTasksByDate(todayStr)
      const checked = tasks.filter((t) => t.checked).length
      const planProblems = tasks
        .filter((t) => t.problemKey && t.platform)
        .map((t) => ({ problemKey: t.problemKey, url: t.url ?? null, title: t.title }))

      return {
        ok: true,
        data: {
          date: todayStr,
          level,
          refreshedFromCf: refreshed,
          sources: {
            windowDays,
            rating: levelInfo.rating,
            practiceLevel: levelInfo.practiceLevel,
            contestLevel: levelInfo.contestLevel,
            practiceCount: levelInfo.practiceCount,
            contestCount: levelInfo.contestCount,
          },
          locked,
          scheduledBy: remoteScheduled ? 'remote' : 'local',
          gitSync: { ...sync, push: mdPush },
          mdPath: remoteScheduled ? mdPath : (mdWritten ? mdPath : null),
          bands: bands.map((b) => ({ ...b, problems: b.problems.map(({ reason, ...rest }) => rest) })),
          bandReasons: bands.flatMap((b) => b.problems.map((p) => ({ problemKey: p.problemKey, reason: p.reason }))),
          focus: focus ? { week: focus.week, direction: focus.direction, tags: focus.tags } : null,
          planProblems,
          planProgress: tasks.length > 0 ? { total: tasks.length, checked } : null,
        },
      }
    },
    presentCall: () => ({ card: 'generic', title: '今日训练推荐' }),
  }))
}
