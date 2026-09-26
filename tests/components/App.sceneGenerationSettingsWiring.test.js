import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appSource = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

describe('App per-scene generation settings wiring', () => {
  it('passes the full settings model to image batch and retry start options', () => {
    const occurrences = appSource.match(/generationSettings:\s*settings/g) || []
    expect(occurrences.length).toBeGreaterThanOrEqual(4)
  })

  it('copies owner scene generation overrides onto resolved I2V frame pairs', () => {
    expect(appSource).toContain('generation: ownerScene?.generation')
  })

  it('uses the mode-aware outer auth preflight on normal and tag-resume starts', () => {
    const occurrences = appSource.match(/runOuterStartAuthPreflight\(\{/g) || []
    expect(occurrences).toHaveLength(2)
  })
})
