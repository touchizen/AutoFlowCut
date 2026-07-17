/**
 * useExport — story 오디오가 stale 이면 **사용자 언어로** 사유를 보여준다.
 *
 * main 의 readAudioPackage 는 stale/손상 manifest 를 errorKind 를 단 예외로 알린다. 그런데
 * ipcRenderer.invoke 는 message 만 직렬화해 errorKind 가 경계에서 소실되므로, IPC 핸들러가
 * { error: kind } 로 넘기고 renderer 가 그 kind 를 로케일 문구로 바꿔야 한다. 한 고리라도 끊기면
 * 한국어 UI에 `story audio is stale: audio step is "error"...` 같은 내부 영문이 그대로 뜬다.
 *
 * 다른 useExport 테스트 파일은 t 목이 키를 그대로 돌려줘(`t: (key) => key`) 번역을 관찰할 수
 * 없다. 여기서만 **실제 ko 로케일**로 t 를 만든다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import ko from '../../src/locales/ko.js'

vi.mock('../../src/exporters/capcut.js', () => ({ exportCapcut: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/exporters/premiere.js', () => ({ exportPremiere: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/exporters/vrew.js', () => ({ exportVrew: vi.fn(async () => ({ success: true })) }))

const mockToastError = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: (...a) => mockToastError(...a) },
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true }) },
  default: () => ({}),
}))

// 실제 ko 카탈로그를 따라가는 t — useI18n 의 계약(키 없으면 키 반환 + {param} 치환)과 같게.
const koT = (key, params) => {
  const raw = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ko)
  let s = raw || key
  if (params) for (const [k, v] of Object.entries(params)) s = String(s).replaceAll(`{${k}}`, v)
  return s
}
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k, p) => koT(k, p), lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (k, p) => koT(k, p), lang: 'ko', setLang: vi.fn() }),
}))

import { useExport } from '../../src/hooks/useExport'

const settings = { projectName: 'P', aspectRatio: '9:16', defaultDuration: 3 }
const scenes = [{ id: 'scene_1', prompt: 'p', imagePath: '/tmp/a.png', status: 'done' }]
const confirmArgs = { capcutProjectNumber: 1, scaleMode: 'fit', kenBurns: false, subtitleOption: 'none' }

const renderExport = () => renderHook(() => useExport({
  settings, scenes,
  openSettings: vi.fn(),
  isAuthenticated: true,
  subscription: { status: 'trial', canExport: true },
  refreshSubscription: vi.fn(),
  onLoginRequired: vi.fn(),
  onPaywallRequired: vi.fn(),
  storyProjectPath: '/tmp/proj',
}))

describe('useExport — stale story 오디오 사유는 사용자 언어로 뜬다', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('errorKind 를 ko 문구로 바꿔 토스트에 싣는다 — 내부 영문/raw 키 노출 금지', async () => {
    window.electronAPI = { storyLoadAudioPackage: vi.fn(async () => ({ error: 'story-audio-stale-manifest' })) }
    const { result } = renderExport()
    await act(async () => { await result.current.handleExportConfirm(confirmArgs) })

    expect(mockToastError).toHaveBeenCalledTimes(1)
    const msg = String(mockToastError.mock.calls[0][0])
    expect(msg).toContain(ko.errorSection.kind['story-audio-stale-manifest'])
    expect(msg).not.toContain('errorSection.kind') // 번역 실패 시 raw 키가 새면 안 된다
    expect(msg).not.toMatch(/audio step is|export blocked/) // 내부 영문 진단문
  })

  it('손상 manifest 도 같은 경로로 번역된다', async () => {
    window.electronAPI = { storyLoadAudioPackage: vi.fn(async () => ({ error: 'story-audio-manifest-corrupt' })) }
    const { result } = renderExport()
    await act(async () => { await result.current.handleExportConfirm(confirmArgs) })

    const msg = String(mockToastError.mock.calls[0][0])
    expect(msg).toContain(ko.errorSection.kind['story-audio-manifest-corrupt'])
    expect(msg).not.toContain('errorSection.kind')
  })
})
