/**
 * computeSceneSlots — 씬 사이 간격을 앞 씬에 흡수 (스펙 v10 §4.1 / §7.1)
 *
 * 씬 DTO 의 image_duration 은 "다음 씬 시작까지" 늘어난 슬롯이어야 한다.
 * 슬롯 누적이 telescoping 해서 cum(i) === start_i 가 되고 drift 가 0 이 된다.
 *
 * 기대값은 전부 리터럴로 박는다 — 새 코드를 두 번 돌려 비교하면 공허하게 통과한다.
 */
import { describe, it, expect } from 'vitest'
import { computeSceneSlots } from '../../src/services/sceneSlots'

// SRT 임포트가 세우는 모양: startTime/endTime/duration 이 정합.
const scene = (id, startTime, endTime, extra = {}) => ({
  id,
  startTime,
  endTime,
  duration: endTime - startTime,
  ...extra,
})

describe('computeSceneSlots — 슬롯 산출', () => {
  it('간격 있는 3 씬 → 슬롯이 다음 씬 시작까지 늘어난다', () => {
    // 간격: 5→6 (1 s), 9→10 (1 s). 마지막 씬은 자기 끝까지.
    const scenes = [scene('s1', 0, 5), scene('s2', 6, 9), scene('s3', 10, 15)]

    const r = computeSceneSlots(scenes, {})

    expect(r.useSlots).toBe(true)
    expect(r.imageSlots).toEqual([6, 4, 5])
  })

  it('간격 없고 start_0 = 0 인 3 씬 → 슬롯 == 원래 duration (no-op)', () => {
    const scenes = [scene('s1', 0, 5), scene('s2', 5, 9), scene('s3', 9, 15)]

    const r = computeSceneSlots(scenes, {})

    expect(r.useSlots).toBe(true)
    expect(r.imageSlots).toEqual([5, 4, 6])
  })

  it('첫 씬 startTime 이 0 이 아니면 선두 오프셋을 흡수한다', () => {
    // 이번 사건 프로젝트 모양 (start_0 = 0.1). 간격이 없어도 no-op 이 아니다 — 엣지 4.
    const scenes = [scene('s1', 0.1, 5), scene('s2', 5, 9)]

    const r = computeSceneSlots(scenes, {})

    expect(r.imageSlots).toEqual([5, 4])
  })

  it('마지막 씬 슬롯은 자기 endTime - startTime 이다', () => {
    const scenes = [scene('s1', 0, 5), scene('s2', 6, 9)]

    const r = computeSceneSlots(scenes, {})

    expect(r.imageSlots[1]).toBe(3)
  })

  it('불변식: 이미지 슬롯 합계 === 마지막 씬 endTime', () => {
    const scenes = [scene('s1', 0.1, 5), scene('s2', 6, 9), scene('s3', 10, 15)]

    const r = computeSceneSlots(scenes, {})

    expect(r.imageSlots.reduce((a, b) => a + b, 0)).toBeCloseTo(15, 10)
  })

  it('씬 하나뿐이면 선두 흡수가 이긴다 (엣지 3)', () => {
    const scenes = [scene('only', 0.1, 5)]

    const r = computeSceneSlots(scenes, {})

    expect(r.useSlots).toBe(true)
    expect(r.imageSlots).toEqual([5])       // endTime - 0
    expect(r.srtSlots).toEqual([4.9])       // endTime - startTime
  })

  it('srtSlots 는 첫 씬만 다르다 — imageSlots[0] - srtSlots[0] === startTime_0', () => {
    const scenes = [scene('s1', 0.1, 5), scene('s2', 6, 9), scene('s3', 10, 15)]

    const r = computeSceneSlots(scenes, {})

    expect(r.imageSlots[0] - r.srtSlots[0]).toBeCloseTo(0.1, 10)
    expect(r.srtSlots).toEqual([5.9, 4, 5])
    // i >= 1 은 두 맵이 같다
    expect(r.srtSlots.slice(1)).toEqual(r.imageSlots.slice(1))
  })

  it('sourceDurations 는 씬 자기 span, sourceOffsets 는 첫 씬만 start_0', () => {
    const scenes = [scene('s1', 0.1, 5), scene('s2', 6, 9), scene('s3', 10, 15)]

    const r = computeSceneSlots(scenes, {})

    expect(r.sourceDurations).toEqual([4.9, 3, 5])
    expect(r.sourceOffsets).toEqual([0.1, 0, 0])
  })
})

