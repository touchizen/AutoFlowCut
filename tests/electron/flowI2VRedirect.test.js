import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import { FLOW_PAGE_INJECTION } from '../../electron/flow-page-injection.js'

// 패치된 window.fetch 를 node:vm 에서 실제 구동해 i2v 엔드포인트 redirect 가 body 와 일치하는지
// 검증한다(라이브 없이 충실 재현). 핵심 불변식: body 에 endImage 가 들어갔을 때만 StartAndEnd
// 엔드포인트로 가야 한다 — abra(OmniFlash i2v)는 endImage 를 생략하므로 StartImage 로 가야 400 회피.
function runI2VInjection(i2v, { url, body }) {
  const calls = []
  const makeRes = () => ({ status: 200, clone: () => ({ text: () => Promise.resolve('{}') }) })
  const recordingFetch = (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : input?.url, init })
    return Promise.resolve(makeRes())
  }
  const win = { fetch: recordingFetch }
  const ctx = vm.createContext({
    window: win,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    Date,
  })
  vm.runInContext(FLOW_PAGE_INJECTION, ctx) // window.fetch 가 패치됨 (_fetch=recordingFetch 캡처)
  win.__autoflowcut_inject__ = Object.assign(win.__autoflowcut_inject__ || {}, { i2v })
  return win.fetch(url, { method: 'POST', body }).then(() => calls)
}

const I2V_URL = 'https://aisandbox/v1/batchAsyncGenerateVideoStartImage'
const I2V_START_END_URL = 'https://aisandbox/v1/batchAsyncGenerateVideoStartAndEndImage'

describe('i2v redirect ↔ body endImage 일치', () => {
  it('non-force 경로에서 finalKey 가 abra 면 endImage 생략 + StartImage 엔드포인트로 (StartAndEnd 금지)', async () => {
    const i2v = {
      startImageMediaId: 'start1',
      endImageMediaId: 'end1', // 설정엔 있지만 abra 라 body 엔 안 들어가야 함
      videoModel: 'Veo 3.1 - Fast', // 앱 모델은 Veo → forceOmni=false
      i2vUrl: I2V_URL,
      i2vStartEndUrl: I2V_START_END_URL,
      duration: 8,
    }
    // Flow 가 보낸 t2v 키가 abra → toI2VModelKey 가 abra_i2v_8s 유지 → isAbra → endImage 생략
    const calls = await runI2VInjection(i2v, {
      url: I2V_URL,
      body: JSON.stringify({ requests: [{ videoModelKey: 'abra_t2v_8s' }] }),
    })
    const final = calls[0]
    const reqBody = JSON.parse(final.init.body)
    expect(reqBody.requests[0].endImage).toBeUndefined()
    expect(final.url).toBe(I2V_URL) // body 와 일치(StartImage) — 현재는 StartAndEnd 로 가는 버그
  })

  it('Veo 종료프레임 경로는 endImage 주입 + StartAndEnd 엔드포인트 유지(회귀가드)', async () => {
    const i2v = {
      startImageMediaId: 'start1',
      endImageMediaId: 'end1',
      videoModel: 'Veo 3.1 - Fast',
      i2vUrl: I2V_URL,
      i2vStartEndUrl: I2V_START_END_URL,
      duration: 8,
    }
    const calls = await runI2VInjection(i2v, {
      url: I2V_URL,
      body: JSON.stringify({ requests: [{ videoModelKey: 'veo_3_1_t2v_fast_ultra_relaxed' }] }),
    })
    const final = calls[0]
    const reqBody = JSON.parse(final.init.body)
    expect(reqBody.requests[0].endImage).toEqual({ mediaId: 'end1', cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 } })
    expect(final.url).toBe(I2V_START_END_URL)
  })

  it('endImage 미설정(start-only)이면 StartImage 엔드포인트', async () => {
    const i2v = {
      startImageMediaId: 'start1',
      endImageMediaId: null,
      videoModel: 'Veo 3.1 - Fast',
      i2vUrl: I2V_URL,
      i2vStartEndUrl: I2V_START_END_URL,
      duration: 8,
    }
    const calls = await runI2VInjection(i2v, {
      url: I2V_URL,
      body: JSON.stringify({ requests: [{ videoModelKey: 'veo_3_1_t2v_fast_ultra_relaxed' }] }),
    })
    const final = calls[0]
    const reqBody = JSON.parse(final.init.body)
    expect(reqBody.requests[0].endImage).toBeUndefined()
    expect(final.url).toBe(I2V_URL)
  })
})
