/**
 * useExport — 씬 사이 간격 흡수 배선 (스펙 v10 §4.1·§4.2·§4.5 / §7.2·§7.4)
 *
 * buildExportProject 는 훅 내부 함수라 직접 못 본다 → exporter 를 mock 하고
 * `exportCapcut` 이 받은 project 를 단언한다. 훅은 renderHook 으로 실제로 돌린다.
 * 기대값은 전부 리터럴로 박는다 (새 코드를 두 번 돌려 비교하면 공허하게 통과).
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
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() })
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

// export 가능해야 한다 — status done + 미디어 존재.
const scene = (id, startTime, endTime, extra = {}) => ({
  id,
  status: 'done',
  image: 'data:image/png;base64,xxx',
  startTime,
  endTime,
  duration: endTime - startTime,
  ...extra
})

function run(scenes, extra = {}) {
  return renderHook(() =>
    useExport({
      settings,
      scenes,
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

async function exportedProject(scenes, extra = {}) {
  const { result } = run(scenes, extra)
  await act(async () => { await result.current.handleExportConfirm(confirmArgs) })
  return mockExportCapcut.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExportCapcut.mockResolvedValue({ success: true, targetPath: '/tmp/out' })
  mockExportPremiere.mockResolvedValue({ success: true, targetPath: '/tmp/out' })
  mockExportVrew.mockResolvedValue({ success: true, targetPath: '/tmp/p.vrew' })
  if (typeof window !== 'undefined') delete window.electronAPI
})

describe('useExport — image_duration 이 슬롯이다', () => {
  it('회귀 재현: 간격 픽스처 → 슬롯 배열 전체가 기대값과 일치', async () => {
    // 씬 A(0.1–5) / B(6–9) / C(10–15). 간격 1 s 씩 + 선두 0.1 s.
    // A 의 슬롯 = start_B - 0 = 6 (선두 0.1 흡수 + 간격 1).
    // 수정 전에는 [4.9, 3, 5] 라 합계가 12.9 (실제 콘텐츠 끝 15 보다 2.1 부족).
    const project = await exportedProject([
      scene('A', 0.1, 5), scene('B', 6, 9), scene('C', 10, 15)
    ])

    expect(project.scenes.map(s => s.image_duration)).toEqual([6, 4, 5])
    // 불변식: 슬롯 합계 === 마지막 endTime
    expect(project.scenes.reduce((a, s) => a + s.image_duration, 0)).toBe(15)
  })

  it('no-op 회귀: 간격 없고 start_0 = 0 이면 산출물이 현행과 동일', async () => {
    const project = await exportedProject([
      scene('A', 0, 5), scene('B', 5, 9), scene('C', 9, 15)
    ])

    expect(project.scenes.map(s => s.image_duration)).toEqual([5, 4, 6])
  })

  it('재배열 픽스처 → 전체 폴백, 100 초 슬롯이 안 나온다', async () => {
    const project = await exportedProject([
      scene('A', 0, 5), scene('C', 100, 105), scene('B', 5, 10)
    ])

    expect(project.scenes.map(s => s.image_duration)).toEqual([5, 5, 5])
  })

  it('폴백 시 console.warn 이 reason 을 실어 호출된다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await exportedProject([scene('A', 0, 10), scene('B', 5, 8)])

    const msgs = warn.mock.calls.map(c => c.join(' '))
    expect(msgs.some(m => m.includes('overlap'))).toBe(true)
    warn.mockRestore()
  })
})

describe('useExport — source_duration / source_offset emit', () => {
  it('source_duration 은 씬 자기 길이다 (슬롯 ≠ source 픽스처)', async () => {
    const project = await exportedProject([
      scene('A', 0.1, 5), scene('B', 6, 9), scene('C', 10, 15)
    ])

    expect(project.scenes.map(s => s.source_duration)).toEqual([4.9, 3, 5])
  })

  it('source_offset 은 첫 씬만 start_0, 나머지는 0', async () => {
    const project = await exportedProject([
      scene('A', 0.1, 5), scene('B', 6, 9), scene('C', 10, 15)
    ])

    expect(project.scenes.map(s => s.source_offset)).toEqual([0.1, 0, 0])
  })

  it('폴백 프로젝트에는 두 필드가 아예 없다', async () => {
    // 각 씬 span 은 유효하고 프로젝트만 폴백되는 모양(겹침) — 시각 없는 픽스처는
    // finite 검사가 대신 막아 게이트 뮤테이션을 못 죽인다.
    const project = await exportedProject([scene('A', 0, 10), scene('B', 5, 8)])

    for (const s of project.scenes) {
      expect(s).not.toHaveProperty('source_duration')
      expect(s).not.toHaveProperty('source_offset')
    }
  })
})

describe('useExport — 영상 길이 폴백 체인', () => {
  const t2v = { id: 'A', videoPath: '/v.mp4', status: 'done', prompt: '' }

  it('슬롯 프로젝트 + 자체 길이 없는 영상 → source_duration 을 받는다', async () => {
    const project = await exportedProject(
      [scene('A', 0.1, 5, { videoT2V: '/v.mp4' }), scene('B', 6, 9), scene('C', 10, 15)],
      { videoScenes: [t2v] }
    )

    const withVideo = project.scenes.find(s => s.videos.length > 0)
    expect(withVideo.videos[0].duration).toBe(4.9)
  })

  it('폴백 프로젝트 + 자체 길이 없는 영상 → 레거시 값(3)', async () => {
    const project = await exportedProject(
      [
        { ...scene('A', 0, 10, { videoT2V: '/v.mp4' }), duration: 3 },
        scene('B', 5, 8)
      ],
      { videoScenes: [t2v] }
    )

    const withVideo = project.scenes.find(s => s.videos.length > 0)
    expect(withVideo.videos[0].duration).toBe(3)
  })
})

describe('useExport — 세 포맷이 같은 슬롯을 받는다', () => {
  const scenes = [scene('A', 0.1, 5), scene('B', 6, 9), scene('C', 10, 15)]

  it('프리미어', async () => {
    const { result } = run(scenes)
    await act(async () => { await result.current.handleExportPremiere(confirmArgs) })

    expect(mockExportPremiere.mock.calls[0][0].scenes.map(s => s.image_duration))
      .toEqual([6, 4, 5])
  })

  it('Vrew', async () => {
    const { result } = run(scenes)
    await act(async () => { await result.current.handleExportVrew(confirmArgs) })

    expect(mockExportVrew.mock.calls[0][0].scenes.map(s => s.image_duration))
      .toEqual([6, 4, 5])
  })
})

describe('useExport — 사이드카 SRT rebase 배선', () => {
  // 씬 A(0.1–5) / B(6–9) / C(10–15) + 링크된 자막 줄.
  // 픽스처 조건: start_0 ≠ 0, 비-마지막 간격 하나 이상.
  const srtTrack = [
    { id: 'l1', startTime: 0.1, endTime: 5, text: 'A' },
    { id: 'l2', startTime: 6, endTime: 9, text: 'B' },
    { id: 'l3', startTime: 10, endTime: 15, text: 'C' }
  ]
  const linked = [
    scene('A', 0.1, 5, { srtLineIds: ['l1'] }),
    scene('B', 6, 9, { srtLineIds: ['l2'] }),
    scene('C', 10, 15, { srtLineIds: ['l3'] })
  ]

  it('성공 경로: 사이드카가 원본 절대 시각과 동일하다 (뮤테이션 #25·#26)', async () => {
    // 호출부가 durationOf 를 안 넘기면 B/C 가 간격만큼 이르고,
    // initialCumulative 를 안 넘기면 A 가 0.1 s 이르다.
    const project = await exportedProject(linked, { srtTrack })

    expect(project.srtTrack.map(l => [l.id, l.startTime, l.endTime])).toEqual([
      ['l1', 0.1, 5],
      ['l2', 6, 9],
      ['l3', 10, 15]
    ])
  })

  it('폴백 경로: 사이드카가 현행 리터럴과 동일하다 (뮤테이션 #17)', async () => {
    // [C(100–105), A(0–5)] — 재배열 후 SRT 재임포트 모양. 게이트가 없으면
    // initialCumulative = 100 이 전달돼 사이드카가 100 초에서 시작한다.
    const fbTrack = [
      { id: 'c1', startTime: 100, endTime: 105, text: 'C' },
      { id: 'a1', startTime: 0, endTime: 5, text: 'A' }
    ]
    const fbScenes = [
      scene('C', 100, 105, { srtLineIds: ['c1'] }),
      scene('A', 0, 5, { srtLineIds: ['a1'] })
    ]

    const project = await exportedProject(fbScenes, { srtTrack: fbTrack })

    expect(project.srtTrack.map(l => [l.id, l.startTime, l.endTime])).toEqual([
      ['c1', 0, 5],
      ['a1', 5, 10]
    ])
  })
})