describe('computeSceneSlots — 전체 폴백 (all-or-nothing)', () => {
  it('시각이 없는 비-SRT 프로젝트 → non-finite-times', () => {
    const scenes = [{ id: 's1', duration: 4 }, { id: 's2', duration: 6 }]

    const r = computeSceneSlots(scenes, {})

    expect(r.useSlots).toBe(false)
    expect(r.reason).toBe('non-finite-times')
  })

  it('startTime 이 음수 → non-finite-times', () => {
    const scenes = [scene('s1', -1, 5), scene('s2', 6, 9)]

    expect(computeSceneSlots(scenes, {}).reason).toBe('non-finite-times')
  })

  it('endTime <= startTime (자기 span 0/음수) → non-positive-span', () => {
    // 검사 1 은 통과해야 한다 — 유한하고 startTime >= 0.
    const scenes = [
      { id: 's1', startTime: 0, endTime: 0, duration: 3 },
      { id: 's2', startTime: 6, endTime: 9, duration: 3 },
    ]

    const r = computeSceneSlots(scenes, {})

    expect(r.useSlots).toBe(false)
    expect(r.reason).toBe('non-positive-span')
  })

  it('배열 순서와 startTime 이 어긋남 (재배열 후 SRT 재임포트) → not-monotonic', () => {
    const scenes = [scene('A', 0, 5), scene('C', 100, 105), scene('B', 5, 10)]

    const r = computeSceneSlots(scenes, {})

    expect(r.useSlots).toBe(false)
    expect(r.reason).toBe('not-monotonic')
  })

  it('중복 startTime 은 strict 단조 위반이라 not-monotonic 이다 (검사 순서)', () => {
    const scenes = [scene('A', 0, 2), scene('B', 0, 3)]

    expect(computeSceneSlots(scenes, {}).reason).toBe('not-monotonic')
  })

  it('겹침 end_i > start_{i+1} — 단조는 만족 → overlap', () => {
    const scenes = [scene('A', 0, 10), scene('B', 5, 8)]

    const r = computeSceneSlots(scenes, {})

    expect(r.useSlots).toBe(false)
    expect(r.reason).toBe('overlap')
  })

  it('전체 폴백 시 슬롯 배열 == s.duration || defaultDuration || 3 (혼합 픽스처)', () => {
    // 씬 단위 폴백이면 A 의 슬롯이 100 이 되어 갈린다 — 뮤테이션 #4.
    const scenes = [scene('A', 0, 5), scene('C', 100, 105), scene('B', 5, 10)]

    const r = computeSceneSlots(scenes, {})

    expect(r.imageSlots).toEqual([5, 5, 5])
    expect(r.srtSlots).toEqual([5, 5, 5])
  })

  it('전체 폴백 시 duration 없는 씬은 settings.defaultDuration 을 받는다', () => {
    // raw s.duration 만 쓰면 undefined 가 되어 현행과 달라진다 — 뮤테이션 #15.
    const scenes = [{ id: 's1' }, { id: 's2' }]

    const r = computeSceneSlots(scenes, { defaultDuration: 7 })

    expect(r.imageSlots).toEqual([7, 7])
  })

  it('전체 폴백 + defaultDuration 도 없으면 3', () => {
    expect(computeSceneSlots([{ id: 's1' }], {}).imageSlots).toEqual([3])
  })

  it('폴백이면 sourceDurations / sourceOffsets 가 null 이다 (필드 생략용)', () => {
    const scenes = [scene('A', 0, 10), scene('B', 5, 8)]

    const r = computeSceneSlots(scenes, {})

    expect(r.sourceDurations).toBeNull()
    expect(r.sourceOffsets).toBeNull()
  })

  it('빈 배열은 폴백이다', () => {
    expect(computeSceneSlots([], {}).useSlots).toBe(false)
  })
})

describe('computeSceneSlots — 마지막 씬 규칙 (뮤테이션 #1)', () => {
  it('마지막 씬에 duration 이 없어도 슬롯은 endTime - startTime 이다', () => {
    // 마지막 씬을 next.startTime - startTime 으로 바꾸면 NaN → 전체 폴백 →
    // duration 이 없으므로 defaultDuration(7) 이 나와 갈린다.
    const scenes = [
      scene('s1', 0, 5),
      { id: 's2', startTime: 6, endTime: 9 },
    ]

    const r = computeSceneSlots(scenes, { defaultDuration: 7 })

    expect(r.useSlots).toBe(true)
    expect(r.imageSlots).toEqual([6, 3])
  })
})
