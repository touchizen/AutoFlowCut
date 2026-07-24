// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

describe('App sync gate — coordinator publish lifetime wiring', () => {
  // scopeToken/refIndex/publishResult 와 fail-closed 정산은 services/syncGateRun 으로 옮겼고,
  // tests/services/syncGateRun.test.js 가 **실행해서** 검증한다(스코프 변경 시 publish 안 함,
  // 부분 실패 시 finish 대신 abort 등). 여기선 App 이 그 실행부에 무엇을 주입하는지만 본다.
  it('실행부에 동기화 함수와 정산 콜백을 주입한다', () => {
    const start = source.indexOf('const handleSyncGateProceed')
    const end = source.indexOf('const handleSyncGateCancel', start)
    const handler = source.slice(start, end)

    expect(handler).toContain('runSyncGate(')
    expect(handler).toContain('syncRef:')
    expect(handler).toContain('publishRefs:')
    expect(handler).toContain('finish:')
    expect(handler).toContain('abort:')
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
