import { it, expect, vi } from 'vitest'
import fs from 'node:fs'

it('useProjectData uses the canonical Flow-target predicate for every Flow binding branch', () => {
  const source = fs.readFileSync('src/hooks/useProjectData.js', 'utf8')
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  expect(source).toContain("sessionTarget = 'flow'")
  expect(source).toContain('const flowTargetActive = isFlowTarget({ mode, sessionTarget })')
  expect(executable).not.toMatch(/mode\s*===\s*['"]flow['"]/) // canonical selector only
  expect(executable).not.toMatch(/mode\s*!==\s*['"]flow['"]/) // canonical selector only
})
