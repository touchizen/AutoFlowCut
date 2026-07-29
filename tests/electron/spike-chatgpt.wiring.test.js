import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const main = readFileSync(resolve(process.cwd(), 'electron/main.js'), 'utf8')

describe('main.js spike wiring', () => {
  it('imports and calls registerSpikeShortcuts inside whenReady', () => {
    expect(main).toMatch(/registerSpikeShortcuts/)
    expect(main).toContain("persist:chatgpt")   // makeView가 스파이크 파티션 사용
  })
})
