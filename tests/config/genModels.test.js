/**
 * genModels — 모델 카탈로그 헬퍼 테스트
 *
 * modelLabel(id): ResultsTable / 상세 모달이 API 모델 id 를 사람이 읽는 라벨로
 * 변환할 때 쓰는 단일 소스. 카탈로그에 없으면 id 그대로(미래 모델/legacy 방어),
 * falsy 면 null.
 */
import { describe, it, expect } from 'vitest'
import { modelLabel, coerceResolution, supportsVideoReferenceImages, supportsVideoReferenceMimeType, categorizeApiModels, pickValidModel, computeModelHeal, IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL_ID, VIDEO_REFERENCE_IMAGE_LIMIT } from '../../src/config/genModels'

describe('genModels — modelLabel', () => {
  it('이미지 모델 id → 라벨', () => {
    expect(modelLabel('gemini-2.5-flash-image')).toBe('Nano Banana')
    expect(modelLabel('gemini-3.1-flash-image')).toBe('Nano Banana 2')
    expect(modelLabel('gemini-3-pro-image')).toBe('Nano Banana Pro')
  })

  it('비디오 모델 id → 라벨', () => {
    expect(modelLabel('veo-3.1-lite-generate-preview')).toBe('Veo 3.1 Lite')
    expect(modelLabel('veo-3.1-fast-generate-preview')).toBe('Veo 3.1 Fast')
    expect(modelLabel('veo-3.1-generate-preview')).toBe('Veo 3.1 Quality')
  })

  it('카탈로그에 없는 id 는 그대로 통과 (legacy/미래 모델 방어)', () => {
    expect(modelLabel('some-unknown-model-2027')).toBe('some-unknown-model-2027')
  })

  it('falsy 값은 null', () => {
    expect(modelLabel(null)).toBeNull()
    expect(modelLabel(undefined)).toBeNull()
    expect(modelLabel('')).toBeNull()
  })
})

describe('genModels — coerceResolution (모델별 해상도 가드)', () => {
  // 공식: Veo 3.1 Lite 는 4K 미지원(720p/1080p). Fast/Quality 는 4K 지원.
  // 전역 resolution + 타입별 모델 조합에서 Lite+4K 가 API 로 새어나가 실패하는 걸 막는다.
  it('Lite + 4k → 허용 최대(1080p)로 강등', () => {
    expect(coerceResolution('veo-3.1-lite-generate-preview', '4k')).toBe('1080p')
  })

  it('Fast/Quality + 4k → 그대로 유지', () => {
    expect(coerceResolution('veo-3.1-fast-generate-preview', '4k')).toBe('4k')
    expect(coerceResolution('veo-3.1-generate-preview', '4k')).toBe('4k')
  })

  it('Lite + 허용 해상도(720p/1080p)는 그대로', () => {
    expect(coerceResolution('veo-3.1-lite-generate-preview', '720p')).toBe('720p')
    expect(coerceResolution('veo-3.1-lite-generate-preview', '1080p')).toBe('1080p')
  })

  it('falsy resolution 은 그대로 통과(엔진 기본값 위임)', () => {
    expect(coerceResolution('veo-3.1-lite-generate-preview', null)).toBeNull()
    expect(coerceResolution('veo-3.1-lite-generate-preview', undefined)).toBeUndefined()
  })

  it('알 수 없는 모델 id 는 known 해상도를 건드리지 않음', () => {
    expect(coerceResolution('veo-3.1-fast', '4k')).toBe('4k')
    expect(coerceResolution(undefined, '4k')).toBe('4k')
  })

  it('미지의(known set 밖) 해상도는 무단 상향 없이 undefined(엔진 기본)로', () => {
    // 회귀: 예전 구현은 known-set 밖 값까지 모델 최대로 올려 'foo'/'2k' 가 Fast/Quality 에서
    // '4k' 가 됐다(비용·8초 강제 폭증). 알 수 없는 값은 엔진 기본(720p)에 위임해야 한다.
    expect(coerceResolution('veo-3.1-fast-generate-preview', '2k')).toBeUndefined()
    expect(coerceResolution('veo-3.1-fast-generate-preview', 'foo')).toBeUndefined()
    expect(coerceResolution('veo-3.1-generate-preview', '4K')).toBeUndefined() // 대문자 변종도 미지 처리
    expect(coerceResolution('veo-3.1-lite-generate-preview', '2k')).toBeUndefined()
  })
})

describe('genModels — supportsVideoReferenceImages', () => {
  it('Veo reference images 는 Fast/Quality 에서만 허용하고 Lite 는 차단', () => {
    expect(supportsVideoReferenceImages('veo-3.1-fast-generate-preview')).toBe(true)
    expect(supportsVideoReferenceImages('veo-3.1-generate-preview')).toBe(true)
    expect(supportsVideoReferenceImages('veo-3.1-fast-generate-001')).toBe(true)
    expect(supportsVideoReferenceImages('veo-3.1-generate-001')).toBe(true)
    expect(supportsVideoReferenceImages('veo-3.1-lite-generate-preview')).toBe(false)
    expect(supportsVideoReferenceImages(undefined)).toBe(false)
  })
})

describe('genModels — VIDEO_REFERENCE_IMAGE_LIMIT', () => {
  it('Veo reference image limit is centralized', () => {
    expect(VIDEO_REFERENCE_IMAGE_LIMIT).toBe(3)
  })
})

