import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { IcpcStore } from '../src/store/index.ts'
import type { FsService } from '../src/store/index.ts'

/** 内存文件系统：测试里不需要真的写盘 */
function memFs(initial: Record<string, string> = {}): FsService {
  const files = new Map(Object.entries(initial))
  return {
    exists: async (p: string) => files.has(p),
    readFile: async (p: string) => files.get(p)!,
    writeFile: async (p: string, data: string) => void files.set(p, data),
    rename: async (a: string, b: string) => {
      const v = files.get(a)
      if (v !== undefined) {
        files.set(b, v)
        files.delete(a)
      }
    },
  } as FsService
}

const STATE = '/data/icpc-state.json'

async function makeStore(handle: string | undefined, submissions: unknown[] = []) {
  const state = {
    problems: [
      { platform: 'codeforces', problemKey: '100A', title: 'A', difficulty: 1200, url: null, tags: [] },
      { platform: 'codeforces', problemKey: '100B', title: 'B', difficulty: 1400, url: null, tags: [] },
    ],
    submissions,
    plans: [],
    reviews: [],
    templateProgress: [],
    customTemplates: [],
    trainingIndex: {},
    bankSyncedAt: null,
    settings: { accounts: handle ? { codeforces: { platform: 'codeforces', handle, lastSyncAt: null, enabled: true } } : {} },
  }
  const store = new IcpcStore(memFs({ [STATE]: JSON.stringify(state) }), '/data')
  await store.awaitReady()
  return store
}

function sub(problemKey: string, verdict: string, handle?: string, externalId = problemKey) {
  return {
    platform: 'codeforces',
    problemKey,
    verdict,
    submittedAt: '2026-11-01T00:00:00Z',
    externalId,
    ...(handle ? { handle } : {}),
  }
}

describe('按当前账号过滤提交', () => {
  it('只统计当前 handle 的 AC', async () => {
    const store = await makeStore('NewHandle', [
      sub('100A', 'AC', 'OldHandle', 'e1'),
      sub('100B', 'AC', 'NewHandle', 'e2'),
    ])
    assert.deepEqual([...store.getAcKeys()], ['codeforces:100B'])
  })

  it('换号后旧账号的提交不进统计行', async () => {
    const store = await makeStore('NewHandle', [
      sub('100A', 'WA', 'OldHandle', 'e1'),
      sub('100B', 'AC', 'NewHandle', 'e2'),
    ])
    const rows = store.getSubmissionRows()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].problemKey, '100B')
  })

  it('没有 handle 的历史记录补成当前账号（升级后不清空统计）', async () => {
    const store = await makeStore('CurrentOne', [sub('100A', 'AC', undefined, 'e1')])
    assert.deepEqual([...store.getAcKeys()], ['codeforces:100A'])
  })

  it('未绑定账号时不过滤', async () => {
    const store = await makeStore(undefined, [
      sub('100A', 'AC', 'AnyA', 'e1'),
      sub('100B', 'AC', 'AnyB', 'e2'),
    ])
    assert.equal(store.getAcKeys().size, 2)
  })
})

describe('换号时给旧记录打标（跨设备一致性）', () => {
  it('换号后旧账号的无 handle 提交会被归到旧账号，不再计入统计', async () => {
    // 模拟另一台设备：本地有旧账号提交，且都没有 handle 字段
    const store = await makeStore('OldHandle', [
      sub('100A', 'AC', undefined, 'e1'),
      sub('100B', 'AC', undefined, 'e2'),
    ])
    // 迁移会把它们补成当前账号 OldHandle
    assert.equal(store.getAcKeys().size, 2)

    store.setAccount('codeforces', 'NewHandle')

    // 换号后这两条属于 OldHandle，被过滤掉
    assert.equal(store.getAcKeys().size, 0)
    assert.equal(store.getSubmissionRows().length, 0)
  })
})
