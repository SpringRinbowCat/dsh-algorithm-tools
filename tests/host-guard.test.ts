import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hostRejection } from '../src/dsh-compat.ts'

describe('hostRejection（DSH Host 请求准入）', () => {
  it('老版本 Host 没有 connection 服务时放行', () => {
    assert.equal(hostRejection({}, {}), undefined)
    assert.equal(hostRejection({ get: () => undefined }, {}), undefined)
  })

  it('connection 没有 requestRejection 时放行', () => {
    assert.equal(hostRejection({ get: () => ({}) }, {}), undefined)
  })

  it('把 Host 的判断原样返回（403 / 401）', () => {
    const ctx = { get: () => ({ requestRejection: () => 403 }) }
    assert.equal(hostRejection(ctx, {}), 403)
    const ctx2 = { get: () => ({ requestRejection: () => 401 }) }
    assert.equal(hostRejection(ctx2, {}), 401)
  })

  it('Host 放行时返回 undefined', () => {
    const ctx = { get: () => ({ requestRejection: () => undefined }) }
    assert.equal(hostRejection(ctx, {}), undefined)
  })
})
