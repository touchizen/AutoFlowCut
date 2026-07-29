import { describe, it, expect, vi } from 'vitest'
import { spikeDir, dumpFilename, saveDump } from '../../electron/spike-chatgpt-storage.js'

const app = { getPath: (k) => (k === 'userData' ? '/UD' : '/x') }

describe('spike storage', () => {
  it('spikeDir under userData', () => {
    expect(spikeDir(app)).toBe('/UD/spike-chatgpt')
  })
  it('dumpFilename maps snapshot names', () => {
    expect(dumpFilename('result')).toBe('dom-dump-result.json')
  })
  it('saveDump creates dir recursively then writes JSON, returns path', () => {
    const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
    const p = saveDump(app, 'composer-empty', { a: 1 }, fs)
    expect(fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
    expect(p).toBe('/UD/spike-chatgpt/dom-dump-composer-empty.json')
    expect(fs.writeFileSync).toHaveBeenCalledWith(p, JSON.stringify({ a: 1 }, null, 2))
    // mkdir 이 write 보다 먼저
    expect(fs.mkdirSync.mock.invocationCallOrder[0]).toBeLessThan(fs.writeFileSync.mock.invocationCallOrder[0])
  })
})
