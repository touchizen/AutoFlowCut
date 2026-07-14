// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

describe('App sync gate — coordinator publish lifetime wiring', () => {
  it('syncRefToFlow 에 scope/index/publishResult 를 넘겨 patch 를 flight 안에서 publish 한다', () => {
    const start = source.indexOf('const handleSyncGateProceed')
    const end = source.indexOf('const handleSyncGateCancel', start)
    const handler = source.slice(start, end)

    expect(handler).toContain('scopeToken:')
    expect(handler).toContain('refIndex')
    expect(handler).toContain('publishResult:')
    expect(handler.indexOf('publishResult:')).toBeLessThan(handler.indexOf('proceed?.(patchedRefs)'))
  })

  it('부분 sync 실패를 generating anyway 로 흘리지 않고 fail closed 한다', () => {
    const start = source.indexOf('const handleSyncGateProceed')
    const end = source.indexOf('const handleSyncGateCancel', start)
    const handler = source.slice(start, end)

    expect(handler).toContain('planSyncGateCompletion(ok, fail)')
    expect(handler).not.toContain('generating anyway')
    expect(handler).not.toContain('생성을 계속합니다')
  })
})
