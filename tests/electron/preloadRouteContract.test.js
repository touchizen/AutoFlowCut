// tests/electron/preloadRouteContract.test.js
// @vitest-environment node
import { it, expect } from 'vitest'
import fs from 'node:fs'

it('preload exposes additive setRoute and keeps setMode', () => {
  const source = fs.readFileSync('electron/preload.js', 'utf8')
  expect(source).toContain("setRoute: (params) => ipcRenderer.invoke('route:set', params)")
  expect(source).toContain("setMode: (params) => ipcRenderer.invoke('mode:set', params)")
})
