import { describe, it, expect } from 'vitest'
import { resolveFfmpegPath, isRuntimePackaged } from '../../../electron/render/ffmpegPath.js'

describe('isRuntimePackaged', () => {
  it('dev(rename된 electron): app.isPackaged가 true로 오판돼도 VITE_DEV_SERVER_URL이 있으면 dev', () => {
    expect(isRuntimePackaged({ appIsPackaged: true, viteDevServerUrl: 'http://localhost:5173' })).toBe(false)
  })
  it('packaged: URL 없고 app.isPackaged true → packaged', () => {
    expect(isRuntimePackaged({ appIsPackaged: true, viteDevServerUrl: undefined })).toBe(true)
  })
  it('순수 electron dev: app.isPackaged false → dev', () => {
    expect(isRuntimePackaged({ appIsPackaged: false, viteDevServerUrl: 'http://localhost:5173' })).toBe(false)
    expect(isRuntimePackaged({ appIsPackaged: false, viteDevServerUrl: undefined })).toBe(false)
  })
})

describe('resolveFfmpegPath', () => {
  it('dev path from vendor', () => {
    expect(resolveFfmpegPath({ isPackaged: false, appRoot: '/app', platform: 'darwin', arch: 'arm64' }))
      .toBe('/app/vendor/ffmpeg/darwin-arm64/ffmpeg')
  })
  it('packaged path from resources', () => {
    expect(resolveFfmpegPath({ isPackaged: true, resourcesPath: '/res', platform: 'win32', arch: 'x64' }))
      .toBe('/res/ffmpeg/ffmpeg.exe')
  })
})
