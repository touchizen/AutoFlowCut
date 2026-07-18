// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  acquireFfmpegBuild,
  extractFfmpegArchive,
  FFMPEG_BUILD_MANIFEST,
  resolveRequestedFfmpegTargets,
  resolveSpecs,
  verifySelfContainedFfmpeg,
  verifyFfmpegCapabilities,
} from '../../scripts/install-platform-binaries.cjs'

const tempDirs = []

function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-acquire-test-'))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

// @openai/codex 의 arch 패키지는 독립 패키지가 아니라 codex 자신의 버전 태그 별칭이다
//   "@openai/codex-darwin-x64": "npm:@openai/codex@0.142.5-darwin-x64"
// (npm 레지스트리에 @openai/codex-darwin-x64 라는 이름은 404 다 — 실측 확인)
// 반면 claude-agent-sdk 는 진짜 독립 패키지다.
// 두 형태를 섞어 쓰므로 spec 생성이 틀리면 조용히 엉뚱한 버전이 깔린다.

describe('resolveSpecs', () => {
  const versions = { codex: '0.142.5', agentSdk: '0.3.199' }

  test('codex 는 별칭(npm:) spec 으로, agent-sdk 는 일반 spec 으로 만든다', () => {
    expect(resolveSpecs({ platform: 'darwin', arch: 'x64', versions })).toEqual([
      {
        name: '@openai/codex-darwin-x64',
        spec: '@openai/codex-darwin-x64@npm:@openai/codex@0.142.5-darwin-x64',
      },
      {
        name: '@anthropic-ai/claude-agent-sdk-darwin-x64',
        spec: '@anthropic-ai/claude-agent-sdk-darwin-x64@0.3.199',
      },
    ])
  })

  test('arch 가 spec 전체에 반영된다', () => {
    const [codex, sdk] = resolveSpecs({ platform: 'darwin', arch: 'arm64', versions })
    expect(codex.spec).toBe('@openai/codex-darwin-arm64@npm:@openai/codex@0.142.5-darwin-arm64')
    expect(sdk.spec).toBe('@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.199')
  })

  test('버전이 비면 던진다 — 잘못된 버전이 조용히 깔리는 것보다 낫다', () => {
    expect(() => resolveSpecs({ platform: 'darwin', arch: 'x64', versions: { codex: '', agentSdk: '0.3.199' } }))
      .toThrow(/codex/i)
  })
})

describe('verifyFfmpegCapabilities', () => {
  test('requires libass subtitle filters plus libx264 and aac encoders', () => {
    const execFileSync = (_binary, args) => args.includes('-filters')
      ? ' ... ass V->V\n ... subtitles V->V\n ... zoompan V->V\n'
      : ' V....D libx264\n A....D aac\n'
    expect(() => verifyFfmpegCapabilities('/ffmpeg', { execFileSync })).not.toThrow()
  })

  test('rejects a binary without libass', () => {
    const execFileSync = (_binary, args) => args.includes('-filters')
      ? ' ... zoompan V->V\n'
      : ' V....D libx264\n A....D aac\n'
    expect(() => verifyFfmpegCapabilities('/ffmpeg', { execFileSync })).toThrow(/libass/i)
  })

  test('rejects a binary without libx264 or aac', () => {
    const execFileSync = (_binary, args) => args.includes('-filters')
      ? ' ... ass V->V\n ... subtitles V->V\n ... zoompan V->V\n'
      : ' V....D libx265\n A....D flac\n'
    expect(() => verifyFfmpegCapabilities('/ffmpeg', { execFileSync })).toThrow(/libx264.*aac/i)
  })
})

