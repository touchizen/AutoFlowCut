import { describe, it, expect } from 'vitest'
import { detectOS, ytDlpInstallCommand } from '../../src/utils/ytdlpInstall.js'

describe('detectOS', () => {
  it('detects mac from platform/userAgent', () => {
    expect(detectOS({ platform: 'MacIntel', userAgent: '' })).toBe('mac')
    expect(detectOS({ platform: '', userAgent: 'Mozilla (Macintosh; Intel Mac OS X)' })).toBe('mac')
  })
  it('detects windows', () => {
    expect(detectOS({ platform: 'Win32', userAgent: '' })).toBe('windows')
    expect(detectOS({ platform: '', userAgent: 'Mozilla (Windows NT 10.0)' })).toBe('windows')
  })
  it('falls back to other (linux etc.)', () => {
    expect(detectOS({ platform: 'Linux x86_64', userAgent: 'X11; Linux' })).toBe('other')
    expect(detectOS({ platform: '', userAgent: '' })).toBe('other')
  })
})

describe('ytDlpInstallCommand', () => {
  it('maps OS → install command (ms-store/win = winget)', () => {
    expect(ytDlpInstallCommand('mac')).toBe('brew install yt-dlp')
    expect(ytDlpInstallCommand('windows')).toBe('winget install yt-dlp')
    expect(ytDlpInstallCommand('other')).toBe('pip install -U yt-dlp')
    expect(ytDlpInstallCommand('unknown')).toBe('pip install -U yt-dlp') // 안전 폴백
  })
})
