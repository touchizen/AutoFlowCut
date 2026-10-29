// 2026-10-30 I2V — MCP `set-frame-pairs` 의 순수 계획(planMcpFramePairs). 에이전트가 씬 번호(0-based index)만 주면
//   그 씬을 시작 프레임으로 하는 I2V 행(끝 프레임 없음, 선택)을 만들거나 고치고, **나머지 행은 선택을 푼다** — I2V 배치는 선택된 행을 완료여도 다시 만든다
//   (useVideoAutomation 이슈1). 행 모양은 '⚡ 자동 추가'(FrameToVideoPanel autoBatch)와 같다. 이미지 없는 씬·범위 밖 index 는 아무것도 바꾸지 않고 거부.
import { describe, it, expect } from 'vitest'
import { planMcpFramePairs } from '../../src/utils/mcpFramePairs.js'
import { getNextPairId } from '../../src/utils/framePairIds.js'

// 시작 프레임 바이트 원천이 있는 씬(디스크 imagePath) — scene_5 는 이미지가 없다
const scene = (n, extra = {}) => ({ id: `scene_${n}`, prompt: `image prompt ${n}`, mediaId: `m${n}`, imagePath: `/p/scene_${n}.jpg`, ...extra })
const SCENES = [scene(1), scene(2), scene(3, { mediaId: null }), scene(4), scene(5, { mediaId: null, imagePath: null })]

describe('getNextPairId — 현재 행의 최대 fp_N + 1', () => {
  it('비었으면 1, 섞인 id 는 숫자만 본다', () => {
    expect(getNextPairId([])).toBe(1)
    expect(getNextPairId([{ id: 'fp_2' }, { id: 'fp_10' }, { id: 'x' }, null])).toBe(11)
  })
})

describe('planMcpFramePairs(prevPairs, scenes, indexes)', () => {
  it('행이 없는 씬 → 새 행(시작 = 그 씬, 끝 없음, selected:true, autoBatch 와 같은 모양)', () => {
    const r = planMcpFramePairs([], SCENES, [3])
    expect(r).toEqual({
      ok: true,
      pairs: [{ id: 'fp_1', ownerSceneId: 'scene_4', startSceneId: 'scene_4', endSceneId: '', prompt: 'image prompt 4', videoPrompt: '', customPrompt: '', status: 'waiting', selected: true }],
      rows: [{ index: 3, sceneId: 'scene_4', id: 'fp_1' }],
    })
  })

  it('이미 그 씬이 주인인 행 → 그 행을 고친다(시작 = 주인 씬, 끝 비움, 선택) — 다른 행은 선택 해제, 새 id 없음', () => {
    const prev = [
      { id: 'fp_3', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: 'scene_2', status: 'complete', selected: true, videoPath: '/v/i2v_3.mp4' },
      { id: 'fp_4', ownerSceneId: 'scene_4', startSceneId: 'scene_2', endSceneId: 'scene_5', status: 'error', selected: false },
    ]
    const r = planMcpFramePairs(prev, SCENES, [3])
    expect(r.ok).toBe(true)
    expect(r.pairs).toEqual([
      { ...prev[0], selected: false },
      { ...prev[1], startSceneId: 'scene_4', endSceneId: '', selected: true },
    ])
    expect(r.rows).toEqual([{ index: 3, sceneId: 'scene_4', id: 'fp_4' }])
  })

  it('여러 씬: 순서대로, 새 id 는 기존 최대 + 1 부터 · 갤러리 행(owner 없음)도 선택 해제', () => {
    const prev = [{ id: 'fp_7', ownerSceneId: null, startSceneId: 'gallery::m9', endSceneId: '', selected: true }]
    const r = planMcpFramePairs(prev, SCENES, [0, 2])
    expect(r.pairs.map((p) => [p.id, p.ownerSceneId, p.selected])).toEqual([['fp_7', null, false], ['fp_8', 'scene_1', true], ['fp_9', 'scene_3', true]])
    expect(r.rows).toEqual([{ index: 0, sceneId: 'scene_1', id: 'fp_8' }, { index: 2, sceneId: 'scene_3', id: 'fp_9' }])
  })

  it('이미지(mediaId·imagePath·image) 없는 씬 → no-image + 그 index 들, 아무것도 안 바꾼다', () => {
    expect(planMcpFramePairs([], SCENES, [0, 4])).toEqual({ ok: false, error: 'no-image', indexes: [4] })
  })

  it.each([[[5]], [[-1]], [[1.5]], [['1']]])('범위 밖·정수 아님 index %j → bad-index', (indexes) => {
    expect(planMcpFramePairs([], SCENES, indexes)).toMatchObject({ ok: false, error: 'bad-index' })
  })

  it('원본 배열·행을 바꾸지 않는다', () => {
    const prev = [{ id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: 'scene_2', selected: true }]
    const frozen = JSON.stringify(prev)
    planMcpFramePairs(prev, SCENES, [0])
    expect(JSON.stringify(prev)).toBe(frozen)
  })
})

