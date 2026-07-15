import { describe, expect, it } from 'vitest'
import {
  LARGE_IMPORT_SCENE_THRESHOLD,
  inspectSceneImport,
} from '../../src/utils/importInspection'

function srtOf(count) {
  return Array.from({ length: count }, (_, index) => {
    const seconds = String(index % 60).padStart(2, '0')
    return `${index + 1}\n00:00:${seconds},000 --> 00:00:${seconds},500\nSubtitle ${index + 1}`
  }).join('\n\n')
}

describe('inspectSceneImport', () => {
  it('warns at the 1,000-scene threshold with the SRT-specific key', () => {
    expect(LARGE_IMPORT_SCENE_THRESHOLD).toBe(1000)
    expect(inspectSceneImport('srt', srtOf(1000))).toEqual({
      count: 1000,
      confirmKey: 'import.largeSrtConfirm',
    })
  })

  it('does not warn for 999 SRT subtitles', () => {
    expect(inspectSceneImport('srt', srtOf(999))).toEqual({
      count: 999,
      confirmKey: null,
    })
  })

  it('counts only non-empty TXT prompt lines', () => {
    const text = `${Array.from({ length: 1000 }, (_, i) => `Prompt ${i + 1}`).join('\n')}\n\n   \n`

    expect(inspectSceneImport('text', text)).toEqual({
      count: 1000,
      confirmKey: 'import.largeTextConfirm',
    })
  })

  it('counts legacy CSV data rows', () => {
    const csv = `prompt,subtitle\n${Array.from({ length: 1000 }, (_, i) => `Prompt ${i + 1},Subtitle ${i + 1}`).join('\n')}`

    expect(inspectSceneImport('csv', csv)).toEqual({
      count: 1000,
      confirmKey: 'import.largeCsvConfirm',
    })
  })

  it('counts new scene CSV groups instead of subtitle rows', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [
      `${i + 1},Prompt ${i + 1},First ${i + 1}`,
      `${i + 1},Prompt ${i + 1},Second ${i + 1}`,
    ]).flat()
    const csv = `scene,prompt,subtitle\n${rows.join('\n')}`

    expect(inspectSceneImport('csv', csv)).toEqual({
      count: 1000,
      confirmKey: 'import.largeCsvConfirm',
    })
  })

  it('never treats reference CSV rows as scenes', () => {
    const csv = `name,type,prompt\n${Array.from({ length: 1500 }, (_, i) => `Ref ${i + 1},character,Prompt`).join('\n')}`

    expect(inspectSceneImport('reference', csv)).toEqual({
      count: 0,
      confirmKey: null,
    })
  })
})
