import { execFile as nodeExecFile } from 'node:child_process'

const HARDWARE_ENCODERS = Object.freeze({
  darwin: ['h264_videotoolbox'],
  win32: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  // VAAPI needs device selection and filtergraph hardware-frame uploads.
  linux: ['h264_nvenc', 'h264_qsv'],
})

const detectionByFfmpegPath = new Map()

export function pickHardwareEncoder(platform, encodersOutput) {
  const candidates = HARDWARE_ENCODERS[platform]
  if (!candidates) return null

  const output = String(encodersOutput || '')
  return candidates.find(encoder => hasEncoder(output, encoder)) || null
}

export function detectHardwareEncoder(ffmpegPath, options = {}) {
  if (!ffmpegPath) return Promise.resolve(null)
  if (detectionByFfmpegPath.has(ffmpegPath)) return detectionByFfmpegPath.get(ffmpegPath)

  const execFile = options.execFile || nodeExecFile
  const platform = options.platform || process.platform
  const detection = new Promise((resolve) => {
    execFile(
      ffmpegPath,
      ['-hide_banner', '-encoders'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout = '', stderr = '') => {
        if (error) {
          resolve(null)
          return
        }
        try {
          resolve(pickHardwareEncoder(platform, `${stdout}\n${stderr}`))
        } catch {
          resolve(null)
        }
      },
    )
  }).catch(() => null)

  detectionByFfmpegPath.set(ffmpegPath, detection)
  return detection
}

function hasEncoder(output, encoder) {
  const escaped = encoder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'm').test(output)
}
