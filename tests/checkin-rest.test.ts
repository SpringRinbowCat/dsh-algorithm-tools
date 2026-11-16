import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isSunday, prevNonSunday, nextNonSunday } from '../src/util/local-date.ts'
import { acStreakFromDays, buildDayCells, buildHeatmapCells, buildTodayStatus } from '../src/workbench-overview.ts'

const emptyStore = {
  getSubmissionRows: () => [],
  getTrainingIndex: () => [],
  getAcKeys: () => new Set<string>(),
  getProblem: () => null,
} as any

describe('周日休息日判断', () => {
  it('2026-11-15 是周日，2026-11-16 是周一', () => {
    assert.equal(isSunday('2026-11-15'), true)
    assert.equal(isSunday('2026-11-16'), false)
  })

  it('前后跳过周日', () => {
    assert.equal(prevNonSunday('2026-11-16'), '2026-11-14')
    assert.equal(nextNonSunday('2026-11-14'), '2026-11-16')
  })
})

describe('连续打卡跳过周日', () => {
  it('周六、周一算连续 2 天', () => {
    assert.deepEqual(
      acStreakFromDays(['2026-11-14', '2026-11-16'], '2026-11-16'),
      { current: 2, longest: 2, totalDays: 2 },
    )
  })

  it('今天是周日时，连续数延续到周六', () => {
    assert.deepEqual(
      acStreakFromDays(['2026-11-14'], '2026-11-15'),
      { current: 1, longest: 1, totalDays: 1 },
    )
  })

  it('周日当天的 AC 不算打卡', () => {
    assert.deepEqual(
      acStreakFromDays(['2026-11-15'], '2026-11-16'),
      { current: 0, longest: 0, totalDays: 0 },
    )
  })

  it('跨两个周末的连续段仍能连起来', () => {
    assert.deepEqual(
      acStreakFromDays(['2026-11-13', '2026-11-14', '2026-11-16', '2026-11-17'], '2026-11-17'),
      { current: 4, longest: 4, totalDays: 4 },
    )
  })

  it('只隔周日但中间缺周一，不算连续', () => {
    assert.deepEqual(
      acStreakFromDays(['2026-11-14', '2026-11-17'], '2026-11-17'),
      { current: 1, longest: 1, totalDays: 2 },
    )
  })
})

describe('周日默认训练完成', () => {
  it('status 返回休息日且 done=true', () => {
    const status = buildTodayStatus(emptyStore, '2026-11-15')
    assert.equal(status.restDay, true)
    assert.equal(status.done, true)
    assert.equal(status.training.total, 0)
    assert.equal(status.advice.title, '周日休息日')
  })

  it('非周日仍按训练索引判断', () => {
    const status = buildTodayStatus(emptyStore, '2026-11-16')
    assert.equal(status.restDay, false)
    assert.equal(status.done, false)
  })

  it('day cell 在周日默认完成', () => {
    const cell = buildDayCells(emptyStore, 1, '2026-11-15')[0]
    assert.equal(cell.restDay, true)
    assert.equal(cell.done, true)
  })
})

describe('热力图按周对齐、去掉周日行', () => {
  it('周二所在的周只返回周一到周六 6 格', () => {
    const cells = buildHeatmapCells(emptyStore, 1, '2026-11-17')
    assert.deepEqual(
      cells.map((c) => c.date),
      ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'],
    )
  })

  it('今天就是周日时，最后一列到周六为止', () => {
    const cells = buildHeatmapCells(emptyStore, 1, '2026-11-15')
    assert.deepEqual(
      cells.map((c) => c.date),
      ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'],
    )
  })
})
