// codex / claude-agent-sdk 의 네이티브 바이너리는 arch 별 패키지로 쪼개져 있고,
// npm 은 호스트에 맞는 것만 설치한다 (os/cpu 필드로 걸러짐). 그래서 Apple Silicon 에서
// --x64 --arm64 를 함께 구우면 x64 앱에 arm64 바이너리가 실리고, Intel 맥에서
// resolveCodexExecutablePath() 가 MODULE_NOT_FOUND 로 죽는다 (빌드는 성공으로 보인다).
//
// 이 스크립트가 빠진 arch 패키지를 --force 로 채워 넣고,
// afterPack 의 pruneForeignPlatformPackages() 가 앱마다 필요한 것만 남긴다.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

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

function main() {
  const versions = {
    codex: installedVersion('@openai/codex'),
    agentSdk: installedVersion('@anthropic-ai/claude-agent-sdk'),
  }

  // mac 은 x64/arm64 둘 다 굽는다. 호스트가 어느 쪽이든 나머지 하나가 비어 있다.
  const specs = ['x64', 'arm64'].flatMap((arch) => resolveSpecs({ platform: 'darwin', arch, versions }))
  const missing = specs.filter(({ name }) => !fs.existsSync(path.join(rootDir, 'node_modules', name)))

  if (missing.length === 0) {
    console.log('[platform-binaries] all darwin arch packages present')
    return
  }

  console.log(`[platform-binaries] installing ${missing.length} missing package(s):`)
  for (const { name } of missing) console.log(`  - ${name}`)

  // --force: 호스트 cpu 와 안 맞는 패키지라 npm 이 EBADPLATFORM 으로 거부한다.
  // --no-save/--no-package-lock: 이건 빌드 전용 산출물이지 앱 의존성이 아니다.
  execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--force', ...missing.map((m) => m.spec)], {
    cwd: rootDir,
    stdio: 'inherit',
  })
}

exports.resolveSpecs = resolveSpecs
if (require.main === module) main()
