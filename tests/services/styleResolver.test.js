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

  it('video-text tab: returns first style card via findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.autoEffectiveStyleId).toBe('ref:7')
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
      scenes: [{ id: 1, style_tag: 'noir' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoAvailable).toBe(true)
  })

  it('image/list: false when no pending scene matches', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: '' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoAvailable).toBe(false)
  })

  it('video-text: true when findAutoStyle finds a style card', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
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

  it('image/list with no matches: returns styleNone label', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: '' }],
    })
    expect(r.autoLabel).toBe('없음')
  })

  it('video-text: shows the resolved auto style ref name', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', mediaId: 'm-7' }],
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
      scenes: [{ id: 1, style_tag: '' }],
    })
    expect(r.autoCardMeta.icon).toBe('🚫')
    expect(r.autoCardMeta.label).toBe('자동 (매칭 없음)')
    expect(r.autoCardMeta.summary).toBeNull()
  })

  it('video-text: icon 🪄 + label is the auto style name + summary null', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', mediaId: 'm-7' }],
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
      references: [{ id: 7, type: 'style', name: 'My Noir', mediaId: 'm-7' }],
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

  it('null override (video-text): returns findAutoStyle result', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      selectedStyleRefId: 'preset:noir',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.resolveEffectiveStyleId(null)).toBe('ref:7')
  })

  it('explicit ref:* override: returns it as-is', () => {
    const r = createStyleResolver({ ...baseDeps, selectedStyleRefId: 'preset:noir' })
    expect(r.resolveEffectiveStyleId('ref:99')).toBe('ref:99')
  })
})

describe('createStyleResolver — resolveEffectiveStyleIdForRef (reference generation domain)', () => {
  it('priority: override → selectedStyleRefId → findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: 'preset:noir',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('preset:noir')
    expect(r.resolveEffectiveStyleIdForRef('ref:99')).toBe('ref:99')
  })

  it('null override falls through to selected then findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:7')
  })
})
