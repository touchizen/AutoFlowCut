import { describe, it, expect, vi } from 'vitest'
import { createStyleResolver } from '../../src/services/styleResolver'

const t = (k, vars) => {
  const map = {
    'reference.autoMatch': '자동 (씬별 매칭)',
    'reference.autoMatchNone': '자동 (매칭 없음)',
    'reference.matchPreviewTitle': '씬별 매칭 미리보기',
    'reference.matchPreviewSummary': '{name}: {count}개 씬',
    'reference.matchPreviewUnmatched': '미매칭: {count}개 씬',
    'reference.matchPreviewEmpty': '매칭된 씬이 없습니다',
    'reference.autoMatchHint': '씬별 style_tag로 스타일을 자동 결정합니다',
    'reference.noStyle': '스타일 없음',
    'actions.styleNone': '없음',
    'actions.autoStyle': '자동: {label}',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

const tEn = (k, vars) => {
  const map = {
    'reference.autoMatch': 'Auto (per-scene match)',
    'reference.autoMatchNone': 'Auto (no matches)',
    'reference.matchPreviewTitle': 'Per-scene match preview',
    'reference.matchPreviewSummary': '{name}: {count} scenes',
    'reference.matchPreviewUnmatched': 'Unmatched: {count} scenes',
    'reference.matchPreviewEmpty': 'No matching scenes',
    'reference.autoMatchHint': 'Automatically chooses styles from each scene style_tag',
    'reference.noStyle': 'No style',
    'actions.styleNone': 'None',
    'actions.autoStyle': 'Auto: {label}',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

const baseDeps = {
  activeTab: 'list',
  scenes: [],
  references: [],
  selectedStyleRefId: null,
  t,
  isKo: true,
}

describe('createStyleResolver — autoEffectiveStyleId', () => {
  it('image/list tab: returns null (auto-match handled per-scene by useAutomation)', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'list' })
    expect(r.autoEffectiveStyleId).toBeNull()
  })

  it('video-text tab: returns first prompt style card via findAutoPromptStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', prompt: 'film noir lighting', filePath: '/refs/my-noir.png' }],
    })
    expect(r.autoEffectiveStyleId).toBe('ref:7')
  })

  it('video-text tab: ignores image-only style cards because Veo cannot consume style refs', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', filePath: '/refs/my-noir.png' }],
    })
    expect(r.autoEffectiveStyleId).toBeNull()
  })

  it('video-text tab: null when no usable style card', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'video-text', references: [] })
    expect(r.autoEffectiveStyleId).toBeNull()
  })
})

describe('createStyleResolver — autoAvailable', () => {
  it('image/list: true when at least one pending scene matches', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, prompt: 'a scene', style_tag: 'noir' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoAvailable).toBe(true)
  })

  it('image/list: false when no pending scene matches', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, prompt: 'a scene', style_tag: '' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoAvailable).toBe(false)
  })

  it('video-text: true when findAutoPromptStyle finds a prompt style card', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', prompt: 'film noir lighting', filePath: '/refs/my-noir.png' }],
    })
    expect(r.autoAvailable).toBe(true)
  })

  it('video-text: false when no usable style card', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'video-text', references: [] })
    expect(r.autoAvailable).toBe(false)
  })
})

describe('createStyleResolver — autoLabel', () => {
  it('image/list with matches: shows top match name with +N', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [
        { id: 1, style_tag: 'noir' },
        { id: 2, style_tag: 'noir' },
        { id: 3, style_tag: 'cinematic' },
      ],
      references: [
        { id: 10, type: 'style', name: 'noir', prompt: 'noir' },
        { id: 11, type: 'style', name: 'cinematic', prompt: 'cine' },
      ],
    })
    expect(r.autoLabel).toBe('자동: noir +1')
  })

  it('image/list preset auto label follows English UI language', () => {
    const r = createStyleResolver({
      ...baseDeps,
      t: tEn,
      isKo: false,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: 'cinematic' }],
      references: [],
    })
    expect(r.autoLabel).toBe('Auto: Cinematic')
  })

  it('image/list with no matches: returns styleNone label', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, prompt: 'a scene', style_tag: '' }],
    })
    expect(r.autoLabel).toBe('없음')
  })

  it('video-text: shows the resolved auto style ref name', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', prompt: 'film noir lighting', filePath: '/refs/my-noir.png' }],
    })
    expect(r.autoLabel).toBe('자동: My Noir')
  })

  it('video-text with no usable card: styleNone label', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'video-text' })
    expect(r.autoLabel).toBe('없음')
  })
})

