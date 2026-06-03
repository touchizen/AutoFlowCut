/**
 * useAppSettings — project aspect ratio default & persistence
 *
 * aspectRatio ('16:9' longform / '9:16' shortform) is a project setting. It was
 * once stripped on load (`delete parsed.aspectRatio`); it must now default to
 * 16:9 for fresh installs and survive a localStorage round-trip.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppSettings } from '../../src/hooks/useAppSettings'
import { DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID } from '../../src/config/genModels'

const STORAGE_KEY = 'autoflowcut_settings'

beforeEach(() => {
  localStorage.clear()
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

describe('useAppSettings — 모델 id coerce (stale/preview 방어)', () => {
  // localStorage 에 카탈로그에 없는 모델 id(제거/preview 변종 등)가 남아 있으면 그대로
  // models/<id>:generateContent 로 나가 전 생성이 실패한다. 로드 시 카탈로그 기준으로
  // 강제 → 알 수 없는 id 는 기본 모델로 치유.
  it('카탈로그에 없는 imageModel 은 기본 이미지 모델로 강제', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ imageModel: 'gemini-3.0-flash-image-preview' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.imageModel).toBe(DEFAULT_IMAGE_MODEL_ID)
  })

  it('카탈로그에 있는 imageModel 은 그대로 유지', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ imageModel: 'gemini-3-pro-image' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.imageModel).toBe('gemini-3-pro-image')
  })

  it('카탈로그에 없는 videoModelT2V/F2V 는 기본 비디오 모델로 강제', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      videoModelT2V: 'veo_3_1_t2v_fast_ultra_relaxed', // 구 Flow underscore 키
      videoModelF2V: 'veo-9.9-nonexistent-preview',
    }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.videoModelT2V).toBe(DEFAULT_VIDEO_MODEL_ID)
    expect(result.current.settings.videoModelF2V).toBe(DEFAULT_VIDEO_MODEL_ID)
  })

  it('카탈로그에 있는 video 모델(Lite/Quality)은 그대로 유지', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      videoModelT2V: 'veo-3.1-lite-generate-preview',
      videoModelF2V: 'veo-3.1-generate-preview',
    }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.videoModelT2V).toBe('veo-3.1-lite-generate-preview')
    expect(result.current.settings.videoModelF2V).toBe('veo-3.1-generate-preview')
  })

  it('fresh install 기본값은 catalog 기본 모델', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.imageModel).toBe(DEFAULT_IMAGE_MODEL_ID)
    expect(result.current.settings.videoModelT2V).toBe(DEFAULT_VIDEO_MODEL_ID)
    expect(result.current.settings.videoModelF2V).toBe(DEFAULT_VIDEO_MODEL_ID)
  })
})
