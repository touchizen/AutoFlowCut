/**
 * genModels — 모델 카탈로그 헬퍼 테스트
 *
 * modelLabel(id): ResultsTable / 상세 모달이 API 모델 id 를 사람이 읽는 라벨로
 * 변환할 때 쓰는 단일 소스. 카탈로그에 없으면 id 그대로(미래 모델/legacy 방어),
 * falsy 면 null.
 */
import { describe, it, expect } from 'vitest'
import { modelLabel, coerceImageModel, imageModelsForProvider, videoModelsForProvider, defaultImageModelForProvider, defaultVideoModelForProvider, listSupportedImageProviders, listSupportedVideoProviders, coerceResolution, supportsVideoReferenceImages, supportsVideoReferenceMimeType, categorizeApiModels, pickValidModel, computeModelHeal, IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID, VIDEO_REFERENCE_IMAGE_LIMIT } from '../../src/config/genModels'
import { FLOW_MODELS } from '../../src/engine/flowModels'

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

describe('genModels — provider-aware catalog (§5.12)', () => {
  it('기존 Gemini 이미지 모델은 google/exact 메타데이터 유지', () => {
    const geminiModels = IMAGE_MODELS.filter(m => m.id.startsWith('gemini-'))
    expect(geminiModels).toHaveLength(3)
    for (const model of geminiModels) {
      expect(model.provider).toBe('google')
      expect(model.aspectCapability).toBe('exact')
    }
  })

  it('기존 Veo 비디오 모델은 google provider 메타데이터 유지', () => {
    const veoModels = VIDEO_MODELS.filter((model) => model.provider === 'google')
    expect(veoModels).toHaveLength(3)
    for (const model of veoModels) expect(model.provider).toBe('google')
  })

  it('Grok Imagine 비디오 모델은 real-key gate 전 provisional 카탈로그다', () => {
    const grok = VIDEO_MODELS.find((model) => model.id === 'grok-imagine-video-1.5')
    expect(grok).toMatchObject({
      id: 'grok-imagine-video-1.5',
      label: 'Grok Imagine',
      cost: '?',
      unit: 'sec',
      provider: 'grok',
      provisional: true,
      descKey: 'settings.modelVidGrok',
    })
    expect(modelLabel(grok.id)).toBe('Grok Imagine')
  })

  it('gpt-image-1 카탈로그 항목 (드롭다운 provider 필터와 함께 추가)', () => {
    const gpt = IMAGE_MODELS.find(m => m.id === 'gpt-image-1')
    expect(gpt).toMatchObject({ id: 'gpt-image-1', label: 'GPT Image', provider: 'openai', aspectCapability: 'approx' })
    expect(modelLabel('gpt-image-1')).toBe('GPT Image')
    expect(coerceImageModel('gpt-image-1')).toBe('gpt-image-1')
  })

  it('fal image/video models are provisional catalog entries until the M4 real-key smoke', () => {
    const image = IMAGE_MODELS.find((model) => model.provider === 'fal')
    const video = VIDEO_MODELS.find((model) => model.provider === 'fal')

    expect(image).toMatchObject({
      id: 'fal-ai/flux-pro/v1.1',
      label: 'FLUX Pro 1.1 (fal)',
      provider: 'fal',
      provisional: true,
      aspectCapability: 'exact',
      descKey: 'settings.modelImgFalFlux',
    })
    expect(video).toMatchObject({
      id: 'fal-ai/kling-video/v2.1/standard/image-to-video',
      label: 'Kling 2.1 Standard (fal)',
      provider: 'fal',
      provisional: true,
      descKey: 'settings.modelVidFalKling',
    })
    expect(modelLabel(image.id)).toBe('FLUX Pro 1.1 (fal)')
    expect(modelLabel(video.id)).toBe('Kling 2.1 Standard (fal)')
  })

  it('WaveSpeed video model is a provisional M5 catalog entry', () => {
    const video = VIDEO_MODELS.find((model) => model.provider === 'wavespeed')
    expect(video).toMatchObject({
      id: 'wavespeed-ai/wan-2.1/t2v-480p',
      label: 'WaveSpeed WAN 2.1 T2V 480p',
      cost: '?',
      unit: 'sec',
      provider: 'wavespeed',
      provisional: true,
      descKey: 'settings.modelVidWaveSpeedWan',
    })
    expect(modelLabel(video.id)).toBe('WaveSpeed WAN 2.1 T2V 480p')
  })
})