describe('createStyleResolver — autoCardMeta', () => {
  it('returns label + icon 🪄 + tooltip + summary when scene matches exist (image/list)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: 'noir' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoCardMeta.icon).toBe('🪄')
    expect(r.autoCardMeta.label).toBe('자동 (씬별 매칭)')
    expect(r.autoCardMeta.tooltip).toContain('씬별 매칭 미리보기')
    expect(r.autoCardMeta.summary).toContain('noir')
  })

  it('returns icon 🚫 + null summary when no matches (image/list)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, prompt: 'a scene', style_tag: '' }],
    })
    expect(r.autoCardMeta.icon).toBe('🚫')
    expect(r.autoCardMeta.label).toBe('자동 (매칭 없음)')
    expect(r.autoCardMeta.summary).toBeNull()
  })

  it('video-text: icon 🪄 + label is the auto style name + summary null', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', prompt: 'film noir lighting', filePath: '/refs/my-noir.png' }],
    })
    expect(r.autoCardMeta.icon).toBe('🪄')
    expect(r.autoCardMeta.label).toBe('자동: My Noir')
    expect(r.autoCardMeta.summary).toBeNull()
    expect(r.autoCardMeta.tooltip).toBe('')
  })
})

describe('createStyleResolver — resolveLabelForId', () => {
  it('returns ref name for ref:N', () => {
    const r = createStyleResolver({
      ...baseDeps,
      references: [{ id: 7, type: 'style', name: 'My Noir' }],
    })
    expect(r.resolveLabelForId('ref:7')).toBe('My Noir')
  })

  it('returns preset name_ko for preset:* (isKo=true)', () => {
    const r = createStyleResolver({ ...baseDeps, isKo: true })
    expect(r.resolveLabelForId('preset:cinematic')).toBe('시네마틱')
  })

  it('returns autoLabel for null id (delegates to autoLabel)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', prompt: 'film noir lighting', filePath: '/refs/my-noir.png' }],
    })
    expect(r.resolveLabelForId(null)).toBe('자동: My Noir')
  })
})

describe('createStyleResolver — resolveEffectiveStyleId', () => {
  it('undefined override: returns selectedStyleRefId', () => {
    const r = createStyleResolver({ ...baseDeps, selectedStyleRefId: 'preset:noir' })
    expect(r.resolveEffectiveStyleId(undefined)).toBe('preset:noir')
  })

  it('null override (image/list): returns null (auto mode)', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'list', selectedStyleRefId: 'preset:noir' })
    expect(r.resolveEffectiveStyleId(null)).toBeNull()
  })

  it('null override (video-text): returns findAutoPromptStyle result', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      selectedStyleRefId: 'preset:noir',
      references: [{ id: 7, type: 'style', name: 'My Noir', prompt: 'film noir lighting', filePath: '/refs/my-noir.png' }],
    })
    expect(r.resolveEffectiveStyleId(null)).toBe('ref:7')
  })

  it('explicit ref:* override: returns it as-is', () => {
    const r = createStyleResolver({ ...baseDeps, selectedStyleRefId: 'preset:noir' })
    expect(r.resolveEffectiveStyleId('ref:99')).toBe('ref:99')
  })

  it('undefined override + video-text + null selection: returns findAutoPromptStyle (P1 #1 — label/apply parity)', () => {
    // Regression guard: video-text Start button (handleStart() with no override) must apply
    // the same auto style the label promises ("자동: My Noir"), not silently null-out.
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      selectedStyleRefId: null,
      references: [{ id: 7, type: 'style', name: 'My Noir', prompt: 'film noir lighting', filePath: '/refs/my-noir.png' }],
    })
    expect(r.resolveEffectiveStyleId(undefined)).toBe('ref:7')
  })

  it('undefined override + image/list + null selection: returns null (per-scene matching by useAutomation)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      selectedStyleRefId: null,
    })
    expect(r.resolveEffectiveStyleId(undefined)).toBeNull()
  })

  it('video-text ignores a selected image-only style ref and falls back to prompt auto style', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      selectedStyleRefId: 'ref:7',
      references: [
        { id: 7, type: 'style', name: 'Image Only', filePath: '/refs/image-only.png' },
        { id: 8, type: 'style', name: 'Prompt Style', prompt: 'film noir lighting' },
      ],
    })
    expect(r.resolveEffectiveStyleId(undefined)).toBe('ref:8')
  })

  it('video-text treats an explicit image-only style ref override as unavailable', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'Image Only', filePath: '/refs/image-only.png' }],
    })
    expect(r.resolveEffectiveStyleId('ref:7')).toBeNull()
    expect(r.resolveLabelForId('ref:7')).toBe('없음')
  })
})

