import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appSource = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

describe('App CSV generation settings wiring', () => {
  it('G1/G3: CSV imports pass current generation settings into parseFromCSV', () => {
    expect(appSource).toContain(
      'parseFromCSV(text, settings.defaultDuration, framePairs, { generationSettings: settings })',
    )
    expect(appSource).toContain('? importSceneCSV(csvPromptToVideoT2V(content))')
    expect(appSource).toContain(': importSceneCSV(content)')
  })
})