describe('genModels — videoModelsForProvider + supported feature flag', () => {
  it('google 선택 → Grok 제외, provider 없는 live extra는 google로 포함', () => {
    const dynamic = [
      ...VIDEO_MODELS,
      { id: 'veo-future', label: 'Future Veo' },
    ]
    const list = videoModelsForProvider('google', dynamic)

    expect(list.some((model) => model.id === 'grok-imagine-video-1.5')).toBe(false)
    expect(list.some((model) => model.id === 'veo-future')).toBe(true)
    expect(list.every((model) => (model.provider ?? 'google') === 'google')).toBe(true)
  })

  it('grok 선택 → live Google 목록과 무관하게 정적 Grok 항목만 반환', () => {
    const list = videoModelsForProvider('grok', [
      { id: 'veo-live', provider: 'google' },
    ])
    expect(list.map((model) => model.id)).toEqual(['grok-imagine-video-1.5'])
  })

  it('provider별 기본 video 모델을 반환한다', () => {
    expect(defaultVideoModelForProvider()).toBe(DEFAULT_VIDEO_MODEL_ID)
    expect(defaultVideoModelForProvider('google')).toBe(DEFAULT_VIDEO_MODEL_ID)
    expect(defaultVideoModelForProvider('grok')).toBe('grok-imagine-video-1.5')
    expect(defaultVideoModelForProvider('unknown')).toBe(null)
  })

  it('지원 목록은 모든 모델이 provisional인 Grok을 제외한다', () => {
    expect(listSupportedVideoProviders()).toEqual(['google'])
  })

  it('fal video catalog remains resolvable while the supported list hides it', () => {
    expect(videoModelsForProvider('fal', [])).toHaveLength(1)
    expect(defaultVideoModelForProvider('fal')).toBe('fal-ai/kling-video/v2.1/standard/image-to-video')
    expect(listSupportedVideoProviders()).not.toContain('fal')
  })

  it('wavespeed catalog resolves generically while all-provisional feature flag hides it', () => {
    expect(videoModelsForProvider('wavespeed', []).map((model) => model.id)).toEqual([
      'wavespeed-ai/wan-2.1/t2v-480p',
    ])
    expect(defaultVideoModelForProvider('wavespeed')).toBe('wavespeed-ai/wan-2.1/t2v-480p')
    expect(listSupportedVideoProviders()).not.toContain('wavespeed')
  })
})

