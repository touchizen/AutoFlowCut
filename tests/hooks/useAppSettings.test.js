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

describe('useAppSettings — 전역 image provider (M1 §5.8)', () => {
  it('fresh install: generation.image.provider=google + modelsByProvider.google=기본모델', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.generation.image.provider).toBe('google')
    expect(result.current.settings.modelsByProvider.google).toBe(DEFAULT_IMAGE_MODEL_ID)
  })

  it('마이그레이션: flat imageModel 만 있던 기존 설정 → provider=google, 그 모델을 google 슬롯에 시드, imageModel 보존', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ imageModel: 'gemini-3-pro-image' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.generation.image.provider).toBe('google')
    expect(result.current.settings.modelsByProvider.google).toBe('gemini-3-pro-image')
    expect(result.current.settings.imageModel).toBe('gemini-3-pro-image') // 기존 consumer 하위호환
  })

  it('기존 nested 설정 보존(openai 선택 + 기억 모델)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      imageModel: 'gpt-image-1',
      generation: { image: { provider: 'openai' } },
      modelsByProvider: { google: 'gemini-3.1-flash-image', openai: 'gpt-image-1' },
    }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.generation.image.provider).toBe('openai')
    expect(result.current.settings.modelsByProvider.openai).toBe('gpt-image-1')
    expect(result.current.settings.modelsByProvider.google).toBe('gemini-3.1-flash-image')
  })

  it('부분 nested(generation.image 만, provider 누락) → provider=google 로 채움', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ generation: { image: {} } }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.generation.image.provider).toBe('google')
  })

  it('nested generation.image.model 이 있으면 imageModel/슬롯 정합 (provider/model desync 방지)', () => {
    // 스펙 shape: {provider:openai, model:gpt-image-1} 로드 시 imageModel 이 gemini 로 어긋나면 안 됨
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      generation: { image: { provider: 'openai', model: 'gpt-image-1' } },
    }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.imageModel).toBe('gpt-image-1')
    expect(result.current.settings.modelsByProvider.openai).toBe('gpt-image-1')
    // consume-once: 반영 후 nested model 은 제거돼 재로드 시 사용자 선택을 덮어쓰지 않는다
    expect(result.current.settings.generation.image.model).toBeUndefined()
  })

  it('nested model consume-once: 반영 후 저장된 imageModel 변경이 재로드에서 안 덮어써짐', () => {
    // 최초: nested model 로드 → imageModel=gpt-image-1, nested model 소비됨
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      generation: { image: { provider: 'openai', model: 'gpt-image-1' } },
    }))
    const first = renderHook(() => useAppSettings())
    expect(first.result.current.settings.generation.image.model).toBeUndefined()
    // 사용자가 이후 다른 모델을 저장한 상태를 시뮬레이션(nested model 없음, flat imageModel 이 진실)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      imageModel: 'some-other-model',
      generation: { image: { provider: 'openai' } },
      modelsByProvider: { openai: 'some-other-model' },
    }))
    const second = renderHook(() => useAppSettings())
    expect(second.result.current.settings.imageModel).toBe('some-other-model') // stale nested 가 안 덮음
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
