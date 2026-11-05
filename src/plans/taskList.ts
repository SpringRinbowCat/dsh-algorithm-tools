/**
 * 训练计划的文件化存储：<训练根>/taskList/<startDate>.json
 * 文件是跨设备的唯一真相，state 只是本地缓存。
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

export function taskListDir(root: string): string {
  return path.join(root, 'taskList')
}

export function taskFile(root: string, startDate: string): string {
  return path.join(taskListDir(root), `${startDate}.json`)
}

export function taskFileRel(startDate: string): string {
  return path.join('taskList', `${startDate}.json`)
}

export function readPlanFile(root: string, startDate: string): TaskListPlan | null {
  const file = taskFile(root, startDate)
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskListPlan
  } catch {
    return null
  }
}

export function readAllPlanFiles(root: string): TaskListPlan[] {
  const dir = taskListDir(root)
  const out: TaskListPlan[] = []
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as TaskListPlan)
      } catch { /* 单个文件坏了不影响其他 */ }
    }
  } catch { /* 目录不存在 */ }
  return out
}

export function writePlanFile(root: string, plan: TaskListPlan): boolean {
  try {
    fs.mkdirSync(taskListDir(root), { recursive: true })
    fs.writeFileSync(taskFile(root, plan.startDate), `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
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
  try {
    const f = taskFile(root, startDate)
    if (fs.existsSync(f)) fs.unlinkSync(f)
  } catch { /* 删不掉就算了 */ }
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
