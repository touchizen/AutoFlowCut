/**
 * guards.js 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing guards
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn(),
  }
}))

vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  }
}))

import { checkFolderPermission, checkAuthToken } from '../../src/utils/guards'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { toast } from '../../src/components/Toast'

const t = vi.fn((key) => key) // translation mock that returns key
const openSettings = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// checkFolderPermission
// ============================================================
describe('checkFolderPermission', () => {
  it('returns ok:true if saveMode is not folder', async () => {
    const settings = { saveMode: 'none' }
    const result = await checkFolderPermission(settings, openSettings, t)
    expect(result).toEqual({ ok: true })
    expect(fileSystemAPI.ensurePermission).not.toHaveBeenCalled()
  })

  it('returns ok:true when folder permission is valid', async () => {
    const settings = { saveMode: 'folder' }
    fileSystemAPI.ensurePermission.mockResolvedValue({})
    const result = await checkFolderPermission(settings, openSettings, t)
    expect(result).toEqual({ ok: true })
  })

  it('returns ok:false and opens settings when folder_deleted', async () => {
    const settings = { saveMode: 'folder' }
    fileSystemAPI.ensurePermission.mockResolvedValue({ error: 'folder_deleted' })
    const result = await checkFolderPermission(settings, openSettings, t)
    expect(result).toEqual({ ok: false })
    expect(toast.error).toHaveBeenCalledWith('toast.folderDeleted')
    expect(openSettings).toHaveBeenCalledWith('storage')
  })

  it('returns ok:false and opens settings when not_set', async () => {
    const settings = { saveMode: 'folder' }
    fileSystemAPI.ensurePermission.mockResolvedValue({ error: 'not_set' })
    const result = await checkFolderPermission(settings, openSettings, t)
    expect(result).toEqual({ ok: false })
    expect(toast.warning).toHaveBeenCalledWith('toast.folderSelectFirst')
    expect(openSettings).toHaveBeenCalledWith('storage')
  })
})

// ============================================================
// checkAuthToken
// ============================================================
describe('checkAuthToken', () => {
  it('returns true when token is available', async () => {
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue('some-token'),
      clearTokenCache: vi.fn(),
    }
    const result = await checkAuthToken(genAPI, t)
    expect(result).toBe(true)
    expect(genAPI.getAccessToken).toHaveBeenCalledWith(true, false, 'google')
  })

  it('returns false and dispatches login-expired event when no token', async () => {
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue(null),
      clearTokenCache: vi.fn(),
    }
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const result = await checkAuthToken(genAPI, t)
    expect(result).toBe(false)
    expect(genAPI.clearTokenCache).toHaveBeenCalled()
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'flow-login-expired' }))
    dispatchSpy.mockRestore()
  })

  it('providerId 를 getAccessToken 으로 관통 (§5.7 openai-only 게이트)', async () => {
    const genAPI = { getAccessToken: vi.fn().mockResolvedValue('byok'), clearTokenCache: vi.fn() }
    await checkAuthToken(genAPI, t, 'openai')
    expect(genAPI.getAccessToken).toHaveBeenCalledWith(true, false, 'openai')
  })
})
