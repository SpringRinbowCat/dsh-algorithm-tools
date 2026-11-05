/**
 * 训练计划的文件化存储：<训练根>/taskList/<startDate>.md
 *
 * 用 Markdown 而不是 JSON：人和 AI 都能直接读、直接改。
 * 旧版本的 .json 仍可读（只读兼容），新写入一律是 .md。
 */

import fs from 'node:fs'
import path from 'node:path'

import type { IcpcStore } from '../store/index.ts'
import type { PlatformId, TaskKind } from '../types.ts'

export interface TaskListTask {
  taskDate: string
  title: string
  kind: TaskKind
  platform?: PlatformId
  problemKey?: string
  url?: string | null
  note?: string | null
  checked: boolean
}

export interface TaskListPlan {
  startDate: string
  endDate: string
  title: string
  goal: string
  source: 'ai' | 'template' | 'manual'
  weeks?: Array<{ index: number; startDate: string; direction: string; tags: string[] }>
  tasks: TaskListTask[]
  updatedAt: string
}

const KINDS: TaskKind[] = ['practice', 'review', 'topic', 'contest']

export function taskListDir(root: string): string {
  return path.join(root, 'taskList')
}

export function taskFile(root: string, startDate: string): string {
  return path.join(taskListDir(root), `${startDate}.md`)
}

export function taskFileRel(startDate: string): string {
  return path.join('taskList', `${startDate}.md`)
}

// ---------- 读 ----------

function parseTaskLine(line: string): TaskListTask | null {
  const m = /^- \[([ xX])\] (\d{4}-\d{2}-\d{2}) · (.+)$/.exec(line.trim())
  if (!m) return null
  const checked = m[1].toLowerCase() === 'x'
  const fields = m[3].split(' · ')
  let url: string | null = null
  let kind: TaskKind = 'practice'
  let note: string | null = null
  const titleParts: string[] = []
  for (const f of fields) {
    if (/^https?:\/\//.test(f)) url = f
    else if (KINDS.includes(f as TaskKind)) kind = f as TaskKind
    else if (f.startsWith('备注：')) note = f.slice(3)
    else titleParts.push(f)
  }
  const title = titleParts.join(' · ').trim()
  if (!title) return null
  const key = /(\d{3,6}[A-Z]\d?)/.exec(title)?.[1]
  return {
    taskDate: m[2],
    title,
    kind,
    platform: key ? 'codeforces' : undefined,
    problemKey: key,
    url,
    note,
    checked,
  }
}

export function parsePlanMarkdown(text: string, fallbackStart?: string): TaskListPlan | null {
  const lines = text.split(/\r?\n/)
  const plan: TaskListPlan = {
    startDate: fallbackStart ?? '',
    endDate: '',
    title: '',
    goal: '',
    source: 'template',
    weeks: [],
    tasks: [],
    updatedAt: '',
  }

  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('# ') && !plan.title) plan.title = t.slice(2).trim()
    else if (t.startsWith('> ') && !plan.goal) plan.goal = t.slice(2).trim()
    else if (t.startsWith('- 起始：')) plan.startDate = t.slice(5).trim()
    else if (t.startsWith('- 结束：')) plan.endDate = t.slice(5).trim()
    else if (t.startsWith('- 来源：')) plan.source = (t.slice(5).trim() as TaskListPlan['source']) || 'template'
    else if (t.startsWith('- 更新：')) plan.updatedAt = t.slice(5).trim()
    else if (t.startsWith('- 第 ')) {
      const w = /^- 第 (\d+) 周（(\d{4}-\d{2}-\d{2}) 起）方向：(.+?)；标签：(.+)$/.exec(t)
      if (w) {
        plan.weeks!.push({
          index: Number(w[1]),
          startDate: w[2],
          direction: w[3].trim(),
          tags: w[4].split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        })
      }
    } else {
      const task = parseTaskLine(t)
      if (task) plan.tasks.push(task)
    }
  }

  if (!plan.title || !plan.startDate || plan.tasks.length === 0) return null
  if (!plan.weeks?.length) plan.weeks = undefined
  return plan
}

export function readPlanFile(root: string, startDate: string): TaskListPlan | null {
  const md = taskFile(root, startDate)
  try {
    if (fs.existsSync(md)) return parsePlanMarkdown(fs.readFileSync(md, 'utf8'), startDate)
  } catch { /* 读坏就当没有 */ }
  // 兼容旧版 .json
  const json = path.join(taskListDir(root), `${startDate}.json`)
  try {
    if (fs.existsSync(json)) return JSON.parse(fs.readFileSync(json, 'utf8')) as TaskListPlan
  } catch { /* ignore */ }
  return null
}

