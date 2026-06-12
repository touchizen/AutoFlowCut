import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const rootDir = path.resolve(__dirname, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))

describe('APPX tile assets', () => {
  test('uses branded tile assets instead of electron-builder sample assets', () => {
    expect(packageJson.build.directories.buildResources).toBe('assets')

    const appxAssetsDir = path.join(rootDir, packageJson.build.directories.buildResources, 'appx')
    expect(fs.existsSync(appxAssetsDir)).toBe(true)

    for (const filename of [
      'StoreLogo.png',
      'Square44x44Logo.png',
      'Square150x150Logo.png',
      'Wide310x150Logo.png'
    ]) {
      expect(fs.existsSync(path.join(appxAssetsDir, filename)), `${filename} should exist`).toBe(true)
    }
  })
})
