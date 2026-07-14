// electron-builder afterPack hook
// 1. Copies mcp-server/node_modules into the packaged resources
//    (extraResources auto-excludes node_modules)
// 2. Prunes native platform packages that don't match the target arch
//    (see pruneForeignPlatformPackages)
// 3. Normalizes non-ASCII filenames to NFD form (macOS only) so that
//    codesign signatures remain valid after HFS+ DMG packaging
//    (HFS+ stores filenames as NFD; if the .app was signed with NFC
//    filenames, signature verification fails inside the DMG).

const fs = require('fs')
const path = require('path')

// codex / claude-agent-sdk 는 네이티브 바이너리를 arch 별 패키지로 쪼개 배포한다.
// npm 은 호스트에 맞는 것만 설치하므로 --x64 --arm64 를 함께 구우려면 둘 다 설치해야 하고
// (scripts/install-platform-binaries.cjs), electron-builder 는 그렇게 설치된 걸 전부
// 복사한다. 여기서 타겟이 아닌 걸 잘라낸다 — afterPack 은 코드서명 전에 돌기 때문에
// 지운 파일이 서명 대상에 남지 않는다.
const NATIVE_PACKAGE_FAMILIES = ['@openai/codex', '@anthropic-ai/claude-agent-sdk']
const PLATFORM_SUFFIX_RE = /-(darwin|linux|win32)-(x64|arm64|ia32|armv7l)(-musl)?$/

function pruneForeignPlatformPackages(nodeModulesDir, { platform, arch }) {
  const removed = []
  if (!fs.existsSync(nodeModulesDir)) return removed

  for (const family of NATIVE_PACKAGE_FAMILIES) {
    const [scope, base] = family.split('/')
    const scopeDir = path.join(nodeModulesDir, scope)
    if (!fs.existsSync(scopeDir)) continue

    const target = `${base}-${platform}-${arch}`
    for (const name of fs.readdirSync(scopeDir)) {
      if (!name.startsWith(`${base}-`) || !PLATFORM_SUFFIX_RE.test(name)) continue
      if (name === target) continue
      fs.rmSync(path.join(scopeDir, name), { recursive: true, force: true })
      removed.push(`${scope}/${name}`)
    }

    // 부모 패키지가 실렸는데 타겟 arch 바이너리가 없으면 그 앱은 해당 엔진이 죽는다.
    // 빌드가 성공한 것처럼 보이므로 여기서 반드시 터뜨린다.
    if (fs.existsSync(path.join(scopeDir, base)) && !fs.existsSync(path.join(scopeDir, target))) {
      throw new Error(
        `[afterPack] ${scope}/${target} not found — the ${platform}/${arch} build would ship without it. ` +
        `Run "npm run install:platform-binaries" before packaging.`
      )
    }
  }
  return removed
}

exports.pruneForeignPlatformPackages = pruneForeignPlatformPackages

function copyRecursive(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

// Recursively rename files/dirs containing non-ASCII characters to NFD form.
// Walks bottom-up so directory renames don't invalidate child paths.
function normalizeFilenamesToNFD(dir) {
  let renamed = 0
  const stat = fs.statSync(dir)
  if (!stat.isDirectory()) return renamed

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const entryStat = fs.lstatSync(fullPath)
    if (entryStat.isDirectory()) {
      renamed += normalizeFilenamesToNFD(fullPath)
    }
    const nfd = entry.normalize('NFD')
    if (nfd !== entry) {
      const newPath = path.join(dir, nfd)
      fs.renameSync(fullPath, newPath)
      renamed++
    }
  }
  return renamed
}

exports.default = async function (context) {
  const appOutDir = context.appOutDir
  const sourceNodeModules = path.join(context.packager.projectDir, 'mcp-server', 'node_modules')
  // 리소스 경로는 플랫폼마다 다르다 (mac 은 `.app/Contents/Resources`, win/linux 는 `resources`).
  // 하드코딩하면 mac 에서 번들 밖으로 새고, 출하된 앱의 mcp-server 는 의존성 없이 죽는다.
  const targetNodeModules = path.join(
    context.packager.getResourcesDir(appOutDir), 'mcp-server', 'node_modules'
  )

  // mcp-server 는 extraResources 로 asar **밖**에 나간다. 그 node_modules 는 electron-builder 가
  // 안 옮겨주므로 여기서 복사한다. **없으면 조용히 넘어가지 않는다** — 넘어가면 의존성 없는
  // MCP 서버가 그대로 출하되고, 빌드는 초록인데 사용자 앱에서만 죽는다 (실측으로 그 상태였다).
  // codex 바이너리 가드와 **같은 강도**로 fail-closed 한다.
  const shipsMcpServer = fs.existsSync(path.join(context.packager.projectDir, 'mcp-server', 'package.json'))
  if (shipsMcpServer && !fs.existsSync(sourceNodeModules)) {
    throw new Error(
      '[afterPack] mcp-server/node_modules not found — the build would ship an MCP server with no ' +
      'dependencies. Run "npm run mcp:install" before packaging.'
    )
  }
  if (fs.existsSync(sourceNodeModules) && !fs.existsSync(targetNodeModules)) {
    console.log('[afterPack] Copying mcp-server/node_modules...')
    copyRecursive(sourceNodeModules, targetNodeModules)
    console.log('[afterPack] Done.')
  }

  // Drop the native binaries that don't belong to this arch (~460MB per app).
  const { Arch } = require('electron-builder')
  const archName = Arch[context.arch]
  const unpackedNodeModules = path.join(
    context.packager.getResourcesDir(appOutDir), 'app.asar.unpacked', 'node_modules'
  )
  const removed = pruneForeignPlatformPackages(unpackedNodeModules, {
    platform: context.electronPlatformName,
    arch: archName,
  })
  console.log(
    `[afterPack] ${context.electronPlatformName}/${archName}: pruned ${removed.length} foreign native package(s)` +
    (removed.length ? ` — ${removed.join(', ')}` : '')
  )

  // macOS: normalize non-ASCII filenames to NFD before code signing.
  if (context.electronPlatformName === 'darwin') {
    const resourcesDir = path.join(appOutDir, 'AutoFlowCut.app', 'Contents', 'Resources')
    if (fs.existsSync(resourcesDir)) {
      console.log('[afterPack] Normalizing non-ASCII filenames to NFD (HFS+ DMG compatibility)...')
      const count = normalizeFilenamesToNFD(resourcesDir)
      console.log(`[afterPack] Normalized ${count} filename(s).`)
    }
  }
}
