/**
 * exportSelection — 내보내기 씬 분류·선택 (스펙 v9 §4.1 / §7.1)
 *
 * 사건: 519 씬 중 518 개가 status:'pending' 인데 imagePath 는 전부 채워져 있었다.
 * 화면은 imagePath 로 그리고 내보내기는 status 로 거르니 다 있어 보이는데 하나만 나갔다.
 * 이 모듈이 "무엇이 내보낼 수 있는가"의 단일 지점이다 — 분류기와 실행 필터가
 * **같은 술어 함수를 호출**해야 숫자와 실제 대상이 갈리지 않는다.
 */
import { describe, it, expect } from 'vitest'
import {
  buildExportModalCounts,
  isReadyExportEligible,
  isPendingExportEligible,
  classifyExportScenes,
  selectExportScenes,
  hasExportAccess,
} from '../../src/services/exportSelection'

const done = (id, extra = {}) => ({ id, status: 'done', imagePath: `/p/${id}.png`, ...extra })
const pendingWithImage = (id, extra = {}) => ({ id, status: 'pending', imagePath: `/p/${id}.png`, ...extra })
const pendingNoImage = (id) => ({ id, status: 'pending' })

describe('exportSelection — 3 분할', () => {
  it('done / pending+이미지 / 미디어없음 을 정확히 가른다', () => {
    const scenes = [done('a'), pendingWithImage('b'), pendingNoImage('c')]

    const r = classifyExportScenes(scenes)

    expect(r.ready.map(s => s.id)).toEqual(['a'])
    expect(r.pendingWithImage.map(s => s.id)).toEqual(['b'])
    expect(r.unusable.map(s => s.id)).toEqual(['c'])
  })

  it('세 배열은 상호배타이고 합집합이 입력 전체다 (원소 identity)', () => {
    const scenes = [
      done('a'), pendingWithImage('b'), pendingNoImage('c'),
      { id: 'd', status: 'generating', imagePath: '/p/d.png' },
      { id: 'e', status: 'error', imagePath: '/p/e.png' },
      done('f'),
    ]

    const { ready, pendingWithImage: pend, unusable } = classifyExportScenes(scenes)
    const all = [...ready, ...pend, ...unusable]

    expect(all).toHaveLength(scenes.length)
    for (const s of scenes) expect(all).toContain(s)   // identity
    expect(new Set(all).size).toBe(scenes.length)      // 중복 없음
  })

  it('generating / error 는 이미지가 있어도 pendingWithImage 가 아니다', () => {
    const scenes = [
      { id: 'g', status: 'generating', imagePath: '/p/g.png' },
      { id: 'e', status: 'error', imagePath: '/p/e.png' },
    ]

    const r = classifyExportScenes(scenes)

    expect(r.pendingWithImage).toEqual([])
    expect(r.unusable.map(s => s.id)).toEqual(['g', 'e'])
  })

  it('이미지 없는 pending 은 unusable 이다', () => {
    expect(classifyExportScenes([pendingNoImage('x')]).unusable.map(s => s.id)).toEqual(['x'])
  })

  it('base64 image 만 있어도 pendingWithImage 다 (hasExportableMedia 재사용)', () => {
    const s = { id: 'b64', status: 'pending', image: 'data:image/png;base64,xxx' }

    expect(isPendingExportEligible(s)).toBe(true)
    expect(classifyExportScenes([s]).pendingWithImage).toHaveLength(1)
  })
})

describe('exportSelection — 술어 단일 지점', () => {
  it('isReadyExportEligible 은 status done + 미디어 둘 다 본다', () => {
    expect(isReadyExportEligible(done('a'))).toBe(true)
    expect(isReadyExportEligible({ id: 'x', status: 'done' })).toBe(false)          // 미디어 없음
    expect(isReadyExportEligible(pendingWithImage('b'))).toBe(false)                // status 아님
  })

  it('두 술어는 항상 boolean 을 반환한다', () => {
    expect(isPendingExportEligible({ id: 'x', status: 'pending', imagePath: '' })).toBe(false)
    expect(isReadyExportEligible(null)).toBe(false)
    expect(isPendingExportEligible(null)).toBe(false)
  })
})

