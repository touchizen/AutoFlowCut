import { describe, it, expect } from 'vitest'
import { probeDurationMs } from '../../../electron/story/audioProbe.js'

describe('probeDurationMs', () => {
  it('주입한 parseFile의 format.duration(초)을 ms로 반올림 반환', async () => {
    const fakeParse = async (p) => {
      expect(p).toBe('/x/s001-1.mp3')
      return { format: { duration: 2.3812 } }
    }
    const ms = await probeDurationMs('/x/s001-1.mp3', { parseFile: fakeParse })
    expect(ms).toBe(2381)
  })

  it('duration 누락 시 0 반환(측정 실패 안전값)', async () => {
    const ms = await probeDurationMs('/x/y.mp3', { parseFile: async () => ({ format: {} }) })
    expect(ms).toBe(0)
  })

  it('parseFile가 실패(reject)해도 0 반환 (측정 실패 안전값)', async () => {
    const ms = await probeDurationMs('/x/corrupt.mp3', { parseFile: async () => { throw new Error('bad file') } })
    expect(ms).toBe(0)
  })
})
