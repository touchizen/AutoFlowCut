import { describe, it, expect } from 'vitest'
import { handleUsageNotification } from '../../../../electron/api/llm/codexAppServer.js'

/**
 * 0.144.5 실측 스키마(`codex app-server generate-ts --experimental` → v2/).
 * 축약 객체(`{total:100}`)로 시험하면 제품이 가는 길을 안 지난다 — 실제 알림 모양을 쓴다.
 */
const breakdown = (o) => ({
  totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, ...o,
})
const notif = (o = {}) => ({
  threadId: 't1',
  turnId: 'u1',
  tokenUsage: {
    total: breakdown(o.total || {}),
    last: breakdown(o.last || {}),
    modelContextWindow: 272000,
  },
})

describe('codex thread/tokenUsage/updated', () => {
  it('중첩 total 을 읽어 onUsage 에 넘긴다', () => {
    const seen = []
    handleUsageNotification(
      'thread/tokenUsage/updated',
      notif({ total: { inputTokens: 900, outputTokens: 300 }, last: { inputTokens: 100, outputTokens: 40 } }),
      (u) => seen.push(u),
    )
    expect(seen).toEqual([{ key: 't1', input: 900, output: 300 }])
  })

  it('다른 method 는 무시한다', () => {
    const seen = []
    handleUsageNotification('turn/completed', { turn: { status: 'completed' } }, (u) => seen.push(u))
    expect(seen).toEqual([])
  })

  it('onUsage 가 없어도 죽지 않는다', () => {
    expect(() => handleUsageNotification('thread/tokenUsage/updated', notif({ total: { inputTokens: 1 } }), undefined))
      .not.toThrow()
  })

  it('onUsage 가 던져도 삼킨다 — 이 콜백은 stdout 핸들러 안에서 돈다', () => {
    expect(() => handleUsageNotification(
      'thread/tokenUsage/updated',
      notif({ total: { inputTokens: 1 } }),
      () => { throw new Error('boom') },
    )).not.toThrow()
  })
})