describe('createStyleResolver — resolveEffectiveStyleIdForRef (reference generation domain)', () => {
  it('priority: override → selectedStyleRefId → findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: 'preset:noir',
      references: [{ id: 7, type: 'style', name: 'My Noir', filePath: '/refs/my-noir.png' }],
    })
    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('preset:noir')
    expect(r.resolveEffectiveStyleIdForRef('ref:99')).toBe('ref:99')
  })

  it('null override falls through to selected then findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      references: [{ id: 7, type: 'style', name: 'My Noir', filePath: '/refs/my-noir.png' }],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:7')
  })
})

describe('createStyleResolver — Ref가 씬들의 단일 effective style을 파생 상속한다', () => {
  const pendingScene = (id, styleTag) => ({ id, prompt: `scene-${id}`, style_tag: styleTag })

  it('style 카드 name이 태그에 매칭되면 같은 이름의 preset보다 ref를 우선한다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      scenes: [pendingScene(1, 'noir'), pendingScene(2, 'noir')],
      references: [
        { id: 44, type: 'style', name: 'noir', prompt: 'custom noir lighting' },
        { id: 7, type: 'character', prompt: 'hero' },
      ],
    })

    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('ref:44')
  })

  it("선택과 카드 기억이 없고 모든 대상 씬이 korean-ani이면 preset:korean-ani를 쓴다", () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      scenes: [pendingScene(1, 'korean-ani'), pendingScene(2, 'Korean Anime')],
      references: [{ id: 7, type: 'character', prompt: 'hero' }],
    })

    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('preset:korean-ani')
  })

  it('대상 씬 preset이 섞이면 파생하지 않고 기존 findAutoStyle fallback을 쓴다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      scenes: [pendingScene(1, 'korean-ani'), pendingScene(2, 'cinematic')],
      references: [{ id: 9, type: 'style', name: 'fallback', prompt: 'watercolor' }],
    })

    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('ref:9')
  })

  it('ref-match 씬과 같은 preset으로 해석되는 씬이 섞여도 effective style이 다르면 abstain한다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      scenes: [pendingScene(1, 'Korean Anime'), pendingScene(2, 'korean-ani')],
      references: [
        { id: 9, type: 'style', name: 'fallback', prompt: 'fallback style' },
        { id: 44, type: 'style', name: 'Korean Anime', prompt: 'custom korean animation' },
      ],
    })

    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('ref:9')
  })

  it('pending 부분집합만 같아도 전체 씬의 effective style이 혼합이면 파생하지 않는다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      scenes: [
        pendingScene(1, 'korean-ani'),
        { id: 2, prompt: 'done scene', style_tag: 'cinematic', image: 'done.png', status: 'done' },
      ],
      references: [{ id: 9, type: 'style', name: 'fallback', prompt: 'fallback style' }],
    })

    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('ref:9')
  })

  it('selectedStyleRefId가 있으면 씬 파생보다 우선한다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: 'preset:cinematic',
      scenes: [pendingScene(1, 'korean-ani'), pendingScene(2, 'korean-ani')],
      references: [],
    })

    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('preset:cinematic')
  })

  it('카드의 styleId:null 기억은 씬 파생보다 우선한다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      scenes: [pendingScene(1, 'korean-ani'), pendingScene(2, 'korean-ani')],
      references: [{
        id: 7,
        type: 'character',
        prompt: 'hero',
        styleId: null,
        generatedAt: 100,
      }],
    })

    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBeNull()
  })
})

