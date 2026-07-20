import { describe, expect, it, vi } from 'vitest'
import {
  detectHardwareEncoder,
  pickHardwareEncoder,
} from '../../../electron/render/hardwareEncoder.js'

const encoders = (...names) => [
  'Encoders:',
  ' V..... = Video',
  ...names.map(name => ` V....D ${name.padEnd(24)} test encoder`),
].join('\n')

describe('pickHardwareEncoder', () => {
  it('picks VideoToolbox on macOS', () => {
    expect(pickHardwareEncoder('darwin', encoders('h264_nvenc', 'h264_videotoolbox')))
      .toBe('h264_videotoolbox')
  })

  it('uses Windows candidate priority instead of encoder output order', () => {
    expect(pickHardwareEncoder('win32', encoders('h264_amf', 'h264_qsv', 'h264_nvenc')))
      .toBe('h264_nvenc')
  })

  it('falls through the Windows candidates in order', () => {
    expect(pickHardwareEncoder('win32', encoders('h264_amf', 'h264_qsv')))
      .toBe('h264_qsv')
    expect(pickHardwareEncoder('win32', encoders('h264_amf')))
      .toBe('h264_amf')
  })

  it('uses NVENC then QSV on Linux and excludes VAAPI', () => {
    expect(pickHardwareEncoder('linux', encoders('h264_qsv', 'h264_vaapi', 'h264_nvenc')))
      .toBe('h264_nvenc')
    expect(pickHardwareEncoder('linux', encoders('h264_vaapi', 'h264_qsv')))
      .toBe('h264_qsv')
    expect(pickHardwareEncoder('linux', encoders('h264_vaapi'))).toBeNull()
  })

  it('returns null when no candidate is available', () => {
    expect(pickHardwareEncoder('darwin', encoders('libx264'))).toBeNull()
    expect(pickHardwareEncoder('win32', '')).toBeNull()
  })

  it('returns null for an unknown platform', () => {
    expect(pickHardwareEncoder('freebsd', encoders('h264_nvenc'))).toBeNull()
  })

  it('matches complete encoder names only', () => {
    expect(pickHardwareEncoder('linux', encoders('h264_nvenc_extra'))).toBeNull()
  })
})

describe('detectHardwareEncoder', () => {
  it('runs ffmpeg encoders detection once and memoizes by ffmpeg path', async () => {
    const execFile = vi.fn((file, args, options, callback) => {
      callback(null, encoders('h264_nvenc'), '')
    })

    const first = detectHardwareEncoder('/vendor/ffmpeg-cache', { platform: 'linux', execFile })
    const second = detectHardwareEncoder('/vendor/ffmpeg-cache', { platform: 'linux', execFile })

    await expect(first).resolves.toBe('h264_nvenc')
    await expect(second).resolves.toBe('h264_nvenc')
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(execFile).toHaveBeenCalledWith(
      '/vendor/ffmpeg-cache',
      ['-hide_banner', '-encoders'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    )
  })

  it('treats an ffmpeg detection error as no hardware encoder', async () => {
    const execFile = vi.fn((file, args, options, callback) => {
      callback(new Error('ffmpeg failed'), encoders('h264_nvenc'), '')
    })

    await expect(detectHardwareEncoder('/vendor/ffmpeg-error', { platform: 'linux', execFile }))
      .resolves.toBeNull()
  })

  it('treats a synchronous exec error as no hardware encoder', async () => {
    const execFile = vi.fn(() => { throw new Error('cannot spawn') })

    await expect(detectHardwareEncoder('/vendor/ffmpeg-throw', { platform: 'linux', execFile }))
      .resolves.toBeNull()
  })
})
