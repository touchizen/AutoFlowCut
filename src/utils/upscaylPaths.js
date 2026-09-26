import path from 'node:path'

const MAC_BINARY = 'Upscayl.app/Contents/Resources/bin/upscayl-bin'
const WINDOWS_BINARY = ['Upscayl', 'resources', 'bin', 'upscayl-bin.exe']

export function guessBinaryCandidates(platform, {
  home,
  localAppData,
  programFiles,
} = {}) {
  if (platform === 'darwin') {
    return [
      path.posix.join('/Applications', MAC_BINARY),
      ...(home ? [path.posix.join(home, 'Applications', MAC_BINARY)] : []),
    ]
  }

  if (platform === 'win32') {
    return [
      ...(localAppData
        ? [path.win32.join(localAppData, 'Programs', ...WINDOWS_BINARY)]
        : []),
      ...(programFiles
        ? [path.win32.join(programFiles, ...WINDOWS_BINARY)]
        : []),
    ]
  }

  if (platform === 'linux') {
    return [
      '/opt/Upscayl/resources/bin/upscayl-bin',
      '/usr/lib/upscayl/resources/bin/upscayl-bin',
    ]
  }

  return []
}

export function modelsDirFor(binPath) {
  const pathImpl = String(binPath).includes('\\') ? path.win32 : path.posix
  return pathImpl.resolve(pathImpl.dirname(binPath), '..', 'models')
}

export function parseModelPairs(fileNames = []) {
  const params = new Set()
  const bins = new Set()

  for (const fileName of fileNames) {
    if (typeof fileName !== 'string') continue
    if (fileName.endsWith('.param') && fileName.length > '.param'.length) {
      params.add(fileName.slice(0, -'.param'.length))
    } else if (fileName.endsWith('.bin') && fileName.length > '.bin'.length) {
      bins.add(fileName.slice(0, -'.bin'.length))
    }
  }

  return [...params].filter((name) => bins.has(name)).sort()
}

export function parseScaledLine(stderr) {
  const match = String(stderr || '').match(/Scaled image from \d+x\d+ to (\d+)x(\d+)/)
  if (!match) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

export function pngDimsFromBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (pngSignature.some((byte, index) => buf[index] !== byte)) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null

  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}
