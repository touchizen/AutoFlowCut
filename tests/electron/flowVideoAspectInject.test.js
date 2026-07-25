import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import { FLOW_PAGE_INJECTION } from '../../electron/flow-page-injection.js'

// 패치된 window.fetch 를 node:vm 에서 실제 구동해, 비디오 생성 요청 body 의 requests[].aspectRatio 에
// videoAspectRatio 가 주입되는지 검증한다(라이브 없이 충실 재현). Flow 가 설정 패널을 통합 탭 UI 로
// 바꿔 DOM 세터가 비디오에 안 걸리므로, 요청 body 직접 주입이 화면비를 싣는 유일 경로다.
function runVideoInjection(inject, { url, body }) {
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
  vm.runInContext(FLOW_PAGE_INJECTION, ctx) // window.fetch 패치
  win.__autoflowcut_inject__ = Object.assign(win.__autoflowcut_inject__ || {}, inject)
  return win.fetch(url, { method: 'POST', body }).then(() => {
    const final = calls[0]
    return JSON.parse(final.init.body)
  })
}

const BASE = 'https://aisandbox/v1/'
const T2V_URL = BASE + 'batchAsyncGenerateVideoText'
const R2V_URL = BASE + 'batchAsyncGenerateVideoReferenceImages'
const I2V_URL = BASE + 'batchAsyncGenerateVideoStartImage'

describe('flow video aspectRatio injection (requests[].aspectRatio)', () => {
  it('T2V: videoAspectRatio 를 requests[].aspectRatio 로 주입한다', async () => {
    const out = await runVideoInjection(
      { seed: 1, videoAspectRatio: 'VIDEO_ASPECT_RATIO_PORTRAIT' },
      { url: T2V_URL, body: JSON.stringify({ requests: [{ videoModelKey: 'veo_t2v', textInput: {} }] }) },
    )
    expect(out.requests[0].aspectRatio).toBe('VIDEO_ASPECT_RATIO_PORTRAIT')
  })

  it('R2V(@멘션): 모든 request 에 aspectRatio 주입', async () => {
    const out = await runVideoInjection(
      { seed: 2, videoAspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE' },
      { url: R2V_URL, body: JSON.stringify({ requests: [{ videoModelKey: 'abra_r2v_10s' }, { videoModelKey: 'abra_r2v_10s' }] }) },
    )
    expect(out.requests.map((r) => r.aspectRatio)).toEqual([
      'VIDEO_ASPECT_RATIO_LANDSCAPE', 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    ])
  })

  it('I2V: i2v 분기에서도 aspectRatio 주입', async () => {
    const out = await runVideoInjection(
      {
        seed: 3,
        videoAspectRatio: 'VIDEO_ASPECT_RATIO_PORTRAIT',
        i2v: { startImageMediaId: 'start1', i2vUrl: I2V_URL, i2vStartEndUrl: I2V_URL + 'End', duration: 8 },
      },
      { url: I2V_URL, body: JSON.stringify({ requests: [{ videoModelKey: 'abra_t2v_8s' }] }) },
    )
    expect(out.requests[0].aspectRatio).toBe('VIDEO_ASPECT_RATIO_PORTRAIT')
  })

  it('videoAspectRatio 미지정(null)이면 요청을 건드리지 않는다(Flow 기본값 유지)', async () => {
    const out = await runVideoInjection(
      { seed: 4, videoAspectRatio: null },
      { url: T2V_URL, body: JSON.stringify({ requests: [{ videoModelKey: 'veo_t2v' }] }) },
    )
    expect(out.requests[0].aspectRatio).toBeUndefined()
    expect(out.requests[0].seed).toBe(4) // seed 는 주입되어 분기가 실행됐음을 확인
  })
})
