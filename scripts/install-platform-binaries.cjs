// codex / claude-agent-sdk 의 네이티브 바이너리는 arch 별 패키지로 쪼개져 있고,
// npm 은 호스트에 맞는 것만 설치한다 (os/cpu 필드로 걸러짐). 그래서 Apple Silicon 에서
// --x64 --arm64 를 함께 구우면 x64 앱에 arm64 바이너리가 실리고, Intel 맥에서
// resolveCodexExecutablePath() 가 MODULE_NOT_FOUND 로 죽는다 (빌드는 성공으로 보인다).
//
// 이 스크립트가 빠진 arch 패키지를 --force 로 채워 넣고,
// afterPack 의 pruneForeignPlatformPackages() 가 앱마다 필요한 것만 남긴다.

const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { execFileSync } = require('child_process')
const { verifyBinaryArch } = require('./verifyBinaryArch.cjs')

const rootDir = path.resolve(__dirname, '..')

// codex 의 arch 패키지는 독립 패키지가 아니라 codex 자신의 버전 태그 별칭이다:
//   "@openai/codex-darwin-x64": "npm:@openai/codex@0.142.5-darwin-x64"
// (레지스트리에 @openai/codex-darwin-x64 라는 이름 자체는 없다 — 404)
function resolveSpecs({ platform, arch, versions }) {
  if (!versions.codex) throw new Error('codex version not resolved — is @openai/codex installed?')
  if (!versions.agentSdk) throw new Error('claude-agent-sdk version not resolved — is it installed?')

  const suffix = `${platform}-${arch}`
  return [
    {
      name: `@openai/codex-${suffix}`,
      spec: `@openai/codex-${suffix}@npm:@openai/codex@${versions.codex}-${suffix}`,
    },
    {
      name: `@anthropic-ai/claude-agent-sdk-${suffix}`,
      spec: `@anthropic-ai/claude-agent-sdk-${suffix}@${versions.agentSdk}`,
    },
  ]
}

function installedVersion(name) {
  const pkgPath = path.join(rootDir, 'node_modules', name, 'package.json')
  if (!fs.existsSync(pkgPath)) return ''
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || ''
}

function verifyFfmpegCapabilities(binaryPath, deps = {}) {
  const run = deps.execFileSync || execFileSync
  const filters = String(run(binaryPath, ['-hide_banner', '-filters'], { encoding: 'utf8' }))
  const encoders = String(run(binaryPath, ['-hide_banner', '-encoders'], { encoding: 'utf8' }))

  if (!/\bass\b/i.test(filters) || !/\bsubtitles\b/i.test(filters)) {
    throw new Error(`[platform-binaries] ffmpeg is missing libass subtitle filters: ${binaryPath}`)
  }
  if (!/\bzoompan\b/i.test(filters)) {
    throw new Error(`[platform-binaries] ffmpeg is missing zoompan: ${binaryPath}`)
  }
  if (!/\blibx264\b/i.test(encoders) || !/\baac\b/i.test(encoders)) {
    throw new Error(`[platform-binaries] ffmpeg is missing libx264 or aac encoder: ${binaryPath}`)
  }
}

