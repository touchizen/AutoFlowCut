import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const rootDir = path.resolve(__dirname, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const packageLock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'))

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

  test('ships scale/targetsize variants so electron-builder generates resources.pri', () => {
    // electron-builder (AppxTarget.isScaledAssetsProvided) only runs makepri.exe
    // — and therefore only enables MRT taskbar/Alt+Tab icon resolution — when at
    // least one asset name contains `.scale-` or `.targetsize-`. Without that the
    // Windows taskbar falls back to the default Electron icon.
    const appxAssetsDir = path.join(rootDir, packageJson.build.directories.buildResources, 'appx')
    const assets = fs.readdirSync(appxAssetsDir)
    expect(assets.some(name => name.includes('.scale-'))).toBe(true)
    expect(assets.some(name => name.includes('.targetsize-'))).toBe(true)
  })

  test('provides the unplated targetsize variants that drive the taskbar icon', () => {
    const appxAssetsDir = path.join(rootDir, packageJson.build.directories.buildResources, 'appx')
    // The taskbar / Start app-list / Alt+Tab icon for a packaged app resolves
    // from the unplated Square44x44Logo targetsize assets.
    for (const filename of [
      'Square44x44Logo.scale-200.png',
      'Square44x44Logo.targetsize-24_altform-unplated.png',
      'Square44x44Logo.targetsize-48_altform-unplated.png',
      'Square44x44Logo.targetsize-256_altform-unplated.png'
    ]) {
      expect(fs.existsSync(path.join(appxAssetsDir, filename)), `${filename} should exist`).toBe(true)
    }
  })

  test('provides large/small tile and splash assets with electron-builder filenames', () => {
    const appxAssetsDir = path.join(rootDir, packageJson.build.directories.buildResources, 'appx')
    // electron-builder references Square310x310Logo as LargeTile.png and
    // Square71x71Logo as SmallTile.png; SplashScreen avoids the default splash.
    for (const filename of ['LargeTile.png', 'SmallTile.png', 'SplashScreen.png']) {
      expect(fs.existsSync(path.join(appxAssetsDir, filename)), `${filename} should exist`).toBe(true)
    }
  })

  test('keeps package versions in sync while enabling APPX build-number bumps', () => {
    // Don't pin the literal version — that breaks on every release and says nothing.
    // The invariant worth holding is that package.json and the lockfile agree.
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageLock.version).toBe(packageJson.version)
    expect(packageLock.packages[''].version).toBe(packageJson.version)
    expect(packageJson.build.appx.setBuildNumber).toBe(true)
    expect(String(packageJson.buildNumber)).toMatch(/^[1-9]\d*$/)
  })
})