describe('genModels — imageModelsForProvider (드롭다운 provider 필터, 누출 방지)', () => {
  it('google 선택 → gpt-image(openai) 제외, gemini 만', () => {
    const list = imageModelsForProvider('google', IMAGE_MODELS)
    expect(list.every(m => m.provider === 'google')).toBe(true)
    expect(list.some(m => m.id === 'gpt-image-1')).toBe(false)
  })

  it('google 선택 → 라이브 dynamic extra(provider 필드 없음)는 google 로 간주해 포함', () => {
    const dynamic = [
      { id: 'gemini-3.1-flash-image', label: 'NB2', provider: 'google' },
      { id: 'gemini-9-flash-image', label: 'Future' }, // dynamic extra, provider 없음
    ]
    const list = imageModelsForProvider('google', dynamic)
    expect(list.map(m => m.id)).toEqual(['gemini-3.1-flash-image', 'gemini-9-flash-image'])
  })

  it('openai 선택 → 정적 카탈로그의 openai 항목(gpt-image), 라이브 google 목록 무관', () => {
    const dynamicGoogle = [{ id: 'gemini-3.1-flash-image', provider: 'google' }]
    const list = imageModelsForProvider('openai', dynamicGoogle)
    expect(list.map(m => m.id)).toEqual(['gpt-image-1'])
  })

  it('provider 미지정 → google 취급', () => {
    const list = imageModelsForProvider(undefined, IMAGE_MODELS)
    expect(list.some(m => m.id === 'gpt-image-1')).toBe(false)
  })

  it('fal image catalog remains resolvable while the supported list hides it', () => {
    expect(imageModelsForProvider('fal', []).map((model) => model.id))
      .toEqual(['fal-ai/flux-pro/v1.1'])
    expect(defaultImageModelForProvider('fal')).toBe('fal-ai/flux-pro/v1.1')
    expect(listSupportedImageProviders()).toEqual(['google', 'openai'])
    expect(listSupportedImageProviders()).not.toContain('fal')
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

  it('#R29-7: Flow 패밀리 모델도 allowedResolutions 로 강등 (Lite 4k → 1080p)', () => {
    expect(coerceResolution('Veo 3.1 - Lite', '4k')).toBe('1080p')   // ['720p','1080p'] → 1080p
    expect(coerceResolution('Omni Flash', '4k')).toBe('1080p')       // ['720p','1080p'] → 1080p
    expect(coerceResolution('Veo 3.1 - Fast', '4k')).toBe('4k')      // ['720p','1080p','4k'] → 그대로
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
    // veo-3.1-*-001 (GA) 는 Vertex AI 전용 — generativelanguage(Gemini API)엔 없어 미지원.
    expect(supportsVideoReferenceImages('veo-3.1-fast-generate-001')).toBe(false)
    expect(supportsVideoReferenceImages('veo-3.1-generate-001')).toBe(false)
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

  it('명시적 kind 필드를 술어보다 우선 — Flow raw 모델(표시 이름 id)도 올바르게 분류', () => {
    // engineFlow.listModels() 가 반환하는 FLOW_MODELS 는 표시 이름 id('Nano Banana Pro')라
    //   /image/ 술어로는 못 거른다 → kind:'image' 를 인정해야 round-trip 계약이 유지된다.
    const { imageModels, videoModels } = categorizeApiModels(FLOW_MODELS)
    const imgIds = imageModels.map(m => m.id)
    expect(imgIds).toContain('Nano Banana 2')
    expect(imgIds).toContain('Nano Banana Pro')
    expect(videoModels.map(m => m.id)).toContain('Omni Flash')
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

  it('OpenAI 이미지 provider는 Google 동적 목록으로 imageModel을 heal하지 않음', () => {
    const googleImageModels = [
      { id: 'gemini-2.5-flash-image' },
      { id: DEFAULT_IMAGE_MODEL_ID },
    ]
    const out = computeModelHeal(
      { imageModels: googleImageModels, videoModels: VIDEO_MODELS, source: 'dynamic' },
      {
        generation: { image: { provider: 'openai', model: 'gpt-image-1' } },
        imageModel: 'gpt-image-1',
        videoModelT2V: 'veo-3.1-fast-generate-preview',
        videoModelF2V: 'veo-3.1-fast-generate-preview',
      },
    )

    expect(out).not.toHaveProperty('imageModel')
  })

  it('generation 설정이 없으면 google provider로 간주해 기존 imageModel heal 유지', () => {
    const googleImageModels = [
      { id: 'gemini-2.5-flash-image' },
      { id: DEFAULT_IMAGE_MODEL_ID },
    ]
    const out = computeModelHeal(
      { imageModels: googleImageModels, videoModels: VIDEO_MODELS, source: 'dynamic' },
      {
        imageModel: 'stale-image-model',
        videoModelT2V: 'veo-3.1-fast-generate-preview',
        videoModelF2V: 'veo-3.1-fast-generate-preview',
      },
    )

    expect(out.imageModel).toBe(DEFAULT_IMAGE_MODEL_ID)
  })

  it('video: 단계 provider 가 비-google(grok) 이면 그 단계 모델을 heal 안 함 (§5.12, M2-선행 grok 생존)', () => {
    const googleVideoModels = [
      { id: 'veo-3.1-fast-generate-preview' },
      { id: 'veo-3.1-generate-preview' },
    ]
    const out = computeModelHeal(
      { imageModels: IMAGE_MODELS, videoModels: googleVideoModels, source: 'dynamic' },
      {
        imageModel: 'gemini-3.1-flash-image',
        videoModelT2V: 'grok-imagine-video-1.5',   // grok 모델
        videoModelF2V: 'veo-3.1-generate-preview', // google 모델
        generation: {
          image: { provider: 'google' },
          video: { t2v: { provider: 'grok' }, i2v: { provider: 'google' } },
        },
      },
    )
    // t2v provider=grok → heal 스킵(grok 모델 보존). i2v provider=google → 정상(이미 유효라 patch 없음)
    expect(out).not.toHaveProperty('videoModelT2V')
  })

  it('video: 단계 provider 가 google 이면 stale 모델을 heal (기존 동작 유지)', () => {
    const googleVideoModels = [{ id: 'veo-3.1-fast-generate-preview' }]
    const out = computeModelHeal(
      { imageModels: IMAGE_MODELS, videoModels: googleVideoModels, source: 'dynamic' },
      {
        imageModel: 'gemini-3.1-flash-image',
        videoModelT2V: 'stale-video',
        videoModelF2V: 'stale-video',
        // generation.video 없음 → 기본 google → 기존 heal
      },
    )
    expect(out.videoModelT2V).toBe('veo-3.1-fast-generate-preview')
  })

  it('Flow 모드는 google 전용 — openai provider 설정이 남아있어도 image heal 유지', () => {
    // Flow 는 google 전용이라 provider 설정과 무관하게 heal(mode 우선, Fable F3 forward-guard)
    const flowImageModels = [
      { id: 'flow_nb2', label: 'Nano Banana 2' },
      { id: 'flow_pro', label: 'Nano Banana Pro' },
    ]
    const out = computeModelHeal(
      { imageModels: flowImageModels, videoModels: VIDEO_MODELS, source: 'flow-static' },
      {
        generation: { image: { provider: 'openai', model: 'gpt-image-1' } },
        imageModel: 'stale-flow-image',
        videoModelT2V: 'veo-3.1-fast-generate-preview',
        videoModelF2V: 'veo-3.1-fast-generate-preview',
      },
      'flow',
    )
    expect(out.imageModel).toBe('flow_nb2') // Flow NB2 기본으로 heal (스킵 안 함)
  })
})
