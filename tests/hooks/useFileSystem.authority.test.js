import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fileSystemAPI } from '../../src/hooks/useFileSystem.js'

describe('fileSystemAPI main work-folder authority', () => {
  beforeEach(() => {
    localStorage.clear()
    window.electronAPI = {
      checkFolderExists: vi.fn(async () => ({ exists: true })),
      saveWorkFolder: vi.fn(async () => ({ success: false, error: 'unconfirmed-work-folder' })),
    }
  })

  it('localStorage-only legacy 경로는 main 확인 실패를 무시하지 않고 재선택을 요구한다', async () => {
    localStorage.setItem('workFolderPath', '/legacy/work-folder')
    localStorage.setItem('workFolderName', 'legacy')

    const result = await fileSystemAPI.ensurePermission()

    expect(window.electronAPI.saveWorkFolder).toHaveBeenCalledWith({
      workFolderPath: '/legacy/work-folder',
      workFolderName: 'legacy',
    })
    expect(result).toEqual({
      success: false,
      error: 'not_set',
      hasPermission: false,
      name: 'legacy',
    })
  })

  it('native 재선택을 취소하면 기존 localStorage를 undefined 경로로 덮지 않는다', async () => {
    localStorage.setItem('workFolderPath', '/legacy/work-folder')
    window.electronAPI.selectWorkFolder = vi.fn(async () => ({
      success: false,
      error: 'cancelled',
    }))

    const result = await fileSystemAPI.selectWorkFolder()

    expect(result).toEqual({ success: false, error: 'cancelled' })
    expect(localStorage.getItem('workFolderPath')).toBe('/legacy/work-folder')
  })
})