// Codex 리뷰(2026-10-30) H1: 옛 프로젝트엔 같은 씬이 주인인 행이 둘 이상 있을 수 있다(마이그레이션) — 씬마다 **한 행만** 선택하고 나머지는 해제(아니면 한 씬 요청이 두 번 과금).
// Codex 리뷰 M4: 과금된 작업을 복구 대기 중인 행(완료 아님 + generationId/mediaId)의 입력(시작·끝 프레임)을 바꾸면 다음 시작의 download-only 가 **옛 입력의 영상**을 새 결과로 가져온다
//   → 입력이 바뀌는 경우만 needs-recovery 로 거부(식별자는 지우지 않는다). 입력이 그대로면(시작 = 주인, 끝 없음) 복구 경로 그대로 둔다.
describe('planMcpFramePairs — 중복 주인 · 복구 대기 행', () => {
  it('같은 씬이 주인인 행이 둘 → 첫 행만 선택, 둘째는 선택 해제, rows 는 첫 행', () => {
    const prev = [
      { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', selected: true },
      { id: 'fp_2', ownerSceneId: 'scene_1', startSceneId: 'scene_2', endSceneId: '', selected: true },
    ]
    const r = planMcpFramePairs(prev, SCENES, [0])
    expect(r.pairs.map((p) => [p.id, p.selected])).toEqual([['fp_1', true], ['fp_2', false]])
    expect(r.rows).toEqual([{ index: 0, sceneId: 'scene_1', id: 'fp_1' }])
  })

  it.each([
    ['error + generationId·mediaId, 시작이 다른 씬', { status: 'error', generationId: 'g1', mediaId: 'v1', startSceneId: 'scene_2', endSceneId: '' }],
    ['generating(옛 세션 in-flight), 끝 프레임 있음', { status: 'generating', generationId: 'g1', startSceneId: 'scene_1', endSceneId: 'scene_2' }],
  ])('복구 대기 행의 입력이 바뀌면 needs-recovery + indexes — 아무것도 안 바꾼다 (%s)', (_label, row) => {
    const prev = [{ id: 'fp_1', ownerSceneId: 'scene_1', selected: false, ...row }]
    expect(planMcpFramePairs(prev, SCENES, [0])).toEqual({ ok: false, error: 'needs-recovery', indexes: [0] })
  })

  it('복구 대기 행이라도 입력이 그대로면(시작 = 주인, 끝 없음) 그대로 선택 — 식별자 보존(복구가 같은 영상을 받는다)', () => {
    const prev = [{ id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', status: 'error', generationId: 'g1', mediaId: 'v1', selected: false }]
    const r = planMcpFramePairs(prev, SCENES, [0])
    expect(r.ok).toBe(true)
    expect(r.pairs[0]).toEqual({ ...prev[0], selected: true })
  })

  it('완료 행은 입력을 바꿔도 된다(배치가 새로 만든다)', () => {
    const prev = [{ id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_2', endSceneId: 'scene_3', status: 'complete', generationId: 'g1', mediaId: 'v1', videoPath: '/v.mp4', selected: false }]
    expect(planMcpFramePairs(prev, SCENES, [0]).ok).toBe(true)
  })
})

// Fable 리뷰 2: I2V 는 시작 프레임 **바이트**가 필요하다(새 Flow 는 붙여넣기 업로드, API 는 inline) — Flow mediaId 만 있거나 image 가 CDN URL 뿐인 씬(아카이브 복원)은
//   200 으로 받아 주면 행마다 flow-i2v-start-frame-missing 로 줄줄이 실패한다 → 계획 단계에서 no-image(422).
// Fable 리뷰 6: 저장된 영상이 있는 행은 회수 대기가 아니다(훅의 Flow 분류도 !videoPath).
describe('planMcpFramePairs — 바이트 원천 · 저장 영상', () => {
  it('mediaId 만·CDN URL 만인 씬 → no-image, imagePath·data URL 이 있으면 통과', () => {
    const scenes = [
      { id: 'scene_1', mediaId: 'm1' },
      { id: 'scene_2', image: 'https://flow-content.google/image/x?sig=1', mediaId: 'm2' },
      { id: 'scene_3', imagePath: '/p/scene_3.jpg' },
      { id: 'scene_4', image: 'data:image/png;base64,QUJD' },
    ]
    expect(planMcpFramePairs([], scenes, [0, 1, 2, 3])).toEqual({ ok: false, error: 'no-image', indexes: [0, 1] })
    expect(planMcpFramePairs([], scenes, [2, 3]).ok).toBe(true)
  })
  it('저장된 영상(videoPath)이 있는 행은 입력을 바꿔도 된다', () => {
    const prev = [{ id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_2', endSceneId: '', status: 'error', generationId: 'g1', mediaId: 'v1', videoPath: '/v/i2v_1.mp4', selected: false }]
    expect(planMcpFramePairs(prev, SCENES, [0]).ok).toBe(true)
  })
})

// Codex 2차 M3: 회수 대기 행은 프레임이 그대로여도 **실제 프롬프트**가 바뀌면(프롬프트 출처 image → video 등) 다음 시작의 복구가 옛 프롬프트의 영상을
//   새 요청의 결과처럼 가져온다 → needs-recovery. 출처가 같거나 결과 프롬프트가 같으면 통과.
describe('planMcpFramePairs — 회수 대기 행의 프롬프트 출처 변경', () => {
  const pending = { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', status: 'error', generationId: 'g1', mediaId: 'v1', selected: false }
  const scenes = [{ id: 'scene_1', prompt: 'image prompt', videoT2VPrompt: 'motion prompt', imagePath: '/p/scene_1.jpg' }]
  it('image → video 로 실제 프롬프트가 달라지면 needs-recovery', () => {
    expect(planMcpFramePairs([pending], scenes, [0], { fromPromptSource: 'image', toPromptSource: 'video' })).toEqual({ ok: false, error: 'needs-recovery', indexes: [0] })
  })
  it('출처가 같거나 결과 프롬프트가 같으면 통과', () => {
    expect(planMcpFramePairs([pending], scenes, [0], { fromPromptSource: 'video', toPromptSource: 'video' }).ok).toBe(true)
    const same = [{ id: 'scene_1', prompt: 'same', videoT2VPrompt: 'same', imagePath: '/p/scene_1.jpg' }]
    expect(planMcpFramePairs([pending], same, [0], { fromPromptSource: 'image', toPromptSource: 'video' }).ok).toBe(true)
  })
})

// Codex 3차 M3: 프롬프트 출처는 **전역**이다 — 회수 대기 행 A 가 아닌 B 를 고르며 출처를 바꾸면 A 의 실제 프롬프트도 바뀐다(다음 A 요청은 video → video 로 통과).
//   출처가 바뀔 때는 고른 행만이 아니라 **모든** 회수 대기 행을 본다 — 프롬프트가 달라지는 행이 있으면 그 행의 씬 index 로 needs-recovery.
describe('planMcpFramePairs — 전역 출처 변경은 모든 회수 대기 행을 본다', () => {
  const scenes = [
    { id: 'scene_1', prompt: 'image A', videoT2VPrompt: 'motion A', imagePath: '/p/scene_1.jpg' },
    { id: 'scene_2', prompt: 'image B', videoT2VPrompt: 'motion B', imagePath: '/p/scene_2.jpg' },
  ]
  const pendingA = { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', status: 'error', generationId: 'g1', mediaId: 'v1', selected: false }
  it('B 를 고르며 image → video 면 A 때문에 needs-recovery(indexes = A 의 씬)', () => {
    expect(planMcpFramePairs([pendingA], scenes, [1], { fromPromptSource: 'image', toPromptSource: 'video' })).toEqual({ ok: false, error: 'needs-recovery', indexes: [0] })
  })
  it('출처가 그대로면 B 는 통과', () => {
    expect(planMcpFramePairs([pendingA], scenes, [1], { fromPromptSource: 'video', toPromptSource: 'video' }).ok).toBe(true)
  })
})

// Codex 4차 M1: 갤러리 행(주인 씬 없음)도 회수 대기면 전역 출처 변경에 걸린다 — 씬 index 로 못 나타내니 pairIds 로 알린다.
describe('planMcpFramePairs — 회수 대기 갤러리 행', () => {
  it('주인 없는 회수 대기 행의 프롬프트가 바뀌면 needs-recovery + pairIds', () => {
    const gallery = { id: 'fp_7', ownerSceneId: null, startSceneId: 'gallery::m9', endSceneId: '', prompt: 'image G', videoPrompt: 'motion G', status: 'error', generationId: 'g7', mediaId: 'v7', selected: false }
    expect(planMcpFramePairs([gallery], SCENES, [0], { fromPromptSource: 'image', toPromptSource: 'video' })).toEqual({ ok: false, error: 'needs-recovery', indexes: [], pairIds: ['fp_7'] })
  })
})

// Codex 5차 P2: 옛 서버측 생성 실패 행(PUBLIC_ERROR_* · errorKind 없음 · mediaId·videoPath 없음)은 회수할 영상이 없다 — 배치 분류기와 같이 회수 대기로 세지 않는다.
describe('planMcpFramePairs — 옛 서버측 생성 실패 행', () => {
  const legacy = { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_2', endSceneId: 'scene_3', status: 'error', error: 'PUBLIC_ERROR_UNSAFE', errorKind: null, generationId: '11111111-0000-4000-8000-000000000000', mediaId: null, selected: false }
  it('프레임을 바꿔도 된다', () => { expect(planMcpFramePairs([legacy], SCENES, [0]).ok).toBe(true) })
  it('출처를 바꿔도 된다(실제 프롬프트가 달라지는 씬이어도)', () => {
    const scenes = [{ id: 'scene_1', prompt: 'image A', videoT2VPrompt: 'motion A', imagePath: '/p/scene_1.jpg' }, { id: 'scene_2', prompt: 'image B', imagePath: '/p/scene_2.jpg' }]
    expect(planMcpFramePairs([{ ...legacy, startSceneId: 'scene_1', endSceneId: '' }], scenes, [1], { fromPromptSource: 'image', toPromptSource: 'video' }).ok).toBe(true)
  })
})
