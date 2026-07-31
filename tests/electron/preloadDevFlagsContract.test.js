// @vitest-environment node
import { expect, it } from 'vitest'
import fs from 'node:fs'

it('preload exposes the main-owned dev flags bridge', () => {
  const source = fs.readFileSync('electron/preload.js', 'utf8')
  expect(source).toContain("getDevFlags: () => ipcRenderer.invoke('app:get-dev-flags')")
})
