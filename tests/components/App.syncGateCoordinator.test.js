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
    // 결과 전달(finishSyncGate)보다 먼저 publish 돼야 flight 안에서 반영된다.
    expect(handler.indexOf('publishResult:')).toBeLessThan(handler.indexOf('finishSyncGate(myGate'))
  })

  it('부분 sync 실패를 generating anyway 로 흘리지 않고 fail closed 한다', () => {
    const start = source.indexOf('const handleSyncGateProceed')
    const end = source.indexOf('const handleSyncGateCancel', start)
    const handler = source.slice(start, end)

    expect(handler).toContain('planSyncGateCompletion(ok, fail)')
    expect(handler).not.toContain('generating anyway')
    expect(handler).not.toContain('생성을 계속합니다')
  })

  // 취소/완료의 순서(대기자를 먼저 풀고 모달을 내린다)와 소유권은 이제 useSyncGateHost 가
  // 소유하고 tests/hooks/useSyncGateHost.test.js 가 **실행해서** 검증한다 — 소스 문자열이 아니라.
  it('취소는 게이트 조정자에게 위임한다', () => {
    const start = source.indexOf('const handleSyncGateCancel')
    const end = source.indexOf('// ref batch는', start)
    const handler = source.slice(start, end)

    expect(handler).toContain('cancelSyncGate(syncGate)')  // 렌더된 게이트 identity 로 취소
  })
})