export function readAllPlanFiles(root: string): TaskListPlan[] {
  const dir = taskListDir(root)
  const byStart = new Map<string, TaskListPlan>()
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      try {
        if (name.endsWith('.md')) {
          const plan = parsePlanMarkdown(fs.readFileSync(full, 'utf8'), name.replace(/\.md$/, ''))
          if (plan) byStart.set(plan.startDate, plan)
        } else if (name.endsWith('.json')) {
          const plan = JSON.parse(fs.readFileSync(full, 'utf8')) as TaskListPlan
          if (plan?.startDate && !byStart.has(plan.startDate)) byStart.set(plan.startDate, plan)
        }
      } catch { /* 单个文件坏了不影响其他 */ }
    }
  } catch { /* 目录不存在 */ }
  return [...byStart.values()]
}

// ---------- 写 ----------

export function renderPlanMarkdown(plan: TaskListPlan): string {
  const out: string[] = []
  out.push(`# ${plan.title}`, '')
  if (plan.goal) out.push(`> ${plan.goal}`, '')
  out.push(`- 起始：${plan.startDate}`)
  out.push(`- 结束：${plan.endDate}`)
  out.push(`- 来源：${plan.source}`)
  out.push(`- 更新：${plan.updatedAt}`, '')

  if (plan.weeks?.length) {
    out.push('## 计划方向', '')
    for (const w of plan.weeks) {
      out.push(`- 第 ${w.index} 周（${w.startDate} 起）方向：${w.direction}；标签：${w.tags.join(', ')}`)
    }
    out.push('')
  }

  out.push('## 每日任务', '')
  out.push('勾选 `[x]` 表示完成；这一份是跨设备唯一真相，插件按它同步。', '')
  const tasks = [...plan.tasks].sort((a, b) => a.taskDate.localeCompare(b.taskDate))
  for (const t of tasks) {
    const parts = [`- [${t.checked ? 'x' : ' '}] ${t.taskDate}`, t.title]
    if (t.url) parts.push(t.url)
    if (t.kind !== 'practice') parts.push(t.kind)
    if (t.note) parts.push(`备注：${t.note}`)
    out.push(parts.join(' · '))
  }
  out.push('')
  return out.join('\n')
}

export function writePlanFile(root: string, plan: TaskListPlan): boolean {
  try {
    fs.mkdirSync(taskListDir(root), { recursive: true })
    fs.writeFileSync(taskFile(root, plan.startDate), renderPlanMarkdown(plan), 'utf8')
    // 旧的 json 留在仓库里会和 md 打架，写 md 时顺手清掉
    const json = path.join(taskListDir(root), `${plan.startDate}.json`)
    if (fs.existsSync(json)) fs.unlinkSync(json)
    return true
  } catch {
    return false
  }
}

export function writePlanFromRecord(
  root: string,
  plan: {
    startDate: string
    endDate: string
    title: string
    goal: string
    source: 'ai' | 'template' | 'manual'
    weeks?: Array<{ index: number; startDate: string; direction: string; tags: string[] }>
    tasks: Array<{
      taskDate: string
      title: string
      kind: TaskKind
      platform?: PlatformId
      problemKey?: string
      url?: string | null
      note?: string | null
      checked: boolean
    }>
  },
): boolean {
  return writePlanFile(root, {
    startDate: plan.startDate,
    endDate: plan.endDate,
    title: plan.title,
    goal: plan.goal,
    source: plan.source,
    weeks: plan.weeks,
    tasks: plan.tasks.map((t) => ({
      taskDate: t.taskDate,
      title: t.title,
      kind: t.kind,
      platform: t.platform,
      problemKey: t.problemKey,
      url: t.url ?? null,
      note: t.note ?? null,
      checked: t.checked,
    })),
    updatedAt: new Date().toISOString(),
  })
}

export function removePlanFile(root: string, startDate: string): void {
  for (const f of [taskFile(root, startDate), path.join(taskListDir(root), `${startDate}.json`)]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    } catch { /* 删不掉就算了 */ }
  }
}

/** 把 taskList 里的计划同步进本地 state：没有就建，有就按文件覆盖任务状态 */
export function syncPlansFromFiles(store: IcpcStore, root: string): { created: number; updated: number } {
  let created = 0
  let updated = 0
  for (const plan of readAllPlanFiles(root)) {
    const existing = store.findPlanByStartDate(plan.startDate)
    const tasks = plan.tasks.map((t) => ({
      id: 0,
      taskDate: t.taskDate,
      title: t.title,
      kind: t.kind,
      platform: t.platform,
      problemKey: t.problemKey,
      url: t.url ?? null,
      note: t.note ?? null,
      checked: Boolean(t.checked),
    }))
    if (existing) {
      if (store.replacePlanTasks(existing.id, tasks)) updated++
    } else {
      store.createPlan({
        title: plan.title,
        goal: plan.goal,
        startDate: plan.startDate,
        endDate: plan.endDate,
        source: plan.source,
        weeks: plan.weeks,
        tasks,
      })
      created++
    }
  }
  return { created, updated }
}