describe('exportSelection — 분류기·선택기 parity', () => {
  // 선택기의 ready 항만 hasExportableMedia 로 약화한 뮤턴트는 분류기만 검사하면
  // 안 죽는다 — generating/error + 이미지 씬이 실행에 섞여 들어간다.
  const scenes = [
    pendingWithImage('p1'),
    done('d1'),
    { id: 'g', status: 'generating', imagePath: '/p/g.png' },
    done('d2'),
    pendingNoImage('n'),
    pendingWithImage('p2'),
  ]

  it('includePending:false → classifyExportScenes().ready 와 identity 로 동일', () => {
    const selected = selectExportScenes(scenes, { includePending: false })
    const { ready } = classifyExportScenes(scenes)

    expect(selected).toHaveLength(ready.length)
    selected.forEach((s, i) => expect(s).toBe(ready[i]))
    expect(selected.map(s => s.id)).toEqual(['d1', 'd2'])
  })

  it('includePending:true → ready ∪ pendingWithImage, 원본 순서', () => {
    const selected = selectExportScenes(scenes, { includePending: true })

    // ready.concat(pending) 이면 ['d1','d2','p1','p2'] 가 된다.
    expect(selected.map(s => s.id)).toEqual(['p1', 'd1', 'd2', 'p2'])
    selected.forEach(s => expect(scenes).toContain(s))   // identity
  })

  it('옵션을 아예 안 넘기면 ready 만 반환한다 (기본 파라미터)', () => {
    expect(selectExportScenes(scenes, {}).map(s => s.id)).toEqual(['d1', 'd2'])
    expect(selectExportScenes(scenes).map(s => s.id)).toEqual(['d1', 'd2'])
  })
})

describe('exportSelection — hasExportAccess', () => {
  it('ready 0 + pendingWithImage 1 이면 true (헤더 버튼이 활성이어야 한다)', () => {
    expect(hasExportAccess([pendingWithImage('b')])).toBe(true)
  })

  it('ready 1 이면 true', () => {
    expect(hasExportAccess([done('a')])).toBe(true)
  })

  it('둘 다 0 이면 false', () => {
    expect(hasExportAccess([pendingNoImage('c')])).toBe(false)
    expect(hasExportAccess([])).toBe(false)
  })

  it('항상 boolean 이다', () => {
    expect(hasExportAccess(null)).toBe(false)
  })
})

describe('exportSelection — buildExportModalCounts (모달 표시용)', () => {
  it('total 은 씬 전체다 — ready + pending 이 아니다', () => {
    const scenes = [done('a'), done('b'), pendingWithImage('c'), pendingWithImage('d'),
                    pendingWithImage('e'), pendingNoImage('f'), pendingNoImage('g')]

    expect(buildExportModalCounts(scenes)).toEqual({
      totalSceneCount: 7,
      readyCount: 2,
      pendingWithImageCount: 3,
    })
    // 금지된 식(ready + pending = 5)은 total 과 갈린다 — 이 픽스처가 그걸 구분한다.
  })

  it('사건 재현: done 1 / pending+이미지 518', () => {
    const scenes = [done('scene_1'), ...Array.from({ length: 518 }, (_, i) => pendingWithImage(`s${i}`))]

    expect(buildExportModalCounts(scenes)).toEqual({
      totalSceneCount: 519, readyCount: 1, pendingWithImageCount: 518,
    })
  })

  it('빈 입력이어도 터지지 않는다', () => {
    expect(buildExportModalCounts(null)).toEqual({
      totalSceneCount: 0, readyCount: 0, pendingWithImageCount: 0,
    })
  })

  it('fixedMode 면 pending+image 가 있어도 pendingWithImageCount=0 이다 (fixed 는 포함 선택 없음)', () => {
    const scenes = [done('a'), done('b'), pendingWithImage('c')]
    expect(buildExportModalCounts(scenes, { fixedMode: true })).toEqual({
      totalSceneCount: 3, readyCount: 2, pendingWithImageCount: 0,
    })
    // 기본(비-fixed)은 그대로 센다.
    expect(buildExportModalCounts(scenes).pendingWithImageCount).toBe(1)
  })
})