describe('genModels — supportsVideoReferenceMimeType', () => {
  it('Veo video reference images accept PNG/JPEG/WebP only', () => {
    expect(supportsVideoReferenceMimeType('image/png')).toBe(true)
    expect(supportsVideoReferenceMimeType('image/jpeg')).toBe(true)
    expect(supportsVideoReferenceMimeType('image/webp')).toBe(true)
    expect(supportsVideoReferenceMimeType('image/gif')).toBe(false)
    expect(supportsVideoReferenceMimeType(undefined)).toBe(false)
    expect(supportsVideoReferenceMimeType('')).toBe(false)
  })
})

describe('genModels — cost i18n (한글 단위 누출 방지)', () => {
  it('카탈로그 cost 는 ASCII 만(한글 단위 없음) + unit 필드 보유', () => {
    for (const m of [...IMAGE_MODELS, ...VIDEO_MODELS]) {
      expect(m.cost).toMatch(/^[\x20-\x7E]*$/) // printable ASCII only — '장'/'초' 같은 한글 금지
      expect(['image', 'sec']).toContain(m.unit)
    }
  })
})

describe('genModels — categorizeApiModels (라이브 /models → 카테고리)', () => {
  const raw = [
    { id: 'gemini-2.5-flash-image', displayName: 'NB live', methods: ['generateContent'] },
    { id: 'gemini-9-flash-image', displayName: 'Future Flash Image', description: 'new', methods: ['generateContent'] },
    { id: 'imagen-4.0-generate-001', displayName: 'Imagen 4', methods: ['predict'] },
    { id: 'gemini-2.5-flash', displayName: 'Flash text', methods: ['generateContent'] },
    { id: 'veo-3.1-fast-generate-preview', displayName: 'Veo Fast live', methods: ['predictLongRunning'] },
    { id: 'veo-2.0-generate-001', displayName: 'Veo 2', methods: ['predictLongRunning'] },
  ]

  it('이미지: generateContent+image 만, 큐레이션 우선 + extra raw (imagen/텍스트 제외)', () => {
    const { imageModels } = categorizeApiModels(raw)
    expect(imageModels.map(m => m.id)).toEqual(['gemini-2.5-flash-image', 'gemini-9-flash-image'])
    expect(imageModels[0].label).toBe('Nano Banana')   // 큐레이션 라벨 유지
    expect(imageModels[0].cost).toBe('$0.039')          // 큐레이션 비용 유지(단위는 unit 필드)
    expect(imageModels[1].label).toBe('Future Flash Image') // extra = displayName
  })

  it('비디오: predictLongRunning, 큐레이션 우선 + extra(veo-2)', () => {
    const { videoModels } = categorizeApiModels(raw)
    expect(videoModels.map(m => m.id)).toEqual(['veo-3.1-fast-generate-preview', 'veo-2.0-generate-001'])
    expect(videoModels[0].label).toBe('Veo 3.1 Fast')
    expect(videoModels[1].label).toBe('Veo 2')
  })

  it('null/빈 입력 → 빈 목록', () => {
    expect(categorizeApiModels(null)).toEqual({ imageModels: [], videoModels: [] })
  })
})

describe('genModels — pickValidModel (권위 있는 목록 기준 치유)', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('id 가 목록에 있으면 그대로', () => {
    expect(pickValidModel(list, 'b', 'a')).toBe('b')
  })
  it('id 가 목록에 없고 default 가 목록에 있으면 default', () => {
    expect(pickValidModel(list, 'stale', 'a')).toBe('a')
  })
  it('id·default 둘 다 목록에 없으면 첫 항목', () => {
    expect(pickValidModel(list, 'stale', 'nope')).toBe('a')
  })
  it('빈 목록이면(권위 없음) id 보존', () => {
    expect(pickValidModel([], 'x', 'a')).toBe('x')
    expect(pickValidModel(null, 'x', 'a')).toBe('x')
  })
  it('falsy id 면 default(목록에 있으면)', () => {
    expect(pickValidModel(list, undefined, 'c')).toBe('c')
  })
})

describe('genModels — computeModelHeal (권위 있는 목록으로 stale 저장값 치유)', () => {
  it('정적 폴백(카탈로그 참조 그대로)이면 치유 안 함 — 보존', () => {
    const out = computeModelHeal(
      { imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS },
      { imageModel: 'stale-dynamic', videoModelT2V: 'x', videoModelF2V: 'y' },
    )
    expect(out).toEqual({})
  })

  it('동적 목록에 없는 저장값 → 치유(default 우선, 없으면 첫 항목), 유효한 건 그대로', () => {
    const dynImg = [{ id: DEFAULT_IMAGE_MODEL_ID }, { id: 'gemini-9' }] // default 포함
    const dynVid = [{ id: 'veo-2.0-generate-001' }]                     // default 미포함
    const out = computeModelHeal(
      { imageModels: dynImg, videoModels: dynVid },
      { imageModel: 'stale', videoModelT2V: 'veo-stale', videoModelF2V: 'veo-2.0-generate-001' },
    )
    expect(out.imageModel).toBe(DEFAULT_IMAGE_MODEL_ID)     // default in list
    expect(out.videoModelT2V).toBe('veo-2.0-generate-001')  // default 없음 → 첫 항목
    expect('videoModelF2V' in out).toBe(false)              // 이미 유효 → 변경 없음
  })

  it('동적 목록에 있는 저장값 → 변경 없음', () => {
    const out = computeModelHeal(
      { imageModels: [{ id: 'gemini-9' }], videoModels: VIDEO_MODELS },
      { imageModel: 'gemini-9', videoModelT2V: 'x', videoModelF2V: 'y' },
    )
    expect(out).toEqual({})
  })
})
