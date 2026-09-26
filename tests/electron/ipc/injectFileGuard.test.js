import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8')

/**
 * #R37 BLOCKER 회귀 방지 — injectFileToInput 은 **로컬 작업이 아니다**.
 *
 * 이 페이로드가 dispatch 하는 change 를 SPA 의 onChange 가 받아 uploadImage 를 실행한다
 * = Flow 에 캐릭터 entity 가 만들어진다. 그래서 execJs 타임아웃으로 이 스크립트를 "버려도 안전"
 * 하다는 논거가 이 한 곳에서만 성립하지 않는다:
 *
 *   먹통이던 렌더러가 나중에 깨어나 change 를 쏨 → entity 생성. 그런데 우리는 이미 실패로 알고
 *   락을 풀었으므로, 재시도가 entity 를 하나 더 만든다 → 중복(사용자 Flow 에 Zed 4개).
 *
 * 두 겹으로 막는다. 둘 중 하나라도 사라지면 중복이 재발하므로 여기서 못박는다.
 */
describe('#R37 — injectFileToInput 은 버려도 안전하지 않다 (두 겹 방어)', () => {
  const src = read('electron/ipc/character.js')
  const payload = src.slice(src.indexOf('async function injectFileToInput'), src.indexOf('// A2: SPA 가 보낸 uploadImage'))

  it('1겹: change dispatch 직전에 in-page 만료 가드가 있다 (좀비가 늦게 쏘지 못하게)', () => {
    const guardAt = payload.indexOf('Date.now() >')
    const changeAt = payload.indexOf("new Event('change'")
    expect(guardAt).toBeGreaterThan(-1)
    expect(changeAt).toBeGreaterThan(-1)
    // 가드가 반드시 change 보다 **앞**에 있어야 한다. 뒤에 있으면 아무 소용이 없다.
    expect(guardAt).toBeLessThan(changeAt)
  })

  it('만료 가드는 change 를 쏘지 않고 물러난다', () => {
    expect(payload).toContain('expired:true')
    expect(payload).toMatch(/Date\.now\(\)\s*>\s*\$\{deadline\}/)
  })

  it('in-page deadline 은 main 타임아웃보다 앞선다 (가드 통과 시 결과를 받을 시간 확보)', () => {
    expect(payload).toContain('timeoutMs - INJECT_DEADLINE_MARGIN_MS')
  })

  it('2겹: 주입이 타임아웃돼도 즉시 포기하지 않고 uploadImage 응답을 회수한다', () => {
    // change 는 쐈는데 결과 반환만 유실된 경우 — 여기서 포기하면 entityId 를 놓치고 재시도가 중복을 만든다.
    const handler = src.slice(src.indexOf("ipcMain.handle('flow:upload-character-entity'"))
    const injAt = handler.indexOf('const inj = await injectFileToInput')
    const waitAt = handler.indexOf('waitForUploadImageResponse')
    expect(injAt).toBeGreaterThan(-1)
    expect(waitAt).toBeGreaterThan(injAt)
    // timedOut 이면 early return 하지 않고 아래로 흘러야 한다.
    expect(handler).toContain('inj.timedOut')
    expect(handler).toMatch(/if \(!inj \|\| !inj\.timedOut\) return \{ success: false/)
  })
})

/**
 * 리뷰 지적: 17곳을 정규식으로 일괄 치환했는데, 한 곳만 되돌려도 전 테스트가 통과한다.
 * 배선을 소스로 고정한다 — 맨 executeJavaScript 가 하나라도 살아나면 그 경로가 다시 무한 대기한다.
 */
describe('#R37 — character.js 의 executeJavaScript 는 전부 execJs 를 거친다', () => {
  it('맨 .executeJavaScript( 호출이 남아 있지 않다', () => {
    const src = read('electron/ipc/character.js')
    const code = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    expect(code).not.toContain('.executeJavaScript(')
    expect(code).toContain('execJs(')
  })
})