// 새로 추가한 카드는 styleId 기억이 없다. 마지막 폴백이 findAutoStyle(references 의 "첫 번째"
// 스타일 카드)이면, 스타일 카드를 추가하거나 순서가 바뀌는 것만으로 새 카드가 조용히 다른
// 스타일로 생성된다. 사용자가 의도적으로 다른 걸 고르지 않는 한, 프로젝트가 이미 쓰던 스타일을
// 물려받아야 한다 — 그 기억은 다른 카드들의 styleId 에 남아 있다.
describe('createStyleResolver — 새 카드는 프로젝트가 쓰던 스타일을 물려받는다', () => {
  const styleA = { id: 1, type: 'style', name: 'A', prompt: 'watercolor' }
  const styleB = { id: 9, type: 'style', name: 'B', prompt: 'oil' }
  const card = (over) => ({ id: 2, type: 'character', prompt: 'hero', ...over })

  it('전역 선택이 없으면 기존 카드의 styleId 를 따른다 (findAutoStyle 이 아니라)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      // findAutoStyle 은 배열 첫 스타일 카드인 ref:1 을 집는다 — 카드들은 ref:9 를 썼다.
      references: [styleA, styleB, card({ styleId: 'ref:9', generatedAt: 100 })],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:9')
  })

  it('가장 최근에 생성된 카드의 기억을 따른다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      references: [
        styleA, styleB,
        card({ id: 2, styleId: 'ref:1', generatedAt: 100 }),
        card({ id: 3, styleId: 'ref:9', generatedAt: 200 }),
      ],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:9')
  })

  it("styleId:null('무스타일로 생성됨')도 정당한 기억 — 자동 폴백으로 새지 않는다", () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      references: [styleA, card({ styleId: null, generatedAt: 100 })],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBeNull()
  })

  it('전역 선택(사용자의 명시적 의사)이 카드 기억보다 우선한다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: 'ref:1',
      references: [styleA, styleB, card({ styleId: 'ref:9', generatedAt: 100 })],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:1')
  })

  it('override 는 그 무엇보다 우선한다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: 'ref:1',
      references: [styleA, styleB, card({ styleId: 'ref:9' })],
    })
    expect(r.resolveEffectiveStyleIdForRef('preset:noir')).toBe('preset:noir')
  })

  // 상세 모달의 prop 동기화 effect 는 styleId:undefined 로 키를 만든다. 그 카드를 저장하면
  // own-property 는 있지만 값은 undefined 다 — 이걸 '무스타일로 생성됨'(null)으로 오해하면
  // 다음 새 카드가 스타일을 잃는다.
  it('styleId:undefined 는 기억이 아니다 (키만 있고 값이 없다)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      references: [styleA, styleB,
        card({ id: 2, styleId: undefined, generatedAt: 300 }),   // 모달에서 저장된 레거시 카드
        card({ id: 3, styleId: 'ref:9', generatedAt: 100 }),
      ],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:9')
  })

  it('기억하는 카드가 하나도 없으면 기존대로 findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      references: [styleA, card({})], // styleId 키 자체가 없음
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:1')
  })

  it('스타일 카드 자신의 styleId(null)를 기억으로 오해하지 않는다', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      // 스타일 카드는 배치에서 styleId:null 을 찍힌다 — 이걸 물려받으면 모두 무스타일이 된다.
      references: [{ ...styleA, styleId: null, generatedAt: 300 }, card({ styleId: 'ref:1', generatedAt: 100 })],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:1')
  })
})
