import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

function rendererFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return rendererFiles(path)
    return /\.(?:js|jsx)$/.test(entry.name) ? [path] : []
  })
}

describe('flowCharacterCoordinator renderer wiring', () => {
  it('composer refresh IPC 는 coordinator helper 밖에서 직접 호출하지 않는다', () => {
    const srcRoot = resolve(process.cwd(), 'src')
    const coordinatorPath = join(srcRoot, 'utils/flowCharacterCoordinator.js')
    const offenders = rendererFiles(srcRoot)
      .filter(path => path !== coordinatorPath)
      .filter(path => readFileSync(path, 'utf8').includes('refreshFlowComposer'))
      .map(path => relative(srcRoot, path))

    expect(offenders).toEqual([])
  })
})
