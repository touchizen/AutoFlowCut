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
const { execFileSync } = require('child_process')
const { verifyBinaryArch } = require('./verifyBinaryArch.cjs')

const rootDir = path.resolve(__dirname, '..')

// The SHA-256 is for the downloaded archive, not the extracted executable.
// Distribution builds must replace TODO_FILL_SHA (or inject the matching
// AFC_FFMPEG_<TARGET>_SHA256 value) before acquisition is allowed.
const FFMPEG_BUILD_MANIFEST = Object.freeze({
  'darwin-arm64': Object.freeze({
    source: 'osxexperts',
    url: 'https://www.osxexperts.net/ffmpeg7arm.zip',
    sha256: '563111a239fe70d2e5c84a5382204a7d0bf0a332385a92a44baff36d313e27f2',
    archive: 'zip',
    binaryPathPattern: '(^|/)ffmpeg$',
  }),
  'darwin-x64': Object.freeze({
    source: 'evermeet',
    url: 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip',
    sha256: '8d7917c1cebd7a29e68c0a0a6cc4ecc3fe05c7fffed958636c7018b319afdda4',
    archive: 'zip',
    binaryPathPattern: '(^|/)ffmpeg$',
  }),
  // BtbN's "latest" and johnvansickle's "release" URLs are rolling artifacts,
  // so their bytes/SHA can drift. Release builds should pin a versioned tag URL.
  'win32-x64': Object.freeze({
    source: 'BtbN',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    sha256: '09dba4ed6fd991af90ac6ce852d6eaa2cea3446e6ffc86b276bcb18b1f794e3c',
    archive: 'zip',
    binaryPathPattern: '(^|/)bin/ffmpeg\\.exe$',
  }),
  'linux-x64': Object.freeze({
    source: 'johnvansickle',
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    sha256: 'abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67',
    archive: 'tar.xz',
    binaryPathPattern: '(^|/)ffmpeg$',
  }),
})

const WINDOWS_SYSTEM_DLLS = new Set([
  'advapi32.dll', 'avicap32.dll', 'avrt.dll', 'bcrypt.dll', 'cfgmgr32.dll',
  'comctl32.dll', 'comdlg32.dll', 'crypt32.dll', 'd2d1.dll', 'd3d11.dll',
  'dbghelp.dll', 'dhcpcsvc.dll', 'dnsapi.dll', 'dwrite.dll', 'dwmapi.dll',
  'dxgi.dll', 'gdi32.dll', 'imm32.dll', 'iphlpapi.dll', 'kernel32.dll',
  'mf.dll', 'mfplat.dll', 'mfreadwrite.dll', 'mfuuid.dll', 'msvcrt.dll',
  'ncrypt.dll', 'netapi32.dll', 'normaliz.dll', 'ntdll.dll', 'ole32.dll',
  'oleaut32.dll', 'powrprof.dll', 'propsys.dll', 'psapi.dll', 'rpcrt4.dll',
  'secur32.dll', 'setupapi.dll', 'shell32.dll', 'shlwapi.dll', 'ucrtbase.dll',
  'user32.dll', 'usp10.dll', 'uxtheme.dll', 'version.dll', 'winhttp.dll',
  'winmm.dll', 'winspool.drv', 'winusb.dll', 'ws2_32.dll', 'wtsapi32.dll',
])

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

