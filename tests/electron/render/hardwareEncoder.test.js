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
  it('runs encoder listing and a matching one-frame probe once, then memoizes success', async () => {
    const execFile = vi.fn((file, args, options, callback) => {
      if (args.includes('-encoders')) callback(null, encoders('h264_nvenc'), '')
      else callback(null, '', '')
    })

    const first = detectHardwareEncoder('/vendor/ffmpeg-cache', { platform: 'linux', execFile })
    const second = detectHardwareEncoder('/vendor/ffmpeg-cache', { platform: 'linux', execFile })

    await expect(first).resolves.toBe('h264_nvenc')
    await expect(second).resolves.toBe('h264_nvenc')
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      '/vendor/ffmpeg-cache',
      ['-hide_banner', '-encoders'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    )
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      '/vendor/ffmpeg-cache',
      [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
        '-frames:v', '1',
        '-c:v', 'h264_nvenc', '-preset', 'p5',
        '-rc', 'vbr', '-cq', '20', '-b:v', '0',
        '-pix_fmt', 'yuv420p',
        '-f', 'null', '-',
      ],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    )
  })

  it('does not retain a negative cache entry after an encoder-listing error', async () => {
    const execFile = vi.fn((file, args, options, callback) => {
      callback(new Error('ffmpeg failed'), encoders('h264_nvenc'), '')
    })

    await expect(detectHardwareEncoder('/vendor/ffmpeg-error', { platform: 'linux', execFile }))
      .resolves.toBeNull()
    await expect(detectHardwareEncoder('/vendor/ffmpeg-error', { platform: 'linux', execFile }))
      .resolves.toBeNull()
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('rejects VideoToolbox when its real q:v probe cannot initialize', async () => {
    const execFile = vi.fn((file, args, options, callback) => {
      if (args.includes('-encoders')) {
        callback(null, encoders('h264_videotoolbox'), '')
        return
      }
      callback(new Error('EINVAL: QSCALE unsupported'), '', 'Error while opening encoder')
    })

    await expect(detectHardwareEncoder('/vendor/ffmpeg-intel-vt', {
      platform: 'darwin',
      execFile,
    })).resolves.toBeNull()
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(execFile.mock.calls[1][1]).toEqual(expect.arrayContaining([
      '-c:v', 'h264_videotoolbox', '-q:v', '61', '-pix_fmt', 'yuv420p',
    ]))
  })

  it('retries detection after a transient probe failure', async () => {
    let probeCount = 0
    const execFile = vi.fn((file, args, options, callback) => {
      if (args.includes('-encoders')) {
        callback(null, encoders('h264_qsv'), '')
        return
      }
      probeCount += 1
      if (probeCount === 1) callback(new Error('device busy'), '', '')
      else callback(null, '', '')
    })

    await expect(detectHardwareEncoder('/vendor/ffmpeg-probe-retry', {
      platform: 'linux',
      execFile,
    })).resolves.toBeNull()
    await expect(detectHardwareEncoder('/vendor/ffmpeg-probe-retry', {
      platform: 'linux',
      execFile,
    })).resolves.toBe('h264_qsv')
    expect(execFile).toHaveBeenCalledTimes(4)
  })

  it('probes Windows candidates in priority order until one opens', async () => {
    const probed = []
    const execFile = vi.fn((file, args, options, callback) => {
      if (args.includes('-encoders')) {
        callback(null, encoders('h264_amf', 'h264_qsv', 'h264_nvenc'), '')
        return
      }
      const encoder = args[args.indexOf('-c:v') + 1]
      probed.push(encoder)
      if (encoder === 'h264_nvenc') callback(new Error('no NVIDIA device'), '', '')
      else callback(null, '', '')
    })

    await expect(detectHardwareEncoder('/vendor/ffmpeg-win-fallback', {
      platform: 'win32',
      execFile,
    })).resolves.toBe('h264_qsv')
    expect(probed).toEqual(['h264_nvenc', 'h264_qsv'])
    expect(execFile).toHaveBeenCalledTimes(3)
  })

  it('treats a synchronous exec error as no hardware encoder', async () => {
    const execFile = vi.fn(() => { throw new Error('cannot spawn') })

    await expect(detectHardwareEncoder('/vendor/ffmpeg-throw', { platform: 'linux', execFile }))
      .resolves.toBeNull()
  })
})
