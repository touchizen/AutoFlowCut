import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Arch } from 'electron-builder'

import afterPack from '../../scripts/afterPack.cjs'

// `mcp-server` 는 extraResources 로 asar **밖**에 실린다. 그 node_modules 는 electron-builder 가
// 안 옮겨주므로 afterPack 이 직접 복사한다. 그런데 복사 대상이 `appOutDir/resources` 로 하드코딩돼
// 있으면 **win/linux 에서만 맞고 mac 에선 번들 밖으로 샌다** — 빌드는 초록인데 출하된 앱의
// MCP 서버는 의존성이 없어 죽는다 (실측: release/mac-arm64 빌드가 그 상태였다).
// 리소스 경로는 플랫폼마다 다르므로 electron-builder 의 getResourcesDir 로 물어봐야 한다.

const tmpDirs = []
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true })
})

/**
 * @param {(appOutDir: string) => string} getResourcesDir 플랫폼별 리소스 경로 (electron-builder 가 알려준다)
 */
function makeContext({ electronPlatformName, getResourcesDir }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afterpack-'))
  tmpDirs.push(root)

  const projectDir = path.join(root, 'project')
  fs.mkdirSync(path.join(projectDir, 'mcp-server', 'node_modules', 'zod'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'mcp-server', 'node_modules', 'zod', 'index.js'), 'module.exports = {}')
  // mcp-server 를 **싣는다**는 표시 (extraResources 로 나가는 실제 패키지)
  fs.writeFileSync(path.join(projectDir, 'mcp-server', 'package.json'), '{"name":"mcp-server"}')

  const appOutDir = path.join(root, 'out')
  fs.mkdirSync(getResourcesDir(appOutDir), { recursive: true })

  return {
    appOutDir,
    arch: Arch.arm64,
    electronPlatformName,
    packager: { projectDir, getResourcesDir },
  }
}

const MAC_RESOURCES = (appOutDir) => path.join(appOutDir, 'AutoFlowCut.app', 'Contents', 'Resources')
const WIN_RESOURCES = (appOutDir) => path.join(appOutDir, 'resources')

describe('afterPack: mcp-server/node_modules 를 실제 리소스 디렉토리로 복사한다', () => {
  test('mac: .app 번들 **안**으로 복사한다 (번들 밖 appOutDir/resources 가 아니다)', async () => {
    const ctx = makeContext({ electronPlatformName: 'darwin', getResourcesDir: MAC_RESOURCES })

    await afterPack(ctx)

    const shipped = path.join(MAC_RESOURCES(ctx.appOutDir), 'mcp-server', 'node_modules', 'zod', 'index.js')
    expect(fs.existsSync(shipped), '출하되는 .app 안에 mcp-server 의 의존성이 없다').toBe(true)

    const strayOutsideBundle = path.join(ctx.appOutDir, 'resources', 'mcp-server')
    expect(fs.existsSync(strayOutsideBundle), '번들 밖으로 샜다 — 출하 앱엔 안 들어간다').toBe(false)
  })

  test('win/linux: resources/ 로 복사한다 (회귀 방지)', async () => {
    const ctx = makeContext({ electronPlatformName: 'win32', getResourcesDir: WIN_RESOURCES })

    await afterPack(ctx)

    const shipped = path.join(WIN_RESOURCES(ctx.appOutDir), 'mcp-server', 'node_modules', 'zod', 'index.js')
    expect(fs.existsSync(shipped)).toBe(true)
  })

  // 🔴 fail-open 이 이 버그를 오래 살렸다. 같은 파일이 **codex 바이너리 부재엔 throw** 하면서
  //    mcp-server 의존성 부재엔 조용히 skip 해서, 의존성 없는 MCP 서버가 그대로 출하됐다.
  //    "빌드는 초록인데 출하물이 죽어 있다" 는 이 프로젝트가 이미 밟은 함정이다. 여기서 터뜨린다.
  test('🔴 mcp-server 를 싣는데 그 node_modules 가 없으면 **빌드를 터뜨린다** (조용히 넘어가지 않는다)', async () => {
    const ctx = makeContext({ electronPlatformName: 'darwin', getResourcesDir: MAC_RESOURCES })
    fs.rmSync(path.join(ctx.packager.projectDir, 'mcp-server', 'node_modules'), { recursive: true, force: true })

    await expect(afterPack(ctx)).rejects.toThrow(/mcp:install/)
  })

  test('mcp-server 자체를 안 싣는 프로젝트면 터뜨리지 않는다', async () => {
    const ctx = makeContext({ electronPlatformName: 'darwin', getResourcesDir: MAC_RESOURCES })
    fs.rmSync(path.join(ctx.packager.projectDir, 'mcp-server'), { recursive: true, force: true })

    await expect(afterPack(ctx)).resolves.toBeUndefined()
  })
})
