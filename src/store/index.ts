/**
 * JSON 存储引擎：内存索引 + 落盘（替代 SQLite）。
 * 所有查询走内存 Map/Array，变更后防抖写盘。
 */

import type { FsService } from '../dsh-compat.ts'
import type { PlatformId } from '../types.ts'
import type {
  ProblemRecord,
  SubmissionRecord,
  SettingsRecord,
  StoreState,
} from './schema.ts'
import { defaultState } from './schema.ts'
// 难度分桶统一由 analysis/stats 提供，避免重复定义
import { bucketForDifficulty } from '../analysis/stats.ts'
import { filterNoiseTags } from '../analysis/tags.ts'

export { bucketForDifficulty }

const STATE_FILE = 'icpc-state.json'
const SAVE_DEBOUNCE_MS = 500

export interface SubmissionRow {
  platform: PlatformId
  verdict: string
  submittedAt: string
  problemKey: string
  difficulty: number | null
  tags: string[]
}

export interface StatsFilter {
  from?: string
  to?: string
  platform?: PlatformId
}

export class IcpcStore {
  private state: StoreState = defaultState()
  private fs: FsService
  private dataDir: string
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 提交索引：`${platform}:${problemKey}` → SubmissionRecord[]，避免 O(n×m) 全量扫描 */
  private subIndex: Map<string, SubmissionRecord[]> = new Map()
  /** 排序后的提交缓存（按时间降序），插入时追加、读取时直接用 */
  private sortedSubs: SubmissionRecord[] | null = null
  /** load() 完成信号：任何写盘（flush）必须等它，避免用空 state 覆盖磁盘上的真实数据 */
  private ready: Promise<void> = Promise.resolve()

  constructor(fs: FsService, dataDir: string) {
    this.fs = fs
    this.dataDir = dataDir
    this.ready = this.load()
  }

  /** 等待存储加载完成（首次调用前 await，避免读到空状态或写盘覆盖） */
  awaitReady(): Promise<void> {
    return this.ready
  }

  /** 重建提交索引（load 后或批量插入后调用） */
  private rebuildSubIndex(): void {
    this.subIndex = new Map()
    for (const s of this.state.submissions) {
      const key = `${s.platform}:${s.problemKey}`
      const arr = this.subIndex.get(key) ?? []
      arr.push(s)
      this.subIndex.set(key, arr)
    }
    this.sortedSubs = null
  }

  /** 获取按时间降序排序的提交（缓存） */
  private getSortedSubs(): SubmissionRecord[] {
    if (!this.sortedSubs) {
      this.sortedSubs = this.state.submissions
        .filter((s) => this.belongsToCurrentAccount(s))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    }
    return this.sortedSubs
  }

