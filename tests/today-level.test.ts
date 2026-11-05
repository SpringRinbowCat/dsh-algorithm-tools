import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bandForDifficulty,
  estimateLevelDetail,
  renderTodayMarkdown,
} from '../src/analysis/today.ts'

describe('estimateLevelDetail', () => {
  it('刷题 60% + 比赛 40% 加权', () => {
    // 刷题中位数 1000、比赛中位数 1500 → 1000*0.6 + 1500*0.4 = 1200
    const r = estimateLevelDetail([900, 1000, 1000, 1100], [1400, 1500, 1600])
    assert.equal(r.practiceLevel, 1000)
    assert.equal(r.contestLevel, 1500)
    assert.equal(r.level, 1200)
  })

  it('只有刷题数据时直接用它', () => {
    const r = estimateLevelDetail([1200, 1300, 1400], [])
    assert.equal(r.contestLevel, null)
    assert.equal(r.level, 1300)
  })

  it('只有比赛数据时直接用它', () => {
    const r = estimateLevelDetail([], [1100, 1100, 1200])
    assert.equal(r.practiceLevel, null)
    assert.equal(r.level, 1100)
  })

  it('两边都没有才回落', () => {
    const r = estimateLevelDetail([], [], 1200)
    assert.equal(r.level, 1200)
  })
})

describe('bandForDifficulty', () => {
  it('按难度落档', () => {
    assert.equal(bandForDifficulty(1200, 1000), 'consolidation')
    assert.equal(bandForDifficulty(1200, 1200), 'core')
    assert.equal(bandForDifficulty(1200, 1400), 'core')
    assert.equal(bandForDifficulty(1200, 1500), 'challenge')
  })

  it('难度未知归同段区', () => {
    assert.equal(bandForDifficulty(1200, null), 'core')
  })
})

describe('renderTodayMarkdown', () => {
  const md = renderTodayMarkdown({
    date: '2026-11-05',
    level: { level: 1200, practiceLevel: 1100, contestLevel: 1300, practiceCount: 9, contestCount: 3 },
    windowDays: 60,
    locked: true,
    mdPath: '/tmp/x.md',
    focus: null,
    bands: [
      {
        key: 'core', label: '同段区', description: '贴合当前水平', range: [1200, 1400],
        problems: [
          {
            id: 1, platform: 'codeforces', problemKey: '2020A', title: 'A',
            difficulty: 800, url: 'https://codeforces.com/problemset/problem/2020/A',
            tags: ['math', 'greedy'], weakTags: [], reason: '本地已锁定；命中弱项 math',
          },
        ],
      },
    ],
  })

  it('包含日期、能力值口径、锁定状态和理由', () => {
    assert.ok(md.includes('2026-11-05 今日训练'))
    assert.ok(md.includes('刷题 1100'))
    assert.ok(md.includes('比赛 1300'))
    assert.ok(md.includes('本地已锁定'))
    assert.ok(md.includes('命中弱项 math'))
    assert.ok(md.includes('[2020A](https://codeforces.com/problemset/problem/2020/A)'))
  })
})