function sha256(bufferOrPath) {
  const data = Buffer.isBuffer(bufferOrPath) ? bufferOrPath : fs.readFileSync(bufferOrPath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

function checksumEnvKey(target) {
  return `AFC_FFMPEG_${target.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_SHA256`
}

function targetEnvKey(target, suffix) {
  return `AFC_FFMPEG_${target.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${suffix}`
}

function executableName(platform) {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

function parseTarget(target) {
  const separator = target.lastIndexOf('-')
  if (separator <= 0) throw new Error(`[platform-binaries] invalid ffmpeg target: ${target}`)
  return { platform: target.slice(0, separator), arch: target.slice(separator + 1) }
}

function verifyStagedFfmpeg(binaryPath, target) {
  const { platform, arch } = parseTarget(target)
  const checksumPath = `${binaryPath}.sha256`
  if (!fs.existsSync(binaryPath) || !fs.existsSync(checksumPath)) return false
  const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]
  if (!/^[a-f0-9]{64}$/i.test(expected) || sha256(binaryPath) !== expected.toLowerCase()) return false
  if (!verifyBinaryArch(binaryPath, { platform, arch })) return false
  verifyFfmpegCapabilities(binaryPath)
  return true
}

function preserveFfmpegLicenses(sourcePath, target, explicitLicenseDir) {
  const realSource = fs.realpathSync(sourcePath)
  const sourceDirectories = [
    explicitLicenseDir,
    path.dirname(realSource),
    path.dirname(path.dirname(realSource)),
  ].filter(Boolean)
  const licenseFiles = []
  for (const directory of sourceDirectories) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue
    for (const name of fs.readdirSync(directory)) {
      if (!/^(?:COPYING|LICENSE|README)/i.test(name)) continue
      const source = path.join(directory, name)
      if (fs.statSync(source).isFile()) licenseFiles.push({ source, name })
    }
    if (licenseFiles.length > 0) break
  }
  if (licenseFiles.length === 0) {
    throw new Error(
      `[platform-binaries] ffmpeg LICENSE/README not found for ${target}; ` +
      `set ${targetEnvKey(target, 'LICENSE_DIR')}`
    )
  }

  const destination = path.join(rootDir, 'LICENSES', 'ffmpeg', target)
  fs.mkdirSync(destination, { recursive: true })
  for (const file of licenseFiles) fs.copyFileSync(file.source, path.join(destination, file.name))
}

function stageLocalFfmpeg({ sourcePath, target, expectedSha256, licenseDir }) {
  const { platform, arch } = parseTarget(target)
  const destinationDirectory = path.join(rootDir, 'vendor', 'ffmpeg', target)
  const destination = path.join(destinationDirectory, executableName(platform))
  const actualChecksum = sha256(sourcePath)

  if (expectedSha256 && actualChecksum !== expectedSha256.toLowerCase()) {
    throw new Error(`[platform-binaries] ffmpeg checksum mismatch for ${target}`)
  }
  if (!verifyBinaryArch(sourcePath, { platform, arch })) {
    throw new Error(`[platform-binaries] ffmpeg architecture mismatch for ${target}: ${sourcePath}`)
  }

  fs.mkdirSync(destinationDirectory, { recursive: true })
  fs.copyFileSync(sourcePath, destination)
  if (platform !== 'win32') fs.chmodSync(destination, 0o755)
  fs.writeFileSync(`${destination}.sha256`, `${actualChecksum}  ${path.basename(destination)}\n`)
  verifyFfmpegCapabilities(destination)
  preserveFfmpegLicenses(sourcePath, target, licenseDir)
  return destination
}

function findSystemFfmpeg(platform) {
  const candidates = platform === 'win32'
    ? []
    : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  try {
    const command = platform === 'win32' ? 'where' : 'which'
    return execFileSync(command, ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
  } catch {
    return ''
  }
}

function downloadBuffer(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error(`too many redirects downloading ${url}`))
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    client.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        resolve(downloadBuffer(new URL(response.headers.location, url).toString(), redirects + 1))
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`download failed (${response.statusCode}) for ${url}`))
        return
      }
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    }).on('error', reject)
  })
}