  async load(): Promise<void> {
    try {
      const filePath = `${this.dataDir}/${STATE_FILE}`
      const exists = await this.fs.exists(filePath)
      if (exists) {
        const raw = await this.fs.readFile(filePath)
        this.state = { ...defaultState(), ...JSON.parse(raw) }
        // 向前兼容：确保新字段存在
        if (!this.state.settings.adapterEnabled) this.state.settings.adapterEnabled = {}
        if (!this.state.settings.cookies) this.state.settings.cookies = {}
        if (!this.state.settings.reminder) this.state.settings.reminder = { enabled: false, time: '20:00' }
        if (!this.state.settings.accounts) this.state.settings.accounts = {}
        if (!this.state.trainingIndex) this.state.trainingIndex = {}
        if (!this.state.bankSyncedAt) this.state.bankSyncedAt = null
        // 迁移：旧版本写入的提交没有 handle，补成当前绑定的账号，
        // 这样以后换号时它们会自动被过滤掉，而不是混进新账号的统计
        for (const s of this.state.submissions) {
          if (!s.handle) s.handle = this.state.settings.accounts[s.platform]?.handle
        }
      }
    } catch (e) {
      const msg = (e as Error).message
      console.warn(`[icpc-store] load failed, starting fresh: ${msg}`)
      // 解析失败时把坏文件改名留档，避免下一次 flush 直接覆盖掉（数据就找不回来了）
      try {
        const bad = `${this.dataDir}/${STATE_FILE}.corrupt-${Date.now()}`
        if (this.fs.rename) await this.fs.rename(`${this.dataDir}/${STATE_FILE}`, bad)
        console.warn(`[icpc-store] corrupted state backed up to ${bad}`)
      } catch { /* 备份失败就算了，至少别崩 */ }
    }
    this.rebuildSubIndex()
    // 计划/复习库/模板库都已下线：启动时清掉旧 JSON 里残留的字段
    this.purgeLegacyFields()
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS)
  }

  async flush(): Promise<void> {
    // 必须先等 load 完成：否则会用默认空 state 覆盖磁盘上的真实数据
    try {
      await this.ready
    } catch (e) {
      console.error(`[icpc-store] flush skipped, load not ready: ${(e as Error).message}`)
      return
    }
    const target = `${this.dataDir}/${STATE_FILE}`
    try {
      await this.fs.mkdir(this.dataDir)
      const json = JSON.stringify(this.state, null, 2)
      if (this.fs.rename) {
        // 原子写：先写临时文件，再整体覆盖，进程中途被杀也不会留下半个 JSON
        const tmp = `${target}.tmp-${process.pid}`
        await this.fs.writeFile(tmp, json)
        await this.fs.rename(tmp, target)
      } else {
        await this.fs.writeFile(target, json)
      }
    } catch (e) {
      console.error(`[icpc-store] flush failed: ${(e as Error).message}`)
    }
  }

  // ---------- Settings ----------

  getSettings(): SettingsRecord {
    return this.state.settings
  }

  /** 本地题目根目录（训练目录同步用） */
  getLocalRoot(): string {
    return this.state.settings.localRoot ?? ''
  }

  setLocalRoot(root: string): void {
    this.state.settings.localRoot = root.trim()
    this.scheduleSave()
  }

  updateSettings(patch: Partial<SettingsRecord>): void {
    if (patch.ai) this.state.settings.ai = { ...this.state.settings.ai, ...patch.ai }
    if (patch.adapterEnabled) this.state.settings.adapterEnabled = { ...this.state.settings.adapterEnabled, ...patch.adapterEnabled }
    if (patch.cookies) this.state.settings.cookies = { ...this.state.settings.cookies, ...patch.cookies }
    if (patch.reminder) this.state.settings.reminder = { ...this.state.settings.reminder, ...patch.reminder }
    this.scheduleSave()
  }

  getHandle(platform: PlatformId): string | undefined {
    return this.state.settings.accounts[platform]?.handle
  }

  getAccount(platform: PlatformId): { handle: string; lastSyncAt: string | null; enabled: boolean } | undefined {
    const a = this.state.settings.accounts[platform]
    return a ? { handle: a.handle, lastSyncAt: a.lastSyncAt, enabled: a.enabled } : undefined
  }

  setAccount(platform: PlatformId, handle: string): void {
    const existing = this.state.settings.accounts[platform]
    // 换号时先把没有 handle 的旧记录归到旧账号名下，
    // 否则它们会在下次加载时被历史迁移逻辑认成新账号的数据。
    if (existing?.handle && existing.handle !== handle) {
      for (const sub of this.state.submissions) {
        if (sub.platform === platform && !sub.handle) sub.handle = existing.handle
      }
    }
    this.state.settings.accounts[platform] = {
      platform, handle,
      // 换 handle 时重置 lastSyncAt（下次同步全量重拉）
      lastSyncAt: existing && existing.handle === handle ? existing.lastSyncAt : null,
      enabled: true,
    }
    this.scheduleSave()
  }

  setAccountSyncTime(platform: PlatformId, time: string): void {
    const a = this.state.settings.accounts[platform]
    if (a) { a.lastSyncAt = time; this.scheduleSave() }
  }

  setAdapterEnabled(platform: PlatformId, enabled: boolean): void {
    this.state.settings.adapterEnabled[platform] = enabled
    this.scheduleSave()
  }

  getAdapterEnabled(platform: PlatformId): boolean {
    return this.state.settings.adapterEnabled[platform] !== false
  }

  setCookie(platform: PlatformId, cookie?: string, csrf?: string): void {
    if (!this.state.settings.cookies[platform]) this.state.settings.cookies[platform] = {}
    if (cookie !== undefined) {
      if (cookie === '') delete this.state.settings.cookies[platform]!.cookie
      else this.state.settings.cookies[platform]!.cookie = cookie
    }
    if (csrf !== undefined) {
      if (csrf === '') delete this.state.settings.cookies[platform]!.csrf
      else this.state.settings.cookies[platform]!.csrf = csrf
    }
    // 清理空对象
    if (this.state.settings.cookies[platform] && Object.keys(this.state.settings.cookies[platform]!).length === 0) {
      delete this.state.settings.cookies[platform]
    }
    this.scheduleSave()
  }

  getCookie(platform: PlatformId): { cookie?: string; csrf?: string } | undefined {
    return this.state.settings.cookies[platform]
  }

  setReminder(enabled?: boolean, time?: string): void {
    if (enabled !== undefined) this.state.settings.reminder.enabled = enabled
    if (time !== undefined) this.state.settings.reminder.time = time
    this.scheduleSave()
  }

  // ---------- Problems ----------

  upsertProblem(p: ProblemRecord): void {
    const idx = this.state.problems.findIndex(
      (x) => x.platform === p.platform && x.problemKey === p.problemKey,
    )
    if (idx >= 0) {
      this.state.problems[idx] = {
        ...this.state.problems[idx],
        ...p,
        difficulty: p.difficulty ?? this.state.problems[idx].difficulty,
      }
    } else {
      this.state.problems.push(p)
    }
    this.scheduleSave()
  }

  /**
   * 批量 upsert 题库题（不产生提交），difficulty 保留已有值（COALESCE），tags 仅非空时覆盖。
   * 全站题库约 1 万题，用 key→下标 的 Map 代替 findProblem 的线性查找，避免 O(n²)。
   */
  upsertBankProblems(rows: ProblemRecord[]): Array<{ platform: PlatformId; inserted: number; updated: number }> {
    const index = new Map<string, number>()
    for (let i = 0; i < this.state.problems.length; i++) {
      const p = this.state.problems[i]
      index.set(`${p.platform}:${p.problemKey}`, i)
    }
    const stats = new Map<PlatformId, { inserted: number; updated: number; seen: Set<string> }>()
    for (const r of rows) {
      const key = `${r.platform}:${r.problemKey}`
      const bucket = stats.get(r.platform) ?? { inserted: 0, updated: 0, seen: new Set<string>() }
      stats.set(r.platform, bucket)
      if (bucket.seen.has(key)) continue
      bucket.seen.add(key)
      const at = index.get(key)
      if (at === undefined) {
        this.state.problems.push(r)
        index.set(key, this.state.problems.length - 1)
        bucket.inserted++
      } else {
        const existing = this.state.problems[at]
        this.state.problems[at] = {
          ...existing,
          title: r.title || existing.title,
          difficulty: existing.difficulty ?? r.difficulty,
          url: r.url ?? existing.url,
          tags: r.tags.length > 0 ? r.tags : existing.tags,
        }
        bucket.updated++
      }
    }
    this.scheduleSave()
    return [...stats].map(([platform, s]) => ({ platform, inserted: s.inserted, updated: s.updated }))
  }

  findProblem(platform: PlatformId, problemKey: string): ProblemRecord | undefined {
    return this.state.problems.find(
      (p) => p.platform === platform && p.problemKey === problemKey,
    )
  }

  /** 题库条数（可按平台），用于判断题库是否还没同步过 */
  countProblems(platform?: PlatformId): number {
    if (!platform) return this.state.problems.length
    let n = 0
    for (const p of this.state.problems) if (p.platform === platform) n++
    return n
  }

  /** 浏览题目：支持 platform/difficulty/tag/q 关键词过滤，bank=1 包含未做题 */
  browseProblems(opts: {
    platform?: PlatformId
    difficulty?: string
    tag?: string
    q?: string
    bank?: boolean
    limit?: number
  } = {}): Array<ProblemRecord & { attempts: number; acCount: number; lastAcAt: string | null; status: string }> {
    const limit = opts.limit ?? 300
    let rows = this.state.problems
      .map((p) => {
        // 用索引查提交，避免全量扫描
        const subs = this.subIndex.get(`${p.platform}:${p.problemKey}`) ?? []
        const acSubs = subs.filter((s) => s.verdict === 'AC')
        const lastAcAt = acSubs.length > 0
          ? acSubs.map((s) => s.submittedAt).sort().pop() ?? null
          : null
        return {
          ...p,
          attempts: subs.length,
          acCount: acSubs.length,
          lastAcAt,
          status: acSubs.length > 0 ? 'ac' : subs.length > 0 ? 'tried' : 'none',
        }
      })
    if (!opts.bank) {
      rows = rows.filter((r) => r.attempts > 0)
    }
    if (opts.platform) {
      rows = rows.filter((r) => r.platform === opts.platform)
    }
    if (opts.q && opts.q.trim()) {
      const q = opts.q.trim()
      rows = rows.filter((r) => r.title.includes(q) || r.problemKey.includes(q))
    }
    rows = rows.sort((a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1))
    if (opts.difficulty) {
      rows = rows.filter((r) => bucketForDifficulty(r.difficulty) === opts.difficulty)
    }
    if (opts.tag) {
      rows = rows.filter((r) => r.tags.includes(opts.tag!))
    }
    return rows.slice(0, limit)
  }

  // ---------- Submissions ----------

  /** 当前绑定的账号名（换号后旧账号的提交不再计入统计） */
  private handleFor(platform: PlatformId): string | undefined {
    return this.state.settings.accounts[platform]?.handle
  }

  /**
   * 这条提交是否属于当前账号。
   * 没有 handle 的历史记录（旧版本写入的）视为属于当前账号，避免升级后统计突然清空；
   * load() 里会把它们补上 handle。
   */
  private belongsToCurrentAccount(s: SubmissionRecord): boolean {
    const h = this.handleFor(s.platform)
    if (!h) return true
    return !s.handle || s.handle === h
  }

  insertSubmissions(subs: SubmissionRecord[]): { imported: number; skipped: number } {
    const existing = new Set(this.state.submissions.map((s) => s.externalId))
    let imported = 0
    let skipped = 0
    for (const s of subs) {
      if (existing.has(s.externalId)) {
        skipped++
        continue
      }
      existing.add(s.externalId)
      this.state.submissions.push(s)
      // 维护提交索引
      const key = `${s.platform}:${s.problemKey}`
      const arr = this.subIndex.get(key) ?? []
      arr.push(s)
      this.subIndex.set(key, arr)
      // 仅在题目不存在时创建占位记录（不覆盖已有题目的标题/难度/标签）
      if (!this.findProblem(s.platform, s.problemKey)) {
        this.state.problems.push({
          platform: s.platform,
          problemKey: s.problemKey,
          title: s.problemKey,
          difficulty: null,
          url: null,
          tags: [],
        })
        this.scheduleSave()
      }
      imported++
    }
    this.sortedSubs = null  // 使排序缓存失效
    this.scheduleSave()
    return { imported, skipped }
  }

  /** 清空提交记录（换号/清理历史用）。内存和磁盘一起更新，避免被运行中的进程写回。 */
  clearSubmissions(): { submissions: number } {
    const removed = this.state.submissions.length
    this.state.submissions = []
    this.subIndex = new Map()
    this.sortedSubs = null
    this.rebuildSubIndex()
    this.scheduleSave()
    return { submissions: removed }
  }

  /** 清掉旧版本遗留字段（计划 / 复习库 / 模板库都已下线），返回被清掉的字段名 */
  purgeLegacyFields(): string[] {
    const legacy = this.state as unknown as Record<string, unknown>
    const removed: string[] = []
    for (const key of ['plans', 'reviews', 'templateProgress', 'customTemplates']) {
      if (key in legacy) {
        delete legacy[key]
        removed.push(key)
      }
    }
    if (removed.length) this.scheduleSave()
    return removed
  }

  getKnownExternalIds(platform?: PlatformId): Set<string> {
    return new Set(
      this.state.submissions
        .filter((s) => !platform || s.platform === platform)
        .map((s) => s.externalId),
    )
  }

  getSubmissionRows(filter: StatsFilter = {}): SubmissionRow[] {
    const problemMap = new Map(
      this.state.problems.map((p) => [`${p.platform}:${p.problemKey}`, p]),
    )
    return this.state.submissions
      .filter((s) => {
        if (!this.belongsToCurrentAccount(s)) return false
        if (filter.platform && s.platform !== filter.platform) return false
        if (filter.from && s.submittedAt < filter.from) return false
        if (filter.to && s.submittedAt > filter.to) return false
        return true
      })
      .map((s) => {
        const p = problemMap.get(`${s.platform}:${s.problemKey}`)
        return {
          platform: s.platform,
          verdict: s.verdict,
          submittedAt: s.submittedAt,
          problemKey: s.problemKey,
          difficulty: p?.difficulty ?? null,
          tags: p?.tags ?? [],
        }
      })
  }

  /** 获取某道题的提交记录（用索引，O(1) 查找） */
  getSubmissionsForProblem(platform: PlatformId, problemKey: string): SubmissionRecord[] {
    return (this.subIndex.get(`${platform}:${problemKey}`) ?? []).filter((s) =>
      this.belongsToCurrentAccount(s),
    )
  }

  getAcKeys(): Set<string> {
    const set = new Set<string>()
    for (const s of this.state.submissions) {
      if (s.verdict !== 'AC') continue
      if (!this.belongsToCurrentAccount(s)) continue
      set.add(`${s.platform}:${s.problemKey}`)
    }
    return set
  }

  getRecentAcDifficulties(since: string): number[] {
    const problemMap = new Map(
      this.state.problems.map((p) => [`${p.platform}:${p.problemKey}`, p]),
    )
    const diffs: number[] = []
    const seen = new Set<string>()
    for (const s of this.getSortedSubs()) {
      if (s.verdict !== 'AC' || s.submittedAt < since) continue
      const key = `${s.platform}:${s.problemKey}`
      if (seen.has(key)) continue
      seen.add(key)
      const p = problemMap.get(key)
      if (p?.difficulty != null) diffs.push(p.difficulty)
    }
    return diffs
  }

  /** 按平台 + 题号查题目记录（今日训练锁定本地已有题目时用） */
  getProblemByKey(platform: PlatformId, problemKey: string): ProblemRecord | null {
    return this.state.problems.find((p) => p.platform === platform && p.problemKey === problemKey) ?? null
  }

  getUnsolvedCandidates(): Array<ProblemRecord & { id: number }> {
    const acKeys = this.getAcKeys()
    return this.state.problems
      .map((p, i) => ({ ...p, id: i + 1 }))
      .filter(
        (p) =>
          p.difficulty != null &&
          !acKeys.has(`${p.platform}:${p.problemKey}`),
      )
  }

  /** 题库里出现过的所有算法标签（过滤噪声标签） */
  getAllTags(): string[] {
    const tags = new Set<string>()
    for (const p of this.state.problems) {
      for (const tag of filterNoiseTags(p.tags ?? [])) tags.add(tag)
    }
    return [...tags].sort()
  }

  setTrainingIndex(date: string, keys: string[]): void {
    this.state.trainingIndex[date] = [...new Set(keys)]
    this.scheduleSave()
  }

  getTrainingIndex(date: string): string[] {
    return this.state.trainingIndex[date] ?? []
  }

  setBankSyncedAt(iso: string): void {
    this.state.bankSyncedAt = iso
    this.scheduleSave()
  }

  getBankSyncedAt(): string | null {
    return this.state.bankSyncedAt ?? null
  }

  /** 月视图：按提交记录统计每天的提交数与 AC 数（计划任务已下线） */
  getMonthView(month: string): Array<{ date: string; total: number; checked: number }> {
    const byDate = new Map<string, { total: number; checked: number }>()
    for (const row of this.getSubmissionRows({ from: `${month}-01`, to: `${month}-31T23:59:59Z` })) {
      const date = row.submittedAt.slice(0, 10)
      const cur = byDate.get(date) ?? { total: 0, checked: 0 }
      cur.total++
      if (row.verdict === 'AC') cur.checked++
      byDate.set(date, cur)
    }
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

}
