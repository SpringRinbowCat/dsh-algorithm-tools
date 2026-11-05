/** 训练目录的 git 同步：拉取远端、只提交训练相关路径再推送 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface GitResult {
  ok: boolean
  message: string
}

export function isGitRepo(root: string): boolean {
  return Boolean(root) && fs.existsSync(path.join(root, '.git'))
}

export function gitPull(root: string, timeout = 20_000): GitResult {
  if (!isGitRepo(root)) return { ok: false, message: 'not-a-git-repo' }
  const r = spawnSync('git', ['-C', root, 'pull', '--rebase', '--autostash', '--quiet'], {
    timeout,
    encoding: 'utf8',
  })
  if (r.error) return { ok: false, message: r.error.message }
  if (r.status !== 0) {
    return { ok: false, message: (r.stderr || '').trim().slice(0, 300) || `git exit ${r.status}` }
  }
  return { ok: true, message: (r.stdout || '').trim().slice(0, 300) || 'up-to-date' }
}

/**
 * 冲突时以远端为准：先正常 pull，失败就放弃本地 rebase，
 * 只把这几个「安排类」路径强制对齐远端（不碰题目代码），然后继续。
 */
export function gitPullForceRemote(
  root: string,
  relPaths: string[],
  timeout = 25_000,
): GitResult & { forced: string[] } {
  const first = gitPull(root, timeout)
  if (first.ok) return { ...first, forced: [] }
  if (!isGitRepo(root)) return { ok: false, message: 'not-a-git-repo', forced: [] }

  // 放弃半途的 rebase/merge，避免仓库停在冲突状态
  spawnSync('git', ['-C', root, 'rebase', '--abort'], { timeout, encoding: 'utf8' })
  spawnSync('git', ['-C', root, 'merge', '--abort'], { timeout, encoding: 'utf8' })
  spawnSync('git', ['-C', root, 'fetch', '--quiet'], { timeout, encoding: 'utf8' })

  const up = spawnSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    timeout,
    encoding: 'utf8',
  })
  const upstream = (up.stdout || '').trim() || 'origin/main'

  // 先找出和远端有差异的「训练相关」路径（含题目代码），逐个用远端版本覆盖
  const scope = ['practice', 'taskList']
  const diff = spawnSync('git', ['-C', root, 'diff', '--name-only', upstream, '--', ...scope], {
    timeout,
    encoding: 'utf8',
  })
  const targets = new Set<string>([
    ...relPaths,
    ...(diff.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean),
  ])

  const forced: string[] = []
  for (const rel of targets) {
    const r = spawnSync('git', ['-C', root, 'checkout', upstream, '--', rel], { timeout, encoding: 'utf8' })
    if (r.status === 0) forced.push(rel)
  }
  return {
    ok: forced.length > 0,
    message: forced.length > 0 ? `remote-wins: ${forced.join(', ')}` : `pull failed: ${first.message}`,
    forced,
  }
}

/** 只暂存并提交指定相对路径，推送到远端；失败不抛异常 */
export function gitCommitPush(
  root: string,
  relPaths: string[],
  message: string,
  timeout = 30_000,
): GitResult {
  if (!isGitRepo(root)) return { ok: false, message: 'not-a-git-repo' }
  const paths = [...new Set(relPaths.filter(Boolean))]
  if (paths.length === 0) return { ok: false, message: 'no-paths' }

  const add = spawnSync('git', ['-C', root, 'add', '--', ...paths], { timeout, encoding: 'utf8' })
  if (add.status !== 0) return { ok: false, message: (add.stderr || '').trim().slice(0, 300) || 'add failed' }

  const commit = spawnSync('git', ['-C', root, 'commit', '-q', '-m', message, '--', ...paths], {
    timeout,
    encoding: 'utf8',
  })
  // 没有改动时 commit 返回 1，这里不算失败（仍然尝试推送）
  const nothingToCommit = commit.status === 1

  const push = spawnSync('git', ['-C', root, 'push', '--quiet'], { timeout, encoding: 'utf8' })
  if (push.status !== 0) {
    return { ok: false, message: (push.stderr || '').trim().slice(0, 300) || 'push failed' }
  }
  return { ok: true, message: nothingToCommit ? 'pushed (no local change)' : 'pushed' }
}
