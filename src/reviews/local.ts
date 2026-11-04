/**
 * 本地 Codeforces 目录扫描：把「我实际写过代码的题」收集出来，用于自动收进复习库。
 *
 * 目录约定（来自用户现有工作流）：
 *   D:\codeforces\<YYYY-MM-DD>\<problemKey>\<problemKey>.cpp
 *   D:\codeforces\practise\<YYYY-MM-DD>\<problemKey>\...
 * 但也兼容任意深度：只要目录名或 .cpp 文件名长得像题号，就当作一道题。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 2283A / 1926D / 1858E1 这类题号 */
const KEY_RE = /^(\d{3,6})([A-Z]\d?)$/i

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.idea', '.vscode', 'build', 'bin', 'obj'])

export interface LocalScanResult {
  root: string
  files: number
  dirs: number
  problems: Array<{ problemKey: string; file: string; mtime: string }>
  errors: string[]
}

function collect(root: string, maxDepth = 5, explicitRoot = false): LocalScanResult {
  const result: LocalScanResult = { root, files: 0, dirs: 0, problems: [], errors: [] }
  const seen = new Map<string, { file: string; mtime: number }>()

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      result.errors.push(`${dir}: ${(e as Error).message}`)
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        result.dirs++
        const m = KEY_RE.exec(entry.name)
        if (m) {
          const key = `${m[1]}${m[2].toUpperCase()}`
          const prev = seen.get(key)
          if (!prev) seen.set(key, { file: full, mtime: 0 })
        }
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.(cpp|cc|cxx|py)$/i.test(entry.name)) continue
      result.files++
      const base = entry.name.replace(/\.[^.]+$/, '')
      const m = KEY_RE.exec(base)
      if (!m) continue
      const key = `${m[1]}${m[2].toUpperCase()}`
      let mtime = 0
      try {
        mtime = fs.statSync(full).mtimeMs
      } catch {
        mtime = 0
      }
      const prev = seen.get(key)
      if (!prev || mtime > prev.mtime) seen.set(key, { file: full, mtime })
    }
  }

  if (fs.existsSync(root)) walk(root, 0)
  else if (explicitRoot) result.errors.push(`目录不存在: ${root}`)

  for (const [problemKey, v] of seen) {
    result.problems.push({
      problemKey,
      file: v.file,
      mtime: v.mtime > 0 ? new Date(v.mtime).toISOString() : '',
    })
  }
  result.problems.sort((a, b) => a.problemKey.localeCompare(b.problemKey))
  return result
}

/** 默认扫描根：优先 D:\codeforces，其次用户目录下的 codeforces */
export function defaultLocalRoots(): string[] {
  const roots = ['D:\\codeforces']
  const home = process.env.USERPROFILE ?? process.env.HOME
  if (home) roots.push(path.join(home, 'codeforces'))
  return roots
}

/** 扫描多个根目录，按题号去重 */
export function scanLocalProblems(root?: string): { scanned: LocalScanResult[]; problems: Array<{ problemKey: string; file: string; mtime: string }> } {
  const roots = root ? [root] : defaultLocalRoots()
  const scanned = roots.map((r) => collect(r, 5, Boolean(root)))
  const merged = new Map<string, { problemKey: string; file: string; mtime: string }>()
  for (const r of scanned) {
    for (const p of r.problems) {
      if (!merged.has(p.problemKey)) merged.set(p.problemKey, p)
    }
  }
  return { scanned, problems: [...merged.values()] }
}
