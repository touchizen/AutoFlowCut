// @vitest-environment node

/**
 * capcutCloud — GCF 응답 검증 (validateCapcutResponse).
 * draftInfo/draftMetaInfo 가 없으면 JSON.stringify(undefined)="undefined" 가 조용히
 * 디스크에 쓰이는 것을 막는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const callableSpy = vi.fn()
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => (data) => callableSpy(data)),
}))
vi.mock('../../src/firebase/config', () => ({ APP_ID: 'autoflowcut' }))

const prepareSpy = vi.fn()
vi.mock('../../src/exporters/prepareCloudRequest', () => ({
  prepareCloudRequest: (...args) => prepareSpy(...args),
}))

import { exportCapcutPackageCloud } from '../../src/exporters/capcutCloud'

beforeEach(() => {
  vi.clearAllMocks()
  global.window = {
    electronAPI: {
      getVolumePath: vi.fn().mockResolvedValue({ success: true, volumePath: '' }),
      writeCapcutProject: vi.fn().mockResolvedValue({ success: true, targetPath: '/out' }),
    },
  }
  prepareSpy.mockResolvedValue({
    cloudRequest: { scenes: [{ id: 's1' }], mediaPathBase: 'media' },
    pathMap: {},
  })
})

describe('exportCapcutPackageCloud — GCF 응답 검증', () => {
  it('rejects when draftInfo/draftMetaInfo missing (no silent "undefined" write)', async () => {
    callableSpy.mockResolvedValue({ data: { totalDuration: 1, sceneCount: 1 } }) // draft* 없음

    await expect(
      exportCapcutPackageCloud({ name: 'P' }, { capcutProjectNumber: '/out' })
    ).rejects.toThrow(/invalid draftInfo\/draftMetaInfo/)
    expect(window.electronAPI.writeCapcutProject).not.toHaveBeenCalled()
  })

  it('rejects empty-string / primitive draft fields (would write broken draft files)', async () => {
    for (const bad of [
      { draftInfo: '', draftMetaInfo: '{"y":2}' },
      { draftInfo: 5, draftMetaInfo: '{"y":2}' },
      { draftInfo: '{"x":1}', draftMetaInfo: 'not-json' },
      // 파싱은 되지만 객체가 아닌 JSON — 거부해야 함.
      { draftInfo: 'null', draftMetaInfo: '{"y":2}' },
      { draftInfo: 'true', draftMetaInfo: '{"y":2}' },
      { draftInfo: '5', draftMetaInfo: '{"y":2}' },
      { draftInfo: '[]', draftMetaInfo: '{"y":2}' },
      { draftInfo: [1, 2], draftMetaInfo: '{"y":2}' },
    ]) {
      vi.clearAllMocks()
      prepareSpy.mockResolvedValue({ cloudRequest: { scenes: [{ id: 's1' }], mediaPathBase: 'media' }, pathMap: {} })
      callableSpy.mockResolvedValue({ data: bad })
      await expect(
        exportCapcutPackageCloud({ name: 'P' }, { capcutProjectNumber: '/out' })
      ).rejects.toThrow(/invalid draftInfo\/draftMetaInfo/)
      expect(window.electronAPI.writeCapcutProject).not.toHaveBeenCalled()
    }
  })

  it('accepts object draft fields (not only JSON strings)', async () => {
    callableSpy.mockResolvedValue({ data: { draftInfo: { x: 1 }, draftMetaInfo: { y: 2 } } })
    const result = await exportCapcutPackageCloud({ name: 'P' }, { capcutProjectNumber: '/out', subtitleOption: 'none' })
    expect(result).toMatchObject({ success: true })
  })

  it('writes the project when the response is well-formed', async () => {
    callableSpy.mockResolvedValue({
      data: { draftInfo: '{"x":1}', draftMetaInfo: '{"y":2}', totalDuration: 1, sceneCount: 1 },
    })

    const result = await exportCapcutPackageCloud({ name: 'P' }, { capcutProjectNumber: '/out', subtitleOption: 'none' })
    expect(result).toMatchObject({ success: true })
    expect(window.electronAPI.writeCapcutProject).toHaveBeenCalledTimes(1)
  })
})

describe('exportCapcutPackageCloud — SRT sidecar 쓰기 실패 (fail-fast)', () => {
  const okDraft = { draftInfo: '{"x":1}', draftMetaInfo: '{"y":2}', totalDuration: 1, sceneCount: 1 }
  const withSubs = { capcutProjectNumber: '/out', subtitleOption: 'ko', audioPackage: { srtContent: '1\n00:00:00,000 --> 00:00:01,000\nhi\n' } }

  it('throws when subtitle requested but workFolderPath is not set (no broken subtitle refs)', async () => {
    callableSpy.mockResolvedValue({ data: okDraft })
    global.localStorage = { getItem: vi.fn(() => null), clear: vi.fn() }

    await expect(
      exportCapcutPackageCloud({ name: 'P' }, withSubs)
    ).rejects.toThrow(/requires a work folder/)
    expect(window.electronAPI.writeCapcutProject).not.toHaveBeenCalled()
  })

  it('throws when writeSrtToWorkFolder returns {success:false}', async () => {
    callableSpy.mockResolvedValue({ data: okDraft })
    global.localStorage = { getItem: vi.fn(() => '/work'), clear: vi.fn() }
    window.electronAPI.writeSrtToWorkFolder = vi.fn().mockResolvedValue({ success: false, error: 'disk full' })

    await expect(
      exportCapcutPackageCloud({ name: 'P' }, withSubs)
    ).rejects.toThrow(/Failed to write subtitle file.*disk full/)
    expect(window.electronAPI.writeCapcutProject).not.toHaveBeenCalled()
  })

  it('writes the project when the SRT sidecar succeeds', async () => {
    callableSpy.mockResolvedValue({ data: okDraft })
    global.localStorage = { getItem: vi.fn(() => '/work'), clear: vi.fn() }
    window.electronAPI.writeSrtToWorkFolder = vi.fn().mockResolvedValue({ success: true, filePath: '/work/P/P_subtitle_ko.srt' })

    const result = await exportCapcutPackageCloud({ name: 'P' }, withSubs)
    expect(result).toMatchObject({ success: true })
    expect(window.electronAPI.writeCapcutProject).toHaveBeenCalledTimes(1)
  })
})
