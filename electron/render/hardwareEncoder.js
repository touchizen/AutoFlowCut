import { execFile as nodeExecFile } from 'node:child_process'

const HARDWARE_ENCODERS = Object.freeze({
  darwin: ['h264_videotoolbox'],
  win32: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  // VAAPI needs device selection and filtergraph hardware-frame uploads.
  linux: ['h264_nvenc', 'h264_qsv'],
})

const detectionByFfmpegPath = new Map()

export function pickHardwareEncoder(platform, encodersOutput) {
  return availableHardwareEncoders(platform, encodersOutput)[0] || null
}

export function detectHardwareEncoder(ffmpegPath, options = {}) {
  if (!ffmpegPath) return Promise.resolve(null)
  if (detectionByFfmpegPath.has(ffmpegPath)) return detectionByFfmpegPath.get(ffmpegPath)

  const execFile = options.execFile || nodeExecFile
  const platform = options.platform || process.platform
  const detection = detectUsableHardwareEncoder(ffmpegPath, platform, execFile)
    .catch(() => null)

  detectionByFfmpegPath.set(ffmpegPath, detection)
  detection.then((encoder) => {
    if (encoder == null && detectionByFfmpegPath.get(ffmpegPath) === detection) {
      detectionByFfmpegPath.delete(ffmpegPath)
    }
  })
  return detection
}

export function hardwareVideoCodecArgs(encoder, spec = {}) {
  const quality = hardwareQuality(spec.crf)
  switch (encoder) {
    case 'h264_videotoolbox':
      return [
        '-c:v', encoder, '-q:v', videoToolboxQuality(quality),
        '-pix_fmt', 'yuv420p',
      ]
    case 'h264_nvenc':
      return [
        '-c:v', encoder, '-preset', 'p5',
        '-rc', 'vbr', '-cq', quality, '-b:v', '0',
        '-pix_fmt', 'yuv420p',
      ]
    case 'h264_qsv':
      return [
        '-c:v', encoder, '-preset', String(spec.preset ?? 'medium'),
        '-global_quality', quality, '-pix_fmt', 'nv12',
      ]
    case 'h264_amf':
      return [
        '-c:v', encoder, '-quality', 'balanced', '-rc', 'cqp',
        '-qp_i', quality, '-qp_p', quality, '-qp_b', quality,
        '-pix_fmt', 'nv12',
      ]
    default:
      return null
  }
}

async function detectUsableHardwareEncoder(ffmpegPath, platform, execFile) {
  const listing = await runFfmpeg(execFile, ffmpegPath, ['-hide_banner', '-encoders'])
  if (!listing) return null

  const encoders = availableHardwareEncoders(
    platform,
    `${listing.stdout}\n${listing.stderr}`,
  )
  for (const encoder of encoders) {
    const codecArgs = hardwareVideoCodecArgs(encoder, { crf: 20, preset: 'medium' })
    const probe = await runFfmpeg(execFile, ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
      '-frames:v', '1',
      ...codecArgs,
      '-f', 'null', '-',
    ])
    if (probe) return encoder
  }
  return null
}

function runFfmpeg(execFile, ffmpegPath, args) {
  return new Promise((resolve) => {
    try {
      execFile(
        ffmpegPath,
        args,
        { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout = '', stderr = '') => {
          resolve(error ? null : { stdout, stderr })
        },
      )
    } catch {
      resolve(null)
    }
  })
}

function hardwareQuality(crf) {
  const number = Number(crf ?? 20)
  const quality = Number.isFinite(number) ? Math.round(number) : 20
  return String(Math.min(51, Math.max(0, quality)))
}

function videoToolboxQuality(crf) {
  const quality = 100 - (Number(crf) / 51) * 99
  return String(Math.min(100, Math.max(1, Math.round(quality))))
}

function availableHardwareEncoders(platform, encodersOutput) {
  const candidates = HARDWARE_ENCODERS[platform]
  if (!candidates) return []

  const output = String(encodersOutput || '')
  return candidates.filter(encoder => hasEncoder(output, encoder))
}

function hasEncoder(output, encoder) {
  const escaped = encoder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'm').test(output)
}
