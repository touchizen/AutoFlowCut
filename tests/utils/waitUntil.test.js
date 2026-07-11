// @vitest-environment node
//
// 스토리 캐릭터 푸시는 앱 시작 직후 machine.open() 이 쏜다. 그 시점의 references 는 아직 디스크에서
// 안 올라와 빈 배열이라, 그 위에 upsert 하면 새 카드 2장이 만들어지고 saveCurrentProjectWithPayload
// 가 즉시 확정 저장해 디스크의 카드(entityId/이미지 포인터)를 통째로 지운다.
// 푸시를 하이드레이션 이후로 미루기 위한 대기 유틸.
import { describe, it, expect, vi } from 'vitest'
import { waitUntil } from '../../src/utils/waitUntil'

describe('waitUntil', () => {
  it('이미 참이면 즉시 반환한다 (폴링하지 않는다)', async () => {
    const pred = vi.fn(() => true)
    expect(await waitUntil(pred, { timeoutMs: 1000, intervalMs: 10 })).toBe(true)
    expect(pred).toHaveBeenCalledTimes(1)
  })

  it('참이 될 때까지 폴링한다', async () => {
    let n = 0
    const pred = () => ++n >= 3
    expect(await waitUntil(pred, { timeoutMs: 1000, intervalMs: 1 })).toBe(true)
    expect(n).toBe(3)
  })

  it('타임아웃이면 false — 영원히 매달리지 않는다', async () => {
    expect(await waitUntil(() => false, { timeoutMs: 20, intervalMs: 1 })).toBe(false)
  })

  it('타임아웃이어도 예외를 던지지 않는다 (호출측이 진행 여부를 정한다)', async () => {
    await expect(waitUntil(() => false, { timeoutMs: 5, intervalMs: 1 })).resolves.toBe(false)
  })

  it('술어가 던지면 그대로 전파한다 (조용히 삼키지 않는다)', async () => {
    await expect(waitUntil(() => { throw new Error('boom') }, { timeoutMs: 10 })).rejects.toThrow('boom')
  })
})