describe('static ffmpeg acquisition manifest', () => {
  test('pins every supported distribution target with an archive recipe and checksum slot', () => {
    expect(Object.keys(FFMPEG_BUILD_MANIFEST).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'win32-x64',
    ])

    for (const build of Object.values(FFMPEG_BUILD_MANIFEST)) {
      expect(build.url).toMatch(/^https:\/\//)
      expect(['raw', 'zip', 'tar.xz']).toContain(build.archive)
      expect(build.sha256).toMatch(/^(?:[a-f0-9]{64}|TODO_FILL_SHA)$/i)
      expect(build.binaryPathPattern).toBeTruthy()
    }
    expect(FFMPEG_BUILD_MANIFEST['win32-x64'].archive).toBe('zip')
    expect(FFMPEG_BUILD_MANIFEST['linux-x64'].archive).toBe('tar.xz')
  })

  test('resolves explicit CLI target first, then npm cross-target, then the host', () => {
    expect(resolveRequestedFfmpegTargets({
      argv: ['--target=win32-x64'],
      env: { AFC_FFMPEG_TARGETS: 'linux-x64' },
      platform: 'darwin',
      arch: 'arm64',
    })).toEqual(['win32-x64'])
    expect(resolveRequestedFfmpegTargets({
      argv: [],
      env: { npm_config_platform: 'linux', npm_config_arch: 'amd64' },
      platform: 'darwin',
      arch: 'arm64',
    })).toEqual(['linux-x64'])
    expect(resolveRequestedFfmpegTargets({ argv: [], env: {}, platform: 'darwin', arch: 'arm64' }))
      .toEqual(['darwin-arm64'])
  })

  test('refuses a TODO checksum before attempting a download', async () => {
    const downloadBuffer = vi.fn()
    const manifest = {
      ...FFMPEG_BUILD_MANIFEST,
      'darwin-arm64': {
        ...FFMPEG_BUILD_MANIFEST['darwin-arm64'],
        sha256: 'TODO_FILL_SHA',
      },
    }
    await expect(acquireFfmpegBuild('darwin-arm64', { env: {}, manifest, downloadBuffer }))
      .rejects.toThrow(/TODO_FILL_SHA.*AFC_FFMPEG_DARWIN_ARM64_SHA256/is)
    expect(downloadBuffer).not.toHaveBeenCalled()
  })

  test('rejects downloaded archive bytes that do not match the pinned SHA-256', async () => {
    await expect(acquireFfmpegBuild('darwin-arm64', {
      env: { AFC_FFMPEG_DARWIN_ARM64_SHA256: '0'.repeat(64) },
      downloadBuffer: async () => Buffer.from('wrong archive'),
    })).rejects.toThrow(/archive checksum mismatch.*darwin-arm64/i)
  })

  test('extracts raw, zip, and tar.xz recipes and locates exactly one manifest member', () => {
    const root = tempDir()
    const archive = path.join(root, 'archive')
    fs.writeFileSync(archive, 'fixture')

    const rawOut = path.join(root, 'raw')
    expect(extractFfmpegArchive(archive, rawOut, {
      archive: 'raw',
      binaryPathPattern: '(^|/)ffmpeg$',
    })).toBe(path.join(rawOut, 'ffmpeg'))
    expect(fs.readFileSync(path.join(rawOut, 'ffmpeg'), 'utf8')).toBe('fixture')

    const zipOut = path.join(root, 'zip')
    const zipRun = vi.fn((command, args) => {
      expect(command).toBe('unzip')
      const destination = args.at(-1)
      fs.mkdirSync(path.join(destination, 'build', 'bin'), { recursive: true })
      fs.writeFileSync(path.join(destination, 'build', 'bin', 'ffmpeg.exe'), 'exe')
    })
    expect(extractFfmpegArchive(archive, zipOut, {
      archive: 'zip',
      binaryPathPattern: '(^|/)bin/ffmpeg\\.exe$',
    }, { hostPlatform: 'darwin', execFileSync: zipRun }))
      .toBe(path.join(zipOut, 'build', 'bin', 'ffmpeg.exe'))

    const tarOut = path.join(root, 'tar')
    const tarRun = vi.fn((command, args) => {
      expect(command).toBe('tar')
      expect(args).toContain('-xJf')
      const destination = args.at(-1)
      fs.mkdirSync(path.join(destination, 'ffmpeg-static'), { recursive: true })
      fs.writeFileSync(path.join(destination, 'ffmpeg-static', 'ffmpeg'), 'elf')
    })
    expect(extractFfmpegArchive(archive, tarOut, {
      archive: 'tar.xz',
      binaryPathPattern: '(^|/)ffmpeg$',
    }, { hostPlatform: 'linux', execFileSync: tarRun }))
      .toBe(path.join(tarOut, 'ffmpeg-static', 'ffmpeg'))
  })
})

describe('verifySelfContainedFfmpeg', () => {
  test('accepts only system dylibs on macOS', () => {
    const execFileSync = () => [
      '/vendor/ffmpeg:',
      '\t/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation (compatibility version 1.0.0)',
      '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)',
    ].join('\n')
    expect(() => verifySelfContainedFfmpeg('/vendor/ffmpeg', { platform: 'darwin', execFileSync }))
      .not.toThrow()
  })

  test('rejects Homebrew or other non-system dylibs on macOS', () => {
    const execFileSync = () => [
      '/vendor/ffmpeg:',
      '\t/opt/homebrew/opt/libass/lib/libass.9.dylib (compatibility version 1.0.0)',
    ].join('\n')
    expect(() => verifySelfContainedFfmpeg('/vendor/ffmpeg', { platform: 'darwin', execFileSync }))
      .toThrow(/not self-contained.*\/opt\/homebrew/is)
  })

  test('accepts a static ELF and rejects a dynamically linked ELF', () => {
    const staticError = Object.assign(new Error('ldd exited 1'), {
      stdout: 'not a dynamic executable\n',
      stderr: '',
    })
    expect(() => verifySelfContainedFfmpeg('/vendor/ffmpeg', {
      platform: 'linux',
      execFileSync: () => { throw staticError },
    })).not.toThrow()
    expect(() => verifySelfContainedFfmpeg('/vendor/ffmpeg', {
      platform: 'linux',
      execFileSync: () => 'libavcodec.so => /usr/local/lib/libavcodec.so\n',
    })).toThrow(/not static.*libavcodec/is)
  })

  test('rejects adjacent FFmpeg runtime DLLs for the PE distribution', () => {
    const directory = tempDir()
    const binary = path.join(directory, 'ffmpeg.exe')
    fs.writeFileSync(binary, 'exe')
    fs.writeFileSync(path.join(directory, 'avcodec-61.dll'), 'dll')
    expect(() => verifySelfContainedFfmpeg(binary, { platform: 'win32' }))
      .toThrow(/not self-contained.*avcodec-61\.dll/is)
  })
})
