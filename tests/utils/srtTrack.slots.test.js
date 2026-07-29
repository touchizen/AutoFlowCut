/**
 * rebaseSrtTrackToScenes — 슬롯 옵션 (스펙 v10 §4.5 / §7.4)
 *
 * 사이드카 _subtitle_ko.srt 는 rebase 결과를 쓰는데, rebase 가 붕괴된
 * duration 누적을 그대로 따라가서 이미지 배치를 고쳐도 자막만 홀로 어긋난다.
 * durationOf(=srtSlot) 로 누적하고 initialCumulative(=start_0) 로 시드하면
 * cumulative 가 start_i 로 telescoping 해서 결과가 원본 절대 시각과 같아진다.
 *
 * ⚠️ 클램프 경계(:162-164)는 건드리지 않는다 — scene.duration 그대로.
 * 슬롯을 경계에도 쓰면 R13 보호가 프로덕션 경로에서만 사라진다.
 */
import { describe, it, expect } from 'vitest'
import { rebaseSrtTrackToScenes } from '../../src/utils/srtTrack'

const line = (id, startTime, endTime) => ({ id, startTime, endTime, text: id })

describe('rebaseSrtTrackToScenes — durationOf / initialCumulative', () => {
  // 씬 A(0.1–5) / B(6–9) / C(10–15), 사이에 간격 1 s 씩.
  // 픽스처 조건: start_0 ≠ 0 (뮤테이션 #14), 비-마지막 씬에 간격 (뮤테이션 #10).
  const track = [
    line('a1', 0.1, 3),
    line('a2', 3, 5),
    line('b1', 6, 9),
    line('c1', 10, 15),
  ]
  const scenes = [
    { id: 'A', srtLineIds: ['a1', 'a2'], startTime: 0.1, endTime: 5, duration: 4.9 },
    { id: 'B', srtLineIds: ['b1'], startTime: 6, endTime: 9, duration: 3 },
    { id: 'C', srtLineIds: ['c1'], startTime: 10, endTime: 15, duration: 5 },
  ]
  const srtSlots = [5.9, 4, 5]
  const opts = {
    durationOf: (_s, i) => srtSlots[i],
    initialCumulative: 0.1,
  }

  it('결과가 원본 절대 시각과 동일하다 (identity)', () => {
    const out = rebaseSrtTrackToScenes(track, scenes, opts)

    expect(out.map(l => [l.id, l.startTime, l.endTime])).toEqual([
      ['a1', 0.1, 3],
      ['a2', 3, 5],
      ['b1', 6, 9],
      ['c1', 10, 15],
    ])
  })

  it('initialCumulative 를 빼면 첫 씬 자막이 start_0 만큼 앞당겨진다 (회귀 재현)', () => {
    const out = rebaseSrtTrackToScenes(track, scenes, { durationOf: opts.durationOf })

    expect(out[0].startTime).toBeCloseTo(0, 10)
    expect(out[0].endTime).toBeCloseTo(2.9, 10)
  })

  it('durationOf 를 빼면 간격만큼 이후 씬이 앞당겨진다 (회귀 재현)', () => {
    const out = rebaseSrtTrackToScenes(track, scenes, { initialCumulative: 0.1 })

    // A 는 자기 duration 4.9 만 전진 → cumulative 5, B 가 1 s 이르다.
    expect(out[2].startTime).toBeCloseTo(5, 10)
  })

  it('durationOf 미전달 시 현행 동작 그대로 (다른 호출부 무영향)', () => {
    const out = rebaseSrtTrackToScenes(track, scenes)

    expect(out[0].startTime).toBe(0)
    expect(out[2].startTime).toBeCloseTo(4.9, 10)
  })
})

describe('rebaseSrtTrackToScenes — 클램프 유지 (R13 보호)', () => {
  it('② CSV 교차 라인: 경계는 scene.duration 이지 슬롯이 아니다 (뮤테이션 #21)', () => {
    // 씬 A(0–5, duration 5) 에 연결된 라인이 12 까지 뻗는다 (CSV 행 순서 뒤섞임).
    // 경계 = cumulative(0) + duration(5) = 5 → 5 로 클램프.
    // 경계에 srtSlot(10) 을 쓰면 10 이 나온다.
    const track = [line('a1', 0, 12), line('b1', 10, 15)]
    const scenes = [
      { id: 'A', srtLineIds: ['a1'], startTime: 0, endTime: 5, duration: 5 },
      { id: 'B', srtLineIds: ['b1'], startTime: 10, endTime: 15, duration: 5 },
    ]
    const srtSlots = [10, 5]

    const out = rebaseSrtTrackToScenes(track, scenes, {
      durationOf: (_s, i) => srtSlots[i],
      initialCumulative: 0,
    })

    expect(out[0].endTime).toBe(5)
    // B 는 여전히 identity
    expect(out[1].startTime).toBe(10)
    expect(out[1].endTime).toBe(15)
  })

  it('① 마지막 씬 shrink: 클램프가 여전히 발동한다 (뮤테이션 #20)', () => {
    // 사용자가 마지막 씬을 줄여 endTime 이 13 인데 자막 줄은 15 까지 간다.
    const track = [line('a1', 0, 5), line('b1', 10, 15)]
    const scenes = [
      { id: 'A', srtLineIds: ['a1'], startTime: 0, endTime: 5, duration: 5 },
      { id: 'B', srtLineIds: ['b1'], startTime: 10, endTime: 13, duration: 3 },
    ]
    const srtSlots = [10, 3]

    const out = rebaseSrtTrackToScenes(track, scenes, {
      durationOf: (_s, i) => srtSlots[i],
      initialCumulative: 0,
    })

    expect(out[1].endTime).toBe(13)
  })
})

describe('rebaseSrtTrackToScenes — 라인 없는 중간 씬 (뮤테이션 #24)', () => {
  it('빈-라인 분기도 슬롯으로 전진한다', () => {
    // CSV 의 빈 subtitle 행은 srtTrack 라인을 안 만들지만(parsers.js:304)
    // 그룹 경계는 만들어 srtLineIds: [] 인 씬이 생긴다.
    // B 가 scene.duration(3) 으로 전진하면 C 자막이 1 s 이르다.
    const track = [line('a1', 0, 5), line('c1', 10, 15)]
    const scenes = [
      { id: 'A', srtLineIds: ['a1'], startTime: 0, endTime: 5, duration: 5 },
      { id: 'B', srtLineIds: [], startTime: 6, endTime: 9, duration: 3 },
      { id: 'C', srtLineIds: ['c1'], startTime: 10, endTime: 15, duration: 5 },
    ]
    const srtSlots = [6, 4, 5]

    const out = rebaseSrtTrackToScenes(track, scenes, {
      durationOf: (_s, i) => srtSlots[i],
      initialCumulative: 0,
    })

    expect(out.map(l => [l.id, l.startTime, l.endTime])).toEqual([
      ['a1', 0, 5],
      ['c1', 10, 15],
    ])
  })
})
