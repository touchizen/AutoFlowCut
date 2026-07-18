import { describe, it, expect } from 'vitest'
import { resolveFfmpegPath } from '../../../electron/render/ffmpegPath.js'

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
