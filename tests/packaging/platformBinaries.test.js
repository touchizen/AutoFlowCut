import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { pruneForeignPlatformPackages } from '../../scripts/afterPack.cjs'

// codex / claude-agent-sdk 는 네이티브 바이너리를 arch 별 optional 패키지로 쪼개 배포한다
// (@openai/codex-darwin-x64, @anthropic-ai/claude-agent-sdk-darwin-arm64 ...).
// npm 은 호스트에 맞는 것만 설치하므로, --x64 --arm64 를 한 번에 구우려면 둘 다 설치해 둬야 한다.
// 그런데 electron-builder 는 node_modules 에 있는 arch 패키지를 전부 복사한다 (실측 확인) —
// 그래서 afterPack 에서 타겟이 아닌 것을 잘라내야 한다.
//
// 잘라내지 않으면: 앱마다 두 arch 바이너리가 다 실려 ~460MB 가 그냥 낭비된다.
// 설치하지 않으면: Intel 빌드에 arm64 바이너리만 실리는데, resolveCodexExecutablePath()
//   (electron/api/llm/codexSdk.js) 가 process.arch 로 패키지를 고르므로 Intel 맥에서
//   MODULE_NOT_FOUND 로 죽는다. 빌드는 성공으로 보이기 때문에 조용히 깨진다.

const tmpDirs = []

function makeNodeModules(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-prune-'))
  tmpDirs.push(dir)
  for (const entry of entries) {
    const full = path.join(dir, entry)
    fs.mkdirSync(full, { recursive: true })
    fs.writeFileSync(path.join(full, 'package.json'), '{}')
  }
  return dir
}

function listPackages(dir) {
  const out = []
  for (const scope of fs.readdirSync(dir)) {
    for (const name of fs.readdirSync(path.join(dir, scope))) out.push(`${scope}/${name}`)
  }
  return out.sort()
}

const FULL_INSTALL = [
  '@openai/codex',
  '@openai/codex-darwin-arm64',
  '@openai/codex-darwin-x64',
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-darwin-x64',
]

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('pruneForeignPlatformPackages', () => {
  test('darwin/x64 빌드는 arm64 네이티브 패키지를 지우고 x64 만 남긴다', () => {
    const dir = makeNodeModules(FULL_INSTALL)

    const removed = pruneForeignPlatformPackages(dir, { platform: 'darwin', arch: 'x64' })

    expect(listPackages(dir)).toEqual([
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic-ai/claude-agent-sdk-darwin-x64',
      '@openai/codex',
      '@openai/codex-darwin-x64',
    ])
    expect(removed.sort()).toEqual([
      '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      '@openai/codex-darwin-arm64',
    ])
  })

  test('darwin/arm64 빌드는 x64 네이티브 패키지를 지운다', () => {
    const dir = makeNodeModules(FULL_INSTALL)

    pruneForeignPlatformPackages(dir, { platform: 'darwin', arch: 'arm64' })

    expect(listPackages(dir)).toEqual([
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      '@openai/codex',
      '@openai/codex-darwin-arm64',
    ])
  })

  test('다른 OS 용 네이티브 패키지(linux/win32/musl)도 잘라낸다', () => {
    const dir = makeNodeModules([
      ...FULL_INSTALL,
      '@openai/codex-linux-x64',
      '@openai/codex-win32-x64',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
      '@anthropic-ai/claude-agent-sdk-win32-arm64',
    ])

    pruneForeignPlatformPackages(dir, { platform: 'darwin', arch: 'arm64' })

    expect(listPackages(dir)).toEqual([
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      '@openai/codex',
      '@openai/codex-darwin-arm64',
    ])
  })

  test('타겟 arch 패키지가 없으면 던진다 — 조용히 깨진 빌드를 내보내지 않는다', () => {
    // 이게 545MB x64 DMG 에서 실제로 일어난 일이다: arm64 만 실려 나갔는데
    // 빌드는 성공으로 보였고, Intel 맥에서만 codex 가 죽는다.
    const dir = makeNodeModules(['@openai/codex', '@openai/codex-darwin-arm64'])

    expect(() => pruneForeignPlatformPackages(dir, { platform: 'darwin', arch: 'x64' }))
      .toThrow(/@openai\/codex-darwin-x64/)
  })

  test('관계없는 패키지는 건드리지 않는다', () => {
    const dir = makeNodeModules([...FULL_INSTALL, '@sentry/core', '@firebase/auth'])

    pruneForeignPlatformPackages(dir, { platform: 'darwin', arch: 'x64' })

    const kept = listPackages(dir)
    expect(kept).toContain('@sentry/core')
    expect(kept).toContain('@firebase/auth')
  })

  // Windows/Linux 는 각 OS 호스트에서 단일 arch 로 굽는다 (npm 이 호스트에 맞는 패키지만
  // 설치하므로 node_modules 에 그 하나만 있다). prune 은 아무것도 지우지 않고 통과해야 한다 —
  // 여기서 잘못 지우거나 잘못 던지면 Windows 빌드가 통째로 깨진다.
  test('win32/x64 호스트 빌드: 지울 것도 없고 던지지도 않는다', () => {
    const dir = makeNodeModules([
      '@openai/codex',
      '@openai/codex-win32-x64',
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic-ai/claude-agent-sdk-win32-x64',
    ])

    const removed = pruneForeignPlatformPackages(dir, { platform: 'win32', arch: 'x64' })

    expect(removed).toEqual([])
    expect(listPackages(dir)).toEqual([
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic-ai/claude-agent-sdk-win32-x64',
      '@openai/codex',
      '@openai/codex-win32-x64',
    ])
  })

  test('linux/x64 호스트 빌드: glibc 패키지를 남기고 musl 을 지운다', () => {
    const dir = makeNodeModules([
      '@openai/codex',
      '@openai/codex-linux-x64',
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic-ai/claude-agent-sdk-linux-x64',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    ])

    const removed = pruneForeignPlatformPackages(dir, { platform: 'linux', arch: 'x64' })

    expect(removed).toEqual(['@anthropic-ai/claude-agent-sdk-linux-x64-musl'])
    expect(listPackages(dir)).toContain('@anthropic-ai/claude-agent-sdk-linux-x64')
  })

  test('네이티브 패키지 부모가 없는 스코프는 검사를 건너뛴다', () => {
    // mcp-server 등 다른 곳에서 온 node_modules 트리에는 codex 자체가 없을 수 있다.
    const dir = makeNodeModules(['@sentry/core'])

    expect(pruneForeignPlatformPackages(dir, { platform: 'darwin', arch: 'x64' })).toEqual([])
  })
})
