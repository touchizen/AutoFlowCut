/**
 * useAppSettings — project aspect ratio default & persistence
 *
 * aspectRatio ('16:9' longform / '9:16' shortform) is a project setting. It was
 * once stripped on load (`delete parsed.aspectRatio`); it must now default to
 * 16:9 for fresh installs and survive a localStorage round-trip.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppSettings } from '../../src/hooks/useAppSettings'
import { DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID } from '../../src/config/genModels'

const STORAGE_KEY = 'autoflowcut_settings'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAppSettings — aspectRatio', () => {
  it('defaults aspectRatio to 16:9 on a fresh install', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.aspectRatio).toBe('16:9')
  })

  it('preserves a persisted aspectRatio (no longer stripped on load)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ aspectRatio: '9:16' }))

    const { result } = renderHook(() => useAppSettings())

    expect(result.current.settings.aspectRatio).toBe('9:16')
  })

  it('falls back to the 16:9 default when persisted settings omit aspectRatio', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectName: 'ep1' }))

    const { result } = renderHook(() => useAppSettings())

    expect(result.current.settings.aspectRatio).toBe('16:9')
    expect(result.current.settings.projectName).toBe('ep1')
  })
})

describe('useAppSettings — saveMode (Flow/none 모드 폐기, folder 필수)', () => {
  it('저장된 옛 Flow 모드(saveMode "none")는 로드 시 "folder" 로 강제', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ saveMode: 'none' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.saveMode).toBe('folder')
  })

  it('기본 saveMode 는 folder', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.saveMode).toBe('folder')
  })

  it('folder 는 그대로 유지', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ saveMode: 'folder' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.saveMode).toBe('folder')
  })
})

describe('useAppSettings — 모델 id 보존 (동적 /models 모델 지원)', () => {
  // /models 에서 온 동적 모델(정적 카탈로그에 없음)을 선택·저장해도 reload 시 보존돼야 한다.
  // 예전엔 loadSettings 가 coerce 로 정적 기본값으로 되돌려 동적 선택이 사라졌다(리뷰 P2).
  // 실제 사용 가능 여부는 /models 로드 후 selector 가 조정.
  it('정적 카탈로그에 없는 imageModel(동적) 도 보존', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ imageModel: 'gemini-9-flash-image' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.imageModel).toBe('gemini-9-flash-image')
  })

  it('정적 카탈로그에 없는 video 모델(veo-2/veo-3.0 등) 도 보존', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      videoModelT2V: 'veo-2.0-generate-001',
      videoModelF2V: 'veo-3.0-generate-preview',
    }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.videoModelT2V).toBe('veo-2.0-generate-001')
    expect(result.current.settings.videoModelF2V).toBe('veo-3.0-generate-preview')
  })

  it('카탈로그에 있는 모델도 그대로 보존', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ imageModel: 'gemini-3-pro-image' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.imageModel).toBe('gemini-3-pro-image')
  })

  it('fresh install 기본값은 catalog 기본 모델', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.imageModel).toBe(DEFAULT_IMAGE_MODEL_ID)
    expect(result.current.settings.videoModelT2V).toBe(DEFAULT_VIDEO_MODEL_ID)
    expect(result.current.settings.videoModelF2V).toBe(DEFAULT_VIDEO_MODEL_ID)
  })
})

describe('useAppSettings — agentPanelMode', () => {
  it('fresh install 기본값은 floating', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('floating')
  })

  it('저장된 docked 선호를 그대로 보존한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentPanelMode: 'docked' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('docked')
  })

  it('저장된 legacy slide 선호를 docked로 마이그레이션한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentPanelMode: 'slide' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('docked')
  })

  it('알 수 없는 저장값만 floating으로 정규화한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentPanelMode: 'drawer' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('floating')
  })
})

describe('useAppSettings — agentDockWidth', () => {
  it('fresh install 기본값은 400px이다', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentDockWidth).toBe(400)
  })

  it('저장된 유효 폭 500px을 보존한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentDockWidth: 500 }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentDockWidth).toBe(500)
  })

  it.each([
    ['문자열', 'garbage', 400],
    ['NaN', Number.NaN, 400],
    ['최소 미만', 120, 280],
    ['최대 초과', 900, 720],
  ])('저장된 %s 폭을 로드 시 정규화한다', (_label, stored, expected) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentDockWidth: stored }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentDockWidth).toBe(expected)
  })
})

describe('useAppSettings — videoConcurrency', () => {
  it('fresh install 기본값은 videoConcurrency 4', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.videoConcurrency).toBe(4)
  })

  it('저장된 videoConcurrency 값 보존', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ videoConcurrency: 4 }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.videoConcurrency).toBe(4)
  })
})

describe('useAppSettings — live projectName', () => {
  it('빈 프로젝트에서 ensureProjectName을 연속 호출해도 같은 이름을 반환한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectName: '' }))
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
    const { result } = renderHook(() => useAppSettings())

    let first
    let second
    act(() => {
      first = result.current.ensureProjectName()
      second = result.current.ensureProjectName()
    })

    expect(first).toBe('autoflowcut_1000')
    expect(second).toBe(first)
  })

  it('stable ensureProjectName과 projectNameRef가 프로젝트명 변경을 즉시 반영한다', () => {
    const { result } = renderHook(() => useAppSettings())
    const initialEnsureProjectName = result.current.ensureProjectName

    act(() => {
      result.current.updateSetting('projectName', 'Project Q')
    })

    expect(result.current.ensureProjectName).toBe(initialEnsureProjectName)
    expect(result.current.projectNameRef.current).toBe('Project Q')
    expect(initialEnsureProjectName()).toBe('Project Q')
  })
})
