/**
 * 채택 확인 모달의 재질문 억제(쿨다운).
 *
 * 모달이 떠 있는 동안 Flow 뷰는 0×0 으로 접힌다([[native-view-modals-break-flow-automation]]).
 * 그래서 사용자가 "취소"를 누르는 이유는 대개 "지금 열려 있는 게 내가 원하는 프로젝트가 아니다"
 * 이고, 원하는 프로젝트를 고르려면 Flow 뷰를 다시 봐야 한다. 5초마다 같은 프로젝트로 다시 물으면
 * 뷰가 계속 접혀 고를 시간 자체가 없다 — 취소한 id 는 한동안 묻지 않는다.
 */
import { describe, it, expect } from 'vitest'
import { shouldPromptAdopt, ADOPT_PROMPT_COOLDOWN_MS, ADOPT_RETRY_COOLDOWN_MS } from '../../src/utils/flowAdoptPrompt'

describe('shouldPromptAdopt', () => {
  it('처음 보는 후보는 묻는다', () => {
    expect(shouldPromptAdopt('p-1', new Map(), 1000)).toBe(true)
  })

  it('방금 취소한 후보는 다시 묻지 않는다', () => {
    const cancelled = new Map([['p-1', { at: 1000, cooldownMs: ADOPT_PROMPT_COOLDOWN_MS }]])
    expect(shouldPromptAdopt('p-1', cancelled, 1000 + ADOPT_PROMPT_COOLDOWN_MS - 1)).toBe(false)
  })

  it('쿨다운이 지나면 다시 묻는다 — 사용자의 마음이 바뀌었을 수 있다', () => {
    const cancelled = new Map([['p-1', { at: 1000, cooldownMs: ADOPT_PROMPT_COOLDOWN_MS }]])
    expect(shouldPromptAdopt('p-1', cancelled, 1000 + ADOPT_PROMPT_COOLDOWN_MS)).toBe(true)
  })

  // 취소는 "그 프로젝트"에 대한 거절이다. 사용자가 Flow 에서 다른 프로젝트를 열면 그건 새 의사표시라
  // 즉시 물어야 한다 — 안 그러면 원하는 프로젝트를 열어 놓고도 10분을 기다린다.
  it('다른 후보는 쿨다운에 걸리지 않는다', () => {
    const cancelled = new Map([['p-1', { at: 1000, cooldownMs: ADOPT_PROMPT_COOLDOWN_MS }]])
    expect(shouldPromptAdopt('p-2', cancelled, 1001)).toBe(true)
  })

  it('후보가 없으면 묻지 않는다', () => {
    expect(shouldPromptAdopt(null, new Map(), 1000)).toBe(false)
    expect(shouldPromptAdopt(undefined, new Map(), 1000)).toBe(false)
  })

  // 시계가 뒤로 갔거나(수동 조정) 저장된 시각이 미래면, 영구 침묵이 되지 않게 묻는 쪽으로 연다.
  it('기록된 취소 시각이 미래면 묻는다(시계 역행에도 영구 침묵 금지)', () => {
    const cancelled = new Map([['p-1', { at: 10_000, cooldownMs: ADOPT_PROMPT_COOLDOWN_MS }]])
    expect(shouldPromptAdopt('p-1', cancelled, 1000)).toBe(true)
  })

  // 침묵 길이는 "왜 안 물어보는가"에 따라 다르다. 취소는 사용자가 그 프로젝트를 거절한 것이라
  // 길게 쉬어야 하지만, 확인했는데 실패한 것(Flow 뷰가 잠깐 바쁨 등)은 곧 다시 물어야 한다.
  it('항목이 자기 침묵 시간을 들고 다닌다', () => {
    const cancelled = new Map([['p-1', { at: 1000, cooldownMs: ADOPT_RETRY_COOLDOWN_MS }]])
    expect(shouldPromptAdopt('p-1', cancelled, 1000 + ADOPT_RETRY_COOLDOWN_MS - 1)).toBe(false)
    expect(shouldPromptAdopt('p-1', cancelled, 1000 + ADOPT_RETRY_COOLDOWN_MS)).toBe(true)
  })

  it('실패 재시도 침묵은 취소 침묵보다 훨씬 짧다', () => {
    expect(ADOPT_RETRY_COOLDOWN_MS).toBeLessThan(ADOPT_PROMPT_COOLDOWN_MS / 10)
  })
})