function verifySelfContainedFfmpeg(binaryPath, deps = {}) {
  const platform = deps.platform || process.platform
  const run = deps.execFileSync || execFileSync

  if (platform === 'darwin') {
    const output = String(run('otool', ['-L', binaryPath], { encoding: 'utf8' }))
    const dependencies = output.split(/\r?\n/).slice(1)
      .map(line => line.trim().split(/\s+\(/)[0])
      .filter(Boolean)
    const external = dependencies.filter(dependency => (
      !dependency.startsWith('/System/Library/')
      && !dependency.startsWith('/usr/lib/')
    ))
    if (external.length > 0) {
      throw new Error(
        `[platform-binaries] ffmpeg is not self-contained; non-system dylibs: ${external.join(', ')}`
      )
    }
    return true
  }

  if (platform === 'linux') {
    let output = ''
    try {
      output = String(run('ldd', [binaryPath], { encoding: 'utf8' }))
    } catch (error) {
      output = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || ''}`
    }
    if (/not a dynamic executable|statically linked/i.test(output)) return true
    throw new Error(`[platform-binaries] ffmpeg ELF is not static: ${output.trim()}`)
  }

  if (platform === 'win32') {
    const importedDlls = parsePeImportedDlls(binaryPath)
    const nonSystemImports = importedDlls.filter(dll => !isWindowsSystemDll(dll))
    if (nonSystemImports.length > 0) {
      throw new Error(
        `[platform-binaries] ffmpeg PE has non-system PE imports: ${nonSystemImports.join(', ')}`
      )
    }

    // Also reject split FFmpeg distributions even if a currently-unused DLL
    // is not present in the executable's import directory.
    const siblings = fs.existsSync(path.dirname(binaryPath))
      ? fs.readdirSync(path.dirname(binaryPath))
      : []
    const bundledRuntimeDlls = siblings.filter(name => (
      /^(?:avcodec|avdevice|avfilter|avformat|avutil|postproc|swresample|swscale|libass|x26[45]|lib).*\.dll$/i
        .test(name)
    ))
    if (bundledRuntimeDlls.length > 0) {
      throw new Error(
        `[platform-binaries] ffmpeg PE is not self-contained; runtime DLLs present: ${bundledRuntimeDlls.join(', ')}`
      )
    }
    return true
  }

  throw new Error(`[platform-binaries] unsupported ffmpeg platform: ${platform}`)
}

function parsePeImportedDlls(bufferOrPath) {
  const buffer = Buffer.isBuffer(bufferOrPath) ? bufferOrPath : fs.readFileSync(bufferOrPath)
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('[platform-binaries] invalid PE executable: missing MZ header')
  }

  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 24 > buffer.length || buffer.toString('binary', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('[platform-binaries] invalid PE executable: missing PE signature')
  }

  const sectionCount = buffer.readUInt16LE(peOffset + 6)
  const optionalSize = buffer.readUInt16LE(peOffset + 20)
  const optionalOffset = peOffset + 24
  const sectionTableOffset = optionalOffset + optionalSize
  if (sectionTableOffset + sectionCount * 40 > buffer.length) {
    throw new Error('[platform-binaries] invalid PE executable: truncated section table')
  }

  const magic = buffer.readUInt16LE(optionalOffset)
  const dataDirectoryOffset = magic === 0x20b
    ? optionalOffset + 112
    : magic === 0x10b
      ? optionalOffset + 96
      : -1
  const numberOfDirectoriesOffset = magic === 0x20b
    ? optionalOffset + 108
    : optionalOffset + 92
  if (dataDirectoryOffset < 0 || dataDirectoryOffset + 16 > sectionTableOffset) {
    throw new Error('[platform-binaries] invalid PE executable: unsupported optional header')
  }
  if (buffer.readUInt32LE(numberOfDirectoriesOffset) < 2) return []

  const sections = []
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTableOffset + index * 40
    sections.push({
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      rawOffset: buffer.readUInt32LE(offset + 20),
    })
  }

  const sizeOfHeaders = buffer.readUInt32LE(optionalOffset + 60)
  const rvaToOffset = (rva) => {
    if (rva < sizeOfHeaders && rva < buffer.length) return rva
    const section = sections.find(candidate => {
      const span = Math.max(candidate.virtualSize, candidate.rawSize)
      return rva >= candidate.virtualAddress && rva < candidate.virtualAddress + span
    })
    if (!section) throw new Error(`[platform-binaries] invalid PE import RVA: 0x${rva.toString(16)}`)
    const delta = rva - section.virtualAddress
    if (delta >= section.rawSize || section.rawOffset + delta >= buffer.length) {
      throw new Error(`[platform-binaries] truncated PE import RVA: 0x${rva.toString(16)}`)
    }
    return section.rawOffset + delta
  }

  const importRva = buffer.readUInt32LE(dataDirectoryOffset + 8)
  const importSize = buffer.readUInt32LE(dataDirectoryOffset + 12)
  if (importRva === 0 || importSize === 0) return []
  const importOffset = rvaToOffset(importRva)
  const descriptorLimit = Math.min(4096, Math.max(1, Math.ceil(importSize / 20)))
  const importedDlls = []
  let foundTerminator = false

  for (let index = 0; index < descriptorLimit; index += 1) {
    const descriptorOffset = importOffset + index * 20
    if (descriptorOffset + 20 > buffer.length) {
      throw new Error('[platform-binaries] truncated PE import descriptor')
    }
    const fields = Array.from({ length: 5 }, (_, field) => (
      buffer.readUInt32LE(descriptorOffset + field * 4)
    ))
    if (fields.every(value => value === 0)) {
      foundTerminator = true
      break
    }
    if (fields[3] === 0) throw new Error('[platform-binaries] PE import descriptor has no DLL name')
    importedDlls.push(readPeAsciiZ(buffer, rvaToOffset(fields[3])))
  }

  if (!foundTerminator) throw new Error('[platform-binaries] unterminated PE import table')
  return [...new Set(importedDlls)]
}

function readPeAsciiZ(buffer, offset) {
  const limit = Math.min(buffer.length, offset + 4096)
  let end = offset
  while (end < limit && buffer[end] !== 0) end += 1
  if (end === limit || end === offset) throw new Error('[platform-binaries] invalid PE import DLL name')
  return buffer.toString('ascii', offset, end)
}

function isWindowsSystemDll(value) {
  const dll = path.win32.basename(String(value)).toLowerCase()
  return WINDOWS_SYSTEM_DLLS.has(dll) || /^(?:api|ext)-ms-win-[a-z0-9._-]+\.dll$/.test(dll)
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

function verifyStagedFfmpeg(binaryPath, target, deps = {}) {
  const { platform, arch } = parseTarget(target)
  const verifyArch = deps.verifyBinaryArch || verifyBinaryArch
  const verifySelfContained = deps.verifySelfContainedFfmpeg || verifySelfContainedFfmpeg
  const verifyCapabilities = deps.verifyFfmpegCapabilities || verifyFfmpegCapabilities
  const checksumPath = `${binaryPath}.sha256`
  if (!fs.existsSync(binaryPath) || !fs.existsSync(checksumPath)) return false
  const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]
  if (!/^[a-f0-9]{64}$/i.test(expected) || sha256(binaryPath) !== expected.toLowerCase()) return false
  if (!verifyArch(binaryPath, { platform, arch })) return false
  if (!isHostNativeTarget({ platform, arch }, deps)) {
    logDeferredVerification(target, deps)
    return true
  }
  try {
    verifySelfContained(binaryPath, { platform, execFileSync: deps.execFileSync })
    verifyCapabilities(binaryPath, { execFileSync: deps.execFileSync })
    return true
  } catch {
    return false
  }
}

function preserveFfmpegLicenses(sourcePath, target, explicitLicenseDir) {
  const realSource = fs.realpathSync(sourcePath)
  const bundledFfmpegLicenses = path.join(rootDir, 'LICENSES', 'ffmpeg', 'darwin-arm64')
  const sourceDirectories = [
    explicitLicenseDir,
    path.dirname(realSource),
    path.dirname(path.dirname(realSource)),
    // Generic FFmpeg GPL/LGPL texts are already bundled for offline builds;
    // use them when an upstream binary-only archive omits license files.
    bundledFfmpegLicenses,
  ].filter(Boolean)
  const licenseFiles = []
  for (const directory of sourceDirectories) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue
    collectLicenseFiles(directory, licenseFiles)
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
  for (const file of licenseFiles) {
    const output = path.join(destination, file.name)
    if (path.resolve(file.source) !== path.resolve(output)) fs.copyFileSync(file.source, output)
  }
}

function collectLicenseFiles(directory, output, depth = 0) {
  if (depth > 3) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectLicenseFiles(source, output, depth + 1)
    } else if (/^(?:COPYING|LICENSE|README|GPL|LGPL)/i.test(entry.name)) {
      output.push({ source, name: entry.name })
    }
  }
}

function stageLocalFfmpeg({ sourcePath, target, expectedSha256, licenseDir }, deps = {}) {
  const { platform, arch } = parseTarget(target)
  const verifyArch = deps.verifyBinaryArch || verifyBinaryArch
  const verifySelfContained = deps.verifySelfContainedFfmpeg || verifySelfContainedFfmpeg
  const verifyCapabilities = deps.verifyFfmpegCapabilities || verifyFfmpegCapabilities
  const preserveLicenses = deps.preserveFfmpegLicenses || preserveFfmpegLicenses
  const destinationDirectory = path.join(
    deps.vendorRoot || path.join(rootDir, 'vendor', 'ffmpeg'),
    target,
  )
  const destination = path.join(destinationDirectory, executableName(platform))
  const actualChecksum = sha256(sourcePath)
  const hostNative = isHostNativeTarget({ platform, arch }, deps)

  if (expectedSha256 && actualChecksum !== expectedSha256.toLowerCase()) {
    throw new Error(`[platform-binaries] ffmpeg checksum mismatch for ${target}`)
  }
  if (!verifyArch(sourcePath, { platform, arch })) {
    throw new Error(`[platform-binaries] ffmpeg architecture mismatch for ${target}: ${sourcePath}`)
  }
  if (hostNative) {
    verifySelfContained(sourcePath, { platform, execFileSync: deps.execFileSync })
  }

  fs.mkdirSync(destinationDirectory, { recursive: true })
  fs.copyFileSync(sourcePath, destination)
  if (platform !== 'win32') fs.chmodSync(destination, 0o755)
  fs.writeFileSync(`${destination}.sha256`, `${actualChecksum}  ${path.basename(destination)}\n`)
  if (hostNative) {
    verifySelfContained(destination, { platform, execFileSync: deps.execFileSync })
    verifyCapabilities(destination, { execFileSync: deps.execFileSync })
  } else {
    logDeferredVerification(target, deps)
  }
  preserveLicenses(sourcePath, target, licenseDir)
  return destination
}

function isHostNativeTarget({ platform, arch }, deps = {}) {
  const hostPlatform = deps.hostPlatform ?? process.platform
  const hostArch = deps.hostArch ?? process.arch
  return hostPlatform === platform && hostArch === arch
}

function logDeferredVerification(target, deps = {}) {
  const hostPlatform = deps.hostPlatform ?? process.platform
  const hostArch = deps.hostArch ?? process.arch
  const log = deps.log || console.log
  log(
    `[platform-binaries] capability/self-containment verification deferred for ${target}; ` +
    `target-native CI required (host: ${hostPlatform}-${hostArch})`
  )
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

function normalizePlatform(platform) {
  if (platform === 'win' || platform === 'windows') return 'win32'
  if (platform === 'mac' || platform === 'macos' || platform === 'osx') return 'darwin'
  return platform
}

function normalizeArch(arch) {
  if (arch === 'amd64' || arch === 'x86_64') return 'x64'
  if (arch === 'aarch64') return 'arm64'
  return arch
}

function splitTargets(value) {
  return String(value || '').split(',').map(target => target.trim()).filter(Boolean)
}

function resolveRequestedFfmpegTargets({
  argv = process.argv.slice(2),
  env = process.env,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const cliTargets = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--target' || argument === '--targets') {
      cliTargets.push(...splitTargets(argv[index + 1]))
      index += 1
    } else if (argument.startsWith('--target=')) {
      cliTargets.push(...splitTargets(argument.slice('--target='.length)))
    } else if (argument.startsWith('--targets=')) {
      cliTargets.push(...splitTargets(argument.slice('--targets='.length)))
    }
  }
  if (cliTargets.length > 0) return [...new Set(cliTargets)]

  const configured = splitTargets(env.AFC_FFMPEG_TARGETS)
  if (configured.length > 0) return [...new Set(configured)]

  const targetPlatform = normalizePlatform(env.npm_config_platform || platform)
  const targetArch = normalizeArch(env.npm_config_arch || arch)
  return [`${targetPlatform}-${targetArch}`]
}

function resolvedManifestBuild(target, env = process.env, manifest = FFMPEG_BUILD_MANIFEST) {
  const manifestBuild = manifest[target]
  if (!manifestBuild) {
    throw new Error(`[platform-binaries] no static ffmpeg manifest entry for ${target}`)
  }
  return {
    ...manifestBuild,
    url: env[targetEnvKey(target, 'URL')] || manifestBuild.url,
    sha256: env[checksumEnvKey(target)] || manifestBuild.sha256,
    licenseDir: env[targetEnvKey(target, 'LICENSE_DIR')],
  }
}

function walkFiles(directory, base = directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walkFiles(absolute, base, output)
    else output.push({ absolute, relative: path.relative(base, absolute).split(path.sep).join('/') })
  }
  return output
}

function extractFfmpegArchive(archivePath, destination, build, deps = {}) {
  const run = deps.execFileSync || execFileSync
  const hostPlatform = deps.hostPlatform || process.platform
  fs.mkdirSync(destination, { recursive: true })

  if (build.archive === 'raw') {
    const output = path.join(destination, build.binaryName || 'ffmpeg')
    fs.copyFileSync(archivePath, output)
  } else if (build.archive === 'zip') {
    if (hostPlatform === 'win32') {
      run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
        archivePath, destination,
      ], { stdio: 'pipe' })
    } else {
      run('unzip', ['-q', archivePath, '-d', destination], { stdio: 'pipe' })
    }
  } else if (build.archive === 'tar.xz') {
    run('tar', ['-xJf', archivePath, '-C', destination], { stdio: 'pipe' })
  } else {
    throw new Error(`[platform-binaries] unsupported ffmpeg archive type: ${build.archive}`)
  }

  const pattern = new RegExp(build.binaryPathPattern, 'i')
  const matches = walkFiles(destination).filter(file => pattern.test(file.relative))
  if (matches.length !== 1) {
    throw new Error(
      `[platform-binaries] expected one ffmpeg binary matching ${build.binaryPathPattern}, found ${matches.length}`
    )
  }
  return matches[0].absolute
}

async function acquireFfmpegBuild(target, deps = {}) {
  const env = deps.env || process.env
  const build = resolvedManifestBuild(target, env, deps.manifest || FFMPEG_BUILD_MANIFEST)
  if (!/^[a-f0-9]{64}$/i.test(build.sha256)) {
    throw new Error(
      `[platform-binaries] ${target} has ${build.sha256}; fill the manifest SHA-256 ` +
      `or set ${checksumEnvKey(target)} before downloading ${build.url}`
    )
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-ffmpeg-'))
  const archivePath = path.join(temporaryDirectory, `download.${build.archive.replace(/[^a-z0-9.]/gi, '_')}`)
  const extractionDirectory = path.join(temporaryDirectory, 'extracted')
  try {
    const downloaded = await (deps.downloadBuffer || downloadBuffer)(build.url)
    fs.writeFileSync(archivePath, downloaded)
    const actualChecksum = sha256(downloaded)
    if (actualChecksum !== build.sha256.toLowerCase()) {
      throw new Error(`[platform-binaries] downloaded archive checksum mismatch for ${target}`)
    }
    const sourcePath = extractFfmpegArchive(archivePath, extractionDirectory, build, deps)
    return stageLocalFfmpeg({
      sourcePath,
      target,
      licenseDir: build.licenseDir || extractionDirectory,
    }, deps)
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

async function stageFfmpegTargets(options = {}) {
  const env = options.env || process.env
  const targets = options.targets || resolveRequestedFfmpegTargets({ env })
  for (const target of targets) {
    const { platform, arch } = parseTarget(target)
    const destination = path.join(rootDir, 'vendor', 'ffmpeg', target, executableName(platform))
    if (verifyStagedFfmpeg(destination, target, options)) {
      console.log(`[platform-binaries] ffmpeg already verified: ${target}`)
      continue
    }

    const sourcePath = env[targetEnvKey(target, 'PATH')]
    const expectedSha256 = env[checksumEnvKey(target)]
    const licenseDir = env[targetEnvKey(target, 'LICENSE_DIR')]

    if (sourcePath) {
      const staged = stageLocalFfmpeg(
        { sourcePath, target, expectedSha256, licenseDir },
        options,
      )
      console.log(`[platform-binaries] staged verified static ffmpeg for ${target}: ${staged}`)
      continue
    }

    // Automatic dev and dist staging always acquires the target-specific static
    // artifact. A host Homebrew/system binary is never copied into vendor/.
    const staged = await acquireFfmpegBuild(target, { ...options, env })
    console.log(`[platform-binaries] acquired static ffmpeg for ${target}: ${staged}`)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const targets = resolveRequestedFfmpegTargets({ argv })
  const ffmpegOnly = argv.includes('--ffmpeg-only')

  if (ffmpegOnly) {
    await stageFfmpegTargets({ targets })
    return
  }

  const versions = {
    codex: installedVersion('@openai/codex'),
    agentSdk: installedVersion('@anthropic-ai/claude-agent-sdk'),
  }

  const nativeTargets = targets.map(parseTarget)
  const specs = nativeTargets.flatMap(({ platform, arch }) => resolveSpecs({ platform, arch, versions }))
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

  await stageFfmpegTargets({ targets })
}

exports.FFMPEG_BUILD_MANIFEST = FFMPEG_BUILD_MANIFEST
exports.acquireFfmpegBuild = acquireFfmpegBuild
exports.extractFfmpegArchive = extractFfmpegArchive
exports.parsePeImportedDlls = parsePeImportedDlls
exports.resolveRequestedFfmpegTargets = resolveRequestedFfmpegTargets
exports.resolveSpecs = resolveSpecs
exports.sha256 = sha256
exports.stageLocalFfmpeg = stageLocalFfmpeg
exports.stageFfmpegTargets = stageFfmpegTargets
exports.verifyFfmpegCapabilities = verifyFfmpegCapabilities
exports.verifySelfContainedFfmpeg = verifySelfContainedFfmpeg
exports.verifyStagedFfmpeg = verifyStagedFfmpeg
if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
