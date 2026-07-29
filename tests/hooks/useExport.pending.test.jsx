/**
 * useExport — pending 씬 포함/배제 (스펙 v9 §4.4 / §7.2)
 *
 * 관찰 지점: exporter 를 mock 하고 그것이 받은 project 를 단언한다.
 * 훅은 renderHook 으로 실제로 돌린다.
 *
 * ⚠️ 모든 픽스처는 유효한 startTime/endTime 을 싣는다. 안 그러면 computeSceneSlots
 * (버그 B)가 전체 legacy 폴백해서 **모든 테스트가 슬롯 경로를 안 타고** 돈다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockExportCapcut = vi.fn()
vi.mock('../../src/exporters/capcut.js', () => ({
  exportCapcut: (...args) => mockExportCapcut(...args)
}))
const mockExportPremiere = vi.fn()
vi.mock('../../src/exporters/premiere.js', () => ({
  exportPremiere: (...args) => mockExportPremiere(...args)
}))
const mockExportVrew = vi.fn()
vi.mock('../../src/exporters/vrew.js', () => ({
  exportVrew: (...args) => mockExportVrew(...args)
}))
const mockToastWarning = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: {
    warning: (...a) => mockToastWarning(...a),
    success: vi.fn(), info: vi.fn(), error: vi.fn()
  }
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() })
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true }) },
  default: () => ({})
}))

import { useExport } from '../../src/hooks/useExport'

const settings = { projectName: 'P', aspectRatio: '16:9', defaultDuration: 3 }
const confirmArgs = {
  capcutProjectNumber: 1, scaleMode: 'cover', kenBurns: false, kenBurnsMode: null,
  kenBurnsCycle: null, kenBurnsScaleMin: null, kenBurnsScaleMax: null,
  subtitleOption: 'none', subtitleFontSize: 36
}

const scene = (id, status, startTime, endTime, extra = {}) => ({
  id, status,
  image: 'data:image/png;base64,xxx',
  startTime, endTime, duration: endTime - startTime,
  ...extra
})
const done = (id, s, e, x) => scene(id, 'done', s, e, x)
const pend = (id, s, e, x) => scene(id, 'pending', s, e, x)

function run(scenes, extra = {}) {
  return renderHook(() =>
    useExport({
      settings, scenes,
      openSettings: vi.fn(),
      isAuthenticated: true,
      subscription: { status: 'active', canExport: true },
      refreshSubscription: vi.fn(),
      onLoginRequired: vi.fn(),
      onPaywallRequired: vi.fn(),
      ...extra
    })
  )
}

async function capcutProject(scenes, options = {}, extra = {}) {
  const { result } = run(scenes, extra)
  await act(async () => { await result.current.handleExportConfirm({ ...confirmArgs, ...options }) })
  return mockExportCapcut.mock.calls[0]?.[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExportCapcut.mockResolvedValue({ success: true, targetPath: '/tmp/out' })
  mockExportPremiere.mockResolvedValue({ success: true, targetPath: '/tmp/out' })
  mockExportVrew.mockResolvedValue({ success: true, targetPath: '/tmp/p.vrew' })
  if (typeof window !== 'undefined') delete window.electronAPI
})

describe('useExport — 회귀 재현 (사건 그대로)', () => {
  // done 1 + pending+이미지 518. 시각은 붙여서 슬롯 경로를 타게 한다.
  const scenes = [
    done('scene_1', 0, 5),
    ...Array.from({ length: 518 }, (_, i) => pend(`scene_${i + 2}`, 5 + i * 5, 10 + i * 5))
  ]

  it('includePending 미지정 → 1 개만 나간다 (현행 = 버그)', async () => {
    expect((await capcutProject(scenes)).scenes).toHaveLength(1)
  })

  it('includePending:true → 519 개 전부 나간다', async () => {
    expect((await capcutProject(scenes, { includePending: true })).scenes).toHaveLength(519)
  })
})

describe('useExport — 실행 경로별 옵션 수용', () => {
  const scenes = [done('d', 0, 5), pend('p', 5, 9)]

  it('CapCut', async () => {
    expect((await capcutProject(scenes, { includePending: true })).scenes.map(s => s.id))
      .toEqual(['d', 'p'])
  })

  it('프리미어', async () => {
    const { result } = run(scenes)
    await act(async () => {
      await result.current.handleExportPremiere({ ...confirmArgs, includePending: true })
    })
    expect(mockExportPremiere.mock.calls[0][0].scenes.map(s => s.id)).toEqual(['d', 'p'])
  })

  it('Vrew 는 옵션을 무시한다 — 항상 ready-only (스펙 §3.4)', async () => {
    const { result } = run(scenes)
    await act(async () => {
      await result.current.handleExportVrew({ ...confirmArgs, includePending: true })
    })
    expect(mockExportVrew.mock.calls[0][0].scenes.map(s => s.id)).toEqual(['d'])
  })
})

describe('useExport — 원본 순서 보존', () => {
  it('[pending A, done B] → [A, B] 로 나간다', async () => {
    const project = await capcutProject([pend('A', 0, 5), done('B', 5, 9)], { includePending: true })

    // ready.concat(pending) 이면 ['B','A'] 가 된다.
    expect(project.scenes.map(s => s.id)).toEqual(['A', 'B'])
  })
})

describe('useExport — 접근/경고', () => {
  it('handleExportClick 이 ready 0 / pending+이미지 1 에서 모달을 연다', () => {
    const { result } = run([pend('p', 0, 5)])

    act(() => { result.current.handleExportClick() })

    expect(result.current.showExportModal).toBe(true)
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  it('includePending:false + ready 0 → 실패 + 경고', async () => {
    const { result } = run([pend('p', 0, 5)])
    let res
    await act(async () => { res = await result.current.handleExportConfirm(confirmArgs) })

    expect(res).toEqual(expect.objectContaining({ success: false }))
    expect(mockToastWarning).toHaveBeenCalledWith('toast.noGeneratedImages')
    expect(mockExportCapcut).not.toHaveBeenCalled()
  })
})

describe('useExport — 슬롯(버그 B)과의 정합', () => {
  // [done A(0–5), pending B(6–9), done C(10–15)]
  const mixed = [done('A', 0, 5), pend('B', 6, 9), done('C', 10, 15)]

  it('배제하면 B 구간을 A 가 흡수한다 → image_duration [10, 5]', async () => {
    const project = await capcutProject(mixed)

    expect(project.scenes.map(s => s.id)).toEqual(['A', 'C'])
    expect(project.scenes.map(s => s.image_duration)).toEqual([10, 5])
  })

  it('포함하면 슬롯이 재계산된다 → image_duration [6, 4, 5]', async () => {
    const project = await capcutProject(mixed, { includePending: true })

    expect(project.scenes.map(s => s.image_duration)).toEqual([6, 4, 5])
    expect(project.scenes.map(s => s.source_offset)).toEqual([0, 0, 0])
  })

  it('선두 pending: source_offset 이 선택 집합 기준으로 바뀐다', async () => {
    // [pending A(6–9), done B(10–15)] — 첫 선택 씬의 startTime 이 offset 이 된다.
    const leading = [pend('A', 6, 9), done('B', 10, 15)]

    const excluded = await capcutProject(leading)
    expect(excluded.scenes.map(s => s.id)).toEqual(['B'])
    expect(excluded.scenes[0].source_offset).toBe(10)

    mockExportCapcut.mockClear()
    const included = await capcutProject(leading, { includePending: true })
    expect(included.scenes[0].source_offset).toBe(6)
  })

  it('포함이 legacy 폴백을 유발하지 않는다 (버그 B 무음 부활 방지)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await capcutProject(mixed, { includePending: true })

    const msgs = warn.mock.calls.map(c => c.join(' '))
    expect(msgs.some(m => m.includes('falling back to legacy durations'))).toBe(false)
    warn.mockRestore()
  })
})

describe('useExport — 사이드카 SRT', () => {
  it('포함하면 pending 씬의 자막 줄이 실제로 실린다', async () => {
    const srtTrack = [
      { id: 'l_a', startTime: 0, endTime: 5, text: 'A' },
      { id: 'l_b', startTime: 6, endTime: 9, text: 'B' },
    ]
    const scenes = [done('A', 0, 5, { srtLineIds: ['l_a'] }), pend('B', 6, 9, { srtLineIds: ['l_b'] })]

    const project = await capcutProject(scenes, { includePending: true }, { srtTrack })

    // preserveUnlinked 때문에 "줄 수가 1 이 아니다" 식 단언은 공허하다 — id 를 본다.
    expect(project.srtTrack.map(l => l.id)).toContain('l_b')
    expect(project.srtTrack.find(l => l.id === 'l_b')).toMatchObject({ startTime: 6, endTime: 9 })
  })
})