async function downloadFfmpeg({ url, expectedSha256, target, licenseDir }) {
  if (!expectedSha256) {
    throw new Error(`[platform-binaries] ${checksumEnvKey(target)} is required for downloaded ffmpeg`)
  }
  const downloaded = await downloadBuffer(url)
  const binary = url.endsWith('.gz') ? zlib.gunzipSync(downloaded) : downloaded
  const actualChecksum = sha256(binary)
  if (actualChecksum !== expectedSha256.toLowerCase()) {
    throw new Error(`[platform-binaries] downloaded ffmpeg checksum mismatch for ${target}`)
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-ffmpeg-'))
  const { platform } = parseTarget(target)
  const temporaryBinary = path.join(temporaryDirectory, executableName(platform))
  try {
    fs.writeFileSync(temporaryBinary, binary, { mode: 0o755 })
    return stageLocalFfmpeg({ sourcePath: temporaryBinary, target, expectedSha256, licenseDir })
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

function requestedFfmpegTargets() {
  const configured = process.env.AFC_FFMPEG_TARGETS
  if (configured) return configured.split(',').map(value => value.trim()).filter(Boolean)
  return [`${process.platform}-${process.arch}`]
}

async function stageFfmpegTargets() {
  for (const target of requestedFfmpegTargets()) {
    const { platform, arch } = parseTarget(target)
    const destination = path.join(rootDir, 'vendor', 'ffmpeg', target, executableName(platform))
    if (verifyStagedFfmpeg(destination, target)) {
      console.log(`[platform-binaries] ffmpeg already verified: ${target}`)
      continue
    }

    const pathEnv = process.env[targetEnvKey(target, 'PATH')]
    const url = process.env[targetEnvKey(target, 'URL')]
    const expectedSha256 = process.env[checksumEnvKey(target)]
    const licenseDir = process.env[targetEnvKey(target, 'LICENSE_DIR')]
    const isHostTarget = platform === process.platform && arch === process.arch
    const sourcePath = pathEnv || (isHostTarget ? process.env.AFC_FFMPEG_PATH || findSystemFfmpeg(platform) : '')

    if (sourcePath) {
      const staged = stageLocalFfmpeg({ sourcePath, target, expectedSha256, licenseDir })
      console.log(`[platform-binaries] staged local ffmpeg for ${target}: ${staged}`)
      continue
    }
    if (url) {
      // Distribution CI supplies a target-specific URL + pinned SHA-256. This is
      // how real cross-arch binaries are downloaded; host binaries are never reused.
      const staged = await downloadFfmpeg({ url, expectedSha256, target, licenseDir })
      console.log(`[platform-binaries] downloaded ffmpeg for ${target}: ${staged}`)
      continue
    }
    throw new Error(
      `[platform-binaries] no ffmpeg source for ${target}. Set ${targetEnvKey(target, 'PATH')} ` +
      `or ${targetEnvKey(target, 'URL')} with ${checksumEnvKey(target)}.`
    )
  }
}

async function main() {
  const versions = {
    codex: installedVersion('@openai/codex'),
    agentSdk: installedVersion('@anthropic-ai/claude-agent-sdk'),
  }

  // mac universal build는 두 arch를 함께 굽고, win/linux는 현재 타깃 arch만 설치한다.
  const nativeArches = process.platform === 'darwin' ? ['x64', 'arm64'] : [process.arch]
  const specs = nativeArches.flatMap((arch) => resolveSpecs({ platform: process.platform, arch, versions }))
  const missing = specs.filter(({ name }) => !fs.existsSync(path.join(rootDir, 'node_modules', name)))

  if (missing.length > 0) {
    console.log(`[platform-binaries] installing ${missing.length} missing package(s):`)
    for (const { name } of missing) console.log(`  - ${name}`)

    // --force: 호스트 cpu 와 안 맞는 패키지라 npm 이 EBADPLATFORM 으로 거부한다.
    // --no-save/--no-package-lock: 이건 빌드 전용 산출물이지 앱 의존성이 아니다.
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--force', ...missing.map((m) => m.spec)], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  } else {
    console.log('[platform-binaries] native arch packages already present')
  }

  await stageFfmpegTargets()
}

exports.resolveSpecs = resolveSpecs
exports.sha256 = sha256
exports.stageLocalFfmpeg = stageLocalFfmpeg
exports.verifyFfmpegCapabilities = verifyFfmpegCapabilities
exports.verifyStagedFfmpeg = verifyStagedFfmpeg
if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
