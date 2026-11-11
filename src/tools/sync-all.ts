import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import type { IcpcHost } from '../index.ts'
import type { Context } from '../dsh-compat.ts'
import { defineTool } from '../dsh-compat.ts'
import { textOutput, ANY_OUTPUT } from './helpers.ts'
import { syncPlatform } from './sync-helpers.ts'
import { gitCommitPush, gitPullForceRemote } from '../util/git.ts'

interface PendingRank {
  letter: string
  source: 'pending' | 'rank'
  dir: string
}

const LETTER_RE = /^[A-Z]\d?$/

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function listPendingRank(root: string): PendingRank[] {
  const out: PendingRank[] = []
  const add = (base: string, source: PendingRank['source']): void => {
    if (!fs.existsSync(base)) return
    for (const name of fs.readdirSync(base)) {
      if (!LETTER_RE.test(name)) continue
      const dir = path.join(base, name)
      if (isDir(dir)) out.push({ letter: name, source, dir })
    }
  }
  add(path.join(root, 'rank', '_pending'), 'pending')
  add(path.join(root, 'rank'), 'rank')
  return out.sort((a, b) => a.letter.localeCompare(b.letter))
}

function setProblemLink(file: string, contestId: number, letter: string): void {
  const link = `// https://codeforces.com/problemset/problem/${contestId}/${letter}`
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  lines[0] = link
  fs.writeFileSync(file, lines.join('\n'), 'utf8')
}

function finalizeRank(
  root: string,
  contestId: number,
  pending: PendingRank[],
): { completed: string[]; errors: string[] } {
  const completed: string[] = []
  const errors: string[] = []

  for (const item of pending) {
    const target = path.join(root, 'rank', String(contestId), `${contestId}${item.letter}`)
    try {
      if (fs.existsSync(target)) throw new Error('目标目录已存在')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.renameSync(item.dir, target)

      const files = fs.readdirSync(target)
      const oldCpp = files.find((f) => f === `${item.letter}.cpp`) ?? files.find((f) => f.endsWith('.cpp'))
      if (!oldCpp) throw new Error('目录内没有 .cpp 文件')

      const newCpp = `${contestId}${item.letter}.cpp`
      if (oldCpp !== newCpp) {
        fs.renameSync(path.join(target, oldCpp), path.join(target, newCpp))
      }
      setProblemLink(path.join(target, newCpp), contestId, item.letter)
      completed.push(item.letter)
    } catch (e) {
      errors.push(`${item.letter}: ${(e as Error).message}`)
    }
  }

  const pendingDir = path.join(root, 'rank', '_pending')
  try {
    if (fs.existsSync(pendingDir) && fs.readdirSync(pendingDir).length === 0) {
      fs.rmdirSync(pendingDir)
    }
  } catch {
    // 目录非空时保留
  }

  return { completed, errors }
}

function changedPaths(root: string): string[] {
  const r = spawnSync('git', ['-C', root, 'status', '--porcelain', '--', 'practice', 'rank', 'taskList'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (r.status !== 0) return []
  return (r.stdout || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rest = line.slice(3).trim()
      const target = rest.includes(' -> ') ? rest.split(' -> ').pop()! : rest
      return target.replace(/^"|"$/g, '')
    })
}

export function registerSyncAllTool(host: IcpcHost, ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'icpc_sync_all',
    description:
      '同步 Codeforces 提交记录，并检查/提交本地训练仓库。' +
      '自动处理 rank/_pending 字母目录：未提供 contestId 时返回 needContestId 和待补全题号，不提交；' +
      '提供 contestId 后完成目录、文件名、题链重命名，再提交 practice/rank/taskList 中的源码和训练文档并推送。',
    parameters: {
      contestId: {
        type: 'number',
        description: 'rank/_pending 题号对应的 Codeforces 比赛号；没有待补全目录时不用填',
      },
    },
    output: { schema: ANY_OUTPUT, render: (_a, v) => textOutput(v) },
    async execute(args) {
      const { store } = host
      const root = store.getLocalRoot() || host.localRoot
      if (!root) return { ok: false, error: '未设置本地训练仓库目录' }

      const handle = store.getHandle('codeforces')
      if (!handle) return { ok: false, error: '未绑定 Codeforces 账号' }

      const sync = await syncPlatform(host, 'codeforces', handle)
      await store.flush()

      const pull = gitPullForceRemote(root, ['taskList'])
      const pending = listPendingRank(root)

      if (pending.length > 0 && args.contestId == null) {
        return {
          ok: false,
          needContestId: true,
          imported: sync.imported,
          syncErrors: sync.errors,
          pending: pending.map((p) => p.letter),
          message: `rank/_pending 还有题号：${pending.map((p) => p.letter).join('、')}。请提供这场比赛对应的 Codeforces 比赛号。`,
          git: { pull },
        }
      }

      let completed: string[] = []
      let rankErrors: string[] = []
      if (pending.length > 0) {
        const contestId = Number(args.contestId)
        if (!Number.isInteger(contestId) || contestId <= 0) {
          return { ok: false, needContestId: true, error: 'contestId 必须是正整数', pending: pending.map((p) => p.letter) }
        }
        const result = finalizeRank(root, contestId, pending)
        completed = result.completed
        rankErrors = result.errors
        const remaining = listPendingRank(root).map((p) => p.letter)
        if (remaining.length > 0 || rankErrors.length > 0) {
          return {
            ok: false,
            needContestId: remaining.length > 0,
            imported: sync.imported,
            syncErrors: sync.errors,
            pending: remaining,
            completed,
            rankErrors,
            message: remaining.length > 0
              ? `rank/_pending 仍有题号：${remaining.join('、')}，未提交`
              : 'rank 重命名有错误，未提交',
            git: { pull },
          }
        }
      }

      const changed = changedPaths(root)
      if (changed.length === 0) {
        return {
          ok: true,
          imported: sync.imported,
          syncErrors: sync.errors,
          pending: [],
          completed,
          committed: [],
          changed: [],
          push: null,
          git: { pull },
        }
      }

      const push = gitCommitPush(root, ['practice', 'rank', 'taskList'], 'chore(sync): 同步训练数据')
      return {
        ok: push.ok,
        imported: sync.imported,
        syncErrors: sync.errors,
        pending: [],
        completed,
        committed: changed,
        changed,
        push,
        git: { pull },
      }
    },
    presentCall: () => ({ card: 'generic', title: '同步数据' }),
  }))
}
