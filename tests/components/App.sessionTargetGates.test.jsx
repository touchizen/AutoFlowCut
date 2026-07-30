import { it, expect } from 'vitest'
import fs from 'node:fs'

it('App passes sessionTarget to every P1 Flow gate and keeps legacy main IPC calls', () => {
  const source = fs.readFileSync('src/App.jsx', 'utf8')
  expect(source).toContain("const { mode, sessionTarget = 'flow', clearMode } = useMode()")
  expect(source).toContain('useAvailableModels(genAPI, mode, sessionTarget)')
  expect(source).toContain('const flowTargetActive = isFlowTarget({ mode, sessionTarget })')
  expect((source.match(/runOuterStartAuthPreflight\(\{[\s\S]{0,180}?sessionTarget[\s\S]{0,180}?\}\)/g) || []))
    .toHaveLength(2)
  expect(source).toContain("window.electronAPI?.setMode?.({ mode })")
  expect(source).not.toContain('window.electronAPI?.setRoute?.(')
})
