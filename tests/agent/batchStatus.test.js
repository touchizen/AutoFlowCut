// @vitest-environment node
//
// M1 slice 13 — `wait_batch` 의 renderer 쪽 진실 (§2.3, D20).
//
// 배치 상태의 **유일한 진실은 renderer** 다 (main 엔 없다 — `window.__mcpBatchStatus()` 를
// `executeJavaScript` 로 읽는 게 전부였고, D14 가 그 경로의 제품 재사용을 금지한다).
// 그래서 순수 selector 로 뽑아, agent bridge 와 legacy `__mcpBatchStatus` 가 **같은 계산**을 쓰게 한다.
//
// 🔴 **legacy shape 을 그대로 쓰면 안 된다** (`useMcpServer.js:552-560` 실측):
//    - `isRunning` 이 `videoAutomation.isRunning` 을 **OR** 한다 → 영상이 돌면 이미지 배치가 도는 걸로 읽힌다
//    - `status` 는 scene automation 이 멈추면 **video 의 status** 를 반환한다
//    영상은 `wait_videos` 소관이다. 이미지 배치 판정에 영상을 섞으면 에이전트가 엉뚱한 걸 기다린다.
import { describe, it, expect } from 'vitest'
import { readBatchStatus } from '../../src/agent/batchStatus.js'

const scene = (status, extra = {}) => ({ status, ...extra })

describe('readBatchStatus — scene', () => {
  it('running 중에는 done/total/error 를 세고 status 는 running', () => {
    const r = readBatchStatus({
      type: 'scene',
      automation: { isRunning: true, status: 'generating' },
      scenes: [scene('done', { image: 'a.png' }), scene('generating'), scene('error'), scene('pending')],
    })
    expect(r).toEqual({ type: 'scene', status: 'running', done: 1, total: 4, error: 1 })
  })

  it("종료 + `done` → complete", () => {
    const r = readBatchStatus({
      type: 'scene',
      automation: { isRunning: false, status: 'done' },
      scenes: [scene('done', { image: 'a.png' }), scene('done', { image: 'b.png' })],
    })
    expect(r).toEqual({ type: 'scene', status: 'complete', done: 2, total: 2, error: 0 })
  })

  // D20: 실행 중 사람의 개입은 에이전트에게 보여야 한다.
  // ⚠️ **알려진 컨플레이션**: renderer 의 `stopRequestedRef` 는 사용자 Stop 뿐 아니라 **쿼터 중단**도 세운다
  //    (`quotaStop.js`). 오늘의 신호로는 둘을 구분할 수 없다. 스펙에 기록했고, 구분이 필요해지면
  //    renderer 에 `stopReason` 을 다는 게 별도 슬라이스다. 지금 `complete` 로 위장하는 것보다는 정직하다.
  it("`stopped` → cancelled-by-user (부분 진행 카운트를 보존한다)", () => {
    const r = readBatchStatus({
      type: 'scene',
      automation: { isRunning: false, status: 'stopped' },
      scenes: [scene('done', { image: 'a.png' }), scene('pending'), scene('pending')],
    })
    expect(r).toEqual({ type: 'scene', status: 'cancelled-by-user', done: 1, total: 3, error: 0 })
  })

  // 🔴 auth 실패를 `complete` 로 내면 에이전트가 **죽은 인증으로 재시도 루프를 돈다**.
  it("`error`(auth 중단) → error — complete 로 위장하지 않는다", () => {
    const r = readBatchStatus({
      type: 'scene',
      automation: { isRunning: false, status: 'error' },
      scenes: [scene('done', { image: 'a.png' }), scene('error')],
    })
    expect(r.status).toBe('error')
    expect(r).toMatchObject({ done: 1, total: 2, error: 1 })
  })

  it('🔴 영상이 돌고 있어도 이미지 배치는 running 이 아니다 (legacy 는 OR 했다)', () => {
    const r = readBatchStatus({
      type: 'scene',
      automation: { isRunning: false, status: 'done' },
      videoAutomation: { isRunning: true, status: 'generating' },   // 무시돼야 한다
      scenes: [scene('done', { image: 'a.png' })],
    })
    expect(r.status, '영상 상태가 이미지 배치로 새어들었다').toBe('complete')
  })
})

describe('readBatchStatus — ref', () => {
  it('prompt 있는 레퍼런스만 모집단이다 (done ⊆ total 보장)', () => {
    const r = readBatchStatus({
      type: 'ref',
      references: [
        { prompt: 'p', data: 'x' },      // done
        { prompt: 'p' },                 // 미완
        { data: 'manual-upload' },       // prompt 없음 → 모집단 제외 (done 만 키우는 모순 차단)
      ],
      generatingRefs: [],
      refBatchRunning: false,
    })
    expect(r).toEqual({ type: 'ref', status: 'complete', done: 1, total: 2, error: 0 })
  })

  it('refBatchRunning 이면 running (preparing 구간 포함 — generatingRefs 만 보면 놓친다)', () => {
    const r = readBatchStatus({
      type: 'ref', references: [{ prompt: 'p' }], generatingRefs: [], refBatchRunning: true,
    })
    expect(r.status).toBe('running')
  })
})

describe('readBatchStatus — fail-closed', () => {
  it('🔴 모르는 type 은 던진다 (조용히 scene 으로 폴백하지 않는다)', () => {
    expect(() => readBatchStatus({ type: 'video', scenes: [] })).toThrow(/unknown batch type/i)
    expect(() => readBatchStatus({ scenes: [] })).toThrow(/unknown batch type/i)
  })
})
