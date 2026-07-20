import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appSource = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

describe('App video provider wiring', () => {
  it('D3: download-only retry preflight prefers persisted provider with scene fallback', () => {
    expect(appSource).toContain(
      "import { resolveSceneVideoProvider } from './utils/sceneProviderResolution'",
    )
    expect(appSource).toContain(
      "item.generationProvider || resolveSceneVideoProvider(item, settings, isFramePair ? 'i2v' : 't2v').provider",
    )
  })

  it('D3/D4: per-item media clear removes persisted provider and appliedInputs', () => {
    expect(appSource.match(/generationProvider: null, appliedInputs: null/g)).toHaveLength(2)
  })
})
