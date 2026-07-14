import { describe, it, expect, vi } from 'vitest'
import { execJs, EXEC_JS_TIMEOUT_MS } from '../../../electron/ipc/shared'

/**
 * #R37: 먹통 Flow 렌더러에서 executeJavaScript 는 **영영 resolve 되지 않는다**.
 *
 * flowPageFetch(120s)와 trustedClick 은 타임아웃이 있지만 맨 executeJavaScript 는 없었다.
 * 캐릭터 동기화 경로가 그 위에서 돌기 때문에, 하나만 매달려도 coordinator 의 inner 가 끝나지 않고
 * 그 ref 의 락이 앱 재시작 전까지 풀리지 않는다(Sync 가 계속 'already in flight' 로 튕김).
 *
 * 이 래퍼는 무한 대기를 깨끗한 실패로 바꾼다. 버려도 안전한 이유: executeJavaScript 로 하는 일은
 * SPA 캐시 갱신·DOM probe 같은 **로컬 작업**이다. Flow 를 실제로 바꾸는 단계(uploadImage,
 * 등록 PATCH)는 flowPageFetch 쪽에 있고 거긴 이미 타임아웃+abort 가 걸려 있다.
 */
const wcThatHangs = () => ({ isDestroyed: () => false, executeJavaScript: vi.fn(() => new Promise(() => {})) })

describe('execJs — executeJavaScript 무한 대기 방지', () => {
  it('정상 응답은 그대로 통과시킨다', async () => {
    const wc = { isDestroyed: () => false, executeJavaScript: vi.fn().mockResolvedValue('ok') }
    await expect(execJs(wc, 'code')).resolves.toBe('ok')
    expect(wc.executeJavaScript).toHaveBeenCalledWith('code')
  })

  it('렌더러가 먹통이면 타임아웃으로 reject 한다 (영구 대기 금지)', async () => {
    vi.useFakeTimers()
    const wc = wcThatHangs()
    const p = execJs(wc, 'code', 50)
    const assertion = expect(p).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(51)
    await assertion
    vi.useRealTimers()
  })

  it('호출측의 .catch 폴백이 그대로 동작한다 (기존 호출 관례 보존)', async () => {
    vi.useFakeTimers()
    const wc = wcThatHangs()
    const p = execJs(wc, 'code', 50).catch(() => false)
    await vi.advanceTimersByTimeAsync(51)
    await expect(p).resolves.toBe(false)
    vi.useRealTimers()
  })

  it('파괴된 webContents 는 즉시 실패한다 (매달리지 않는다)', async () => {
    const wc = { isDestroyed: () => true, executeJavaScript: vi.fn() }
    await expect(execJs(wc, 'code')).rejects.toThrow()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('rejection 은 그대로 전달한다', async () => {
    const wc = { isDestroyed: () => false, executeJavaScript: vi.fn().mockRejectedValue(new Error('boom')) }
    await expect(execJs(wc, 'code')).rejects.toThrow('boom')
  })

  it('기본 타임아웃은 flowPageFetch(120s)보다 짧다 — DOM probe 가 네트워크보다 오래 걸릴 이유가 없다', () => {
    expect(EXEC_JS_TIMEOUT_MS).toBeLessThan(120000)
  })
})
