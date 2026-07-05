import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function packageJsonFor(specifier) {
  const parts = specifier.startsWith('@') ? specifier.split('/') : [specifier]
  const pkgPath = path.join(process.cwd(), 'node_modules', ...parts, 'package.json')
  if (!pkgPath) throw new Error(`package.json not found for ${specifier}`)
  return { pkgPath, pkg: JSON.parse(fs.readFileSync(pkgPath, 'utf8')) }
}

describe('codex-sdk package contract', () => {
  it('Codex export and thread factory methods exist without starting a run', async () => {
    const mod = await import('@openai/codex-sdk')
    expect(typeof mod.Codex).toBe('function')
    expect(typeof mod.Codex.prototype.startThread).toBe('function')
    expect(typeof mod.Codex.prototype.resumeThread).toBe('function')
  })

  it('installed SDK package declares or ships the wrapped Codex runtime', () => {
    const { pkg } = packageJsonFor('@openai/codex-sdk')
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.optionalDependencies || {}),
      ...(pkg.peerDependencies || {}),
      ...(pkg.devDependencies || {}),
    }
    const hasRuntimeDependency = Object.keys(deps).some((name) => name === '@openai/codex' || name.startsWith('@openai/codex-'))
    const localRuntimePath = path.join(process.cwd(), 'node_modules', '@openai', 'codex', 'package.json')
    expect(hasRuntimeDependency || fs.existsSync(localRuntimePath)).toBe(true)
  })

  it('app build leaves Codex SDK/runtime packages unpacked when packaged', () => {
    const appPkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    expect(appPkg.build?.asarUnpack || []).toContain('node_modules/@openai/codex*/**')
  })
})
