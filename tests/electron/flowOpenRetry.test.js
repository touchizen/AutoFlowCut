// @vitest-environment node
/**
 * flowOpenRetry.waitForProjectLoaded — 컴포저가 그려질 때까지 폴링(순수, probe/sleep/now 주입).
 *
 * 2026-09-24 실기(flow.google.com): 프로젝트 URL 을 열면 RPC 응답은 1~2초 안에 오지만 미디어 목록
 * (Zzl0ze)은 5~6초 뒤에 와 컴포저가 그 뒤에 그려진다. 옛 open-project 는 loadURL 2초 뒤 **한 번만**
 * 검사해 인터랙티브 요소 <20 을 "에러 페이지"로 오판했다 → 홈 경유 재시도 → 또 2초 → dead=true.
 */
import { describe, it, expect, vi } from 'vitest'
import { waitForProjectLoaded } from '../../electron/flowOpenRetry.js'

const DEAD = { onTargetUrl: true, isErrorPage: true, probeOk: true, urlNow: 'https://flow.google.com/project/x' }
const LIVE = { onTargetUrl: true, isErrorPage: false, probeOk: true, urlNow: 'https://flow.google.com/project/x' }
const OFF = { onTargetUrl: false, isErrorPage: false, probeOk: true, urlNow: 'https://flow.google.com/' }

function clock() {
  let t = 0
  return { now: () => t, sleep: vi.fn(async (ms) => { t += ms }) }
}

describe('waitForProjectLoaded — 컴포저가 그려질 때까지 폴링', () => {
  it('죽은 페이지 2회 뒤 살아나면 3번째 관찰을 loaded 로 돌려준다(관찰값 보존)', async () => {
    const seq = [DEAD, DEAD, LIVE]
    const probe = vi.fn(async () => seq.shift() ?? LIVE)
    const c = clock()
    const r = await waitForProjectLoaded(probe, { timeoutMs: 15000, intervalMs: 1000, sleep: c.sleep, now: c.now })
    expect(r).toMatchObject({ loaded: true, attempts: 3, onTargetUrl: true, isErrorPage: false, urlNow: LIVE.urlNow })
    expect(c.sleep).toHaveBeenCalledTimes(2)
    expect(c.sleep).toHaveBeenCalledWith(1000)
  })

  it('마감까지 죽어 있으면 마지막 관찰을 loaded:false 로 돌려주고 마감을 넘기지 않는다', async () => {
    const probe = vi.fn(async () => DEAD)
    const c = clock()
    const r = await waitForProjectLoaded(probe, { timeoutMs: 5000, intervalMs: 1000, sleep: c.sleep, now: c.now })
    expect(r).toMatchObject({ loaded: false, attempts: 6, isErrorPage: true })
    expect(c.now()).toBe(5000)
  })

  it('처음부터 살아 있으면 한 번만 보고 기다리지 않는다', async () => {
    const probe = vi.fn(async () => LIVE)
    const c = clock()
    const r = await waitForProjectLoaded(probe, { timeoutMs: 15000, intervalMs: 1000, sleep: c.sleep, now: c.now })
    expect(r).toMatchObject({ loaded: true, attempts: 1 })
    expect(c.sleep).not.toHaveBeenCalled()
  })

  it('URL 이탈(onTargetUrl:false)도 loaded 가 아니다 — 돌아올 때까지 폴링', async () => {
    const seq = [OFF, LIVE]
    const probe = vi.fn(async () => seq.shift() ?? LIVE)
    const c = clock()
    const r = await waitForProjectLoaded(probe, { timeoutMs: 15000, intervalMs: 1000, sleep: c.sleep, now: c.now })
    expect(r).toMatchObject({ loaded: true, attempts: 2 })
  })
})
