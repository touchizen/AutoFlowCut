import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'
import en from '../../src/locales/en'
import { runSceneImportWithConfirmation } from '../../src/utils/importInspection'

function srtOf(count) {
  return Array.from({ length: count }, (_, index) => {
    const minutes = String(Math.floor(index / 60) % 60).padStart(2, '0')
    const seconds = String(index % 60).padStart(2, '0')
    return `${index + 1}\n00:${minutes}:${seconds},000 --> 00:${minutes}:${seconds},500\nSubtitle ${index + 1}`
  }).join('\n\n')
}

function t(key, params = {}) {
  const value = key.split('.').reduce((node, part) => node?.[part], en)
  return value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match)
}

describe('large import confirmation workflow', () => {
  it('shows the exact formatted subtitle and scene counts above the threshold', async () => {
    const confirm = vi.fn(() => false)
    const action = vi.fn()
    const requestConfirmation = (key, params) => confirm(t(key, params))

    const result = await runSceneImportWithConfirmation({
      type: 'srt',
      content: srtOf(1001),
      locale: 'en-US',
      requestConfirmation,
      action,
    })

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(
      'This file has 1,001 subtitles and will create 1,001 scenes',
    ))
    expect(result).toEqual({ didImport: false, count: 1001 })
    expect(action).not.toHaveBeenCalled()
  })

  it('leaves scenes, srtTrack, and the project write byte-identical on cancel', async () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromSRT(srtOf(2)) })
    const beforeScenes = JSON.stringify(result.current.scenes)
    const beforeTrack = JSON.stringify(result.current.srtTrack)
    const writeProject = vi.fn()

    await act(async () => {
      await runSceneImportWithConfirmation({
        type: 'srt',
        content: srtOf(1001),
        locale: 'en-US',
        requestConfirmation: () => false,
        action: () => {
          result.current.parseFromSRT(srtOf(1001))
          writeProject(JSON.stringify({
            scenes: result.current.scenes,
            srtTrack: result.current.srtTrack,
          }))
        },
      })
    })

    expect(JSON.stringify(result.current.scenes)).toBe(beforeScenes)
    expect(JSON.stringify(result.current.srtTrack)).toBe(beforeTrack)
    expect(writeProject).not.toHaveBeenCalled()
  })

  it('imports every subtitle and scene after confirmation', async () => {
    const { result } = renderHook(() => useScenes())

    await act(async () => {
      await runSceneImportWithConfirmation({
        type: 'srt',
        content: srtOf(1001),
        locale: 'en-US',
        requestConfirmation: () => true,
        action: () => result.current.parseFromSRT(srtOf(1001)),
      })
    })

    expect(result.current.scenes).toHaveLength(1001)
    expect(result.current.srtTrack).toHaveLength(1001)
  })

  it('imports below the threshold without opening confirmation', async () => {
    const { result } = renderHook(() => useScenes())
    const confirm = vi.fn()
    const requestConfirmation = (key, params) => confirm(t(key, params))

    await act(async () => {
      await runSceneImportWithConfirmation({
        type: 'srt',
        content: srtOf(999),
        locale: 'en-US',
        requestConfirmation,
        action: () => result.current.parseFromSRT(srtOf(999)),
      })
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(result.current.scenes).toHaveLength(999)
    expect(result.current.srtTrack).toHaveLength(999)
  })
})
