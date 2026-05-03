#!/usr/bin/env node
/**
 * Dev 모드에서 macOS 메뉴바 bold 텍스트가 "Electron" 대신 "AutoFlowCut"으로
 * 보이게 한다. plist만 고치는 걸로는 부족하고, .app 폴더명 + 바이너리 이름 +
 * electron 패키지의 path.txt까지 다 바꿔야 함.
 *
 * postinstall + predev 에서 자동 실행. 패키지 빌드는 electron-builder가
 * 별도 plist를 생성하므로 영향 없음.
 *
 * AutoMovie의 동일 스크립트를 참고해 만들었음.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const APP_NAME = 'AutoFlowCut'

if (process.platform !== 'darwin') {
  // 메뉴바 bold 동작은 macOS 전용 — 다른 OS는 skip
  process.exit(0)
}

const distDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist')
const oldAppDir = path.join(distDir, 'Electron.app')
const newAppDir = path.join(distDir, `${APP_NAME}.app`)

// 이미 rename된 경우 → newAppDir 사용. 아니면 oldAppDir 사용.
const appDir = fs.existsSync(newAppDir) ? newAppDir : oldAppDir

if (!fs.existsSync(appDir)) {
  console.log('[patch-electron-name] Electron.app not found, skipping.')
  process.exit(0)
}

try {
  const plistPath = path.join(appDir, 'Contents', 'Info.plist')

  // package.json에서 version + buildNumber 읽기 (About 패널 표시용)
  let APP_VERSION = ''
  let BUILD_NUMBER = ''
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
    APP_VERSION = String(pkg.version || '')
    BUILD_NUMBER = pkg.buildNumber != null ? String(pkg.buildNumber) : ''
  } catch {}

  // 1. Info.plist 수정 (PlistBuddy 사용 — Electron의 binary plist도 OK)
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "${plistPath}"`)
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "${plistPath}"`)
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${APP_NAME}" "${plistPath}"`)
  // macOS About 패널이 자동으로 "버전 X.Y.Z (BUILD)" 형식으로 보여주려면
  // CFBundleShortVersionString = X.Y.Z, CFBundleVersion = BUILD 로 분리되어야 함
  if (APP_VERSION) {
    execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "${plistPath}"`)
  }
  if (BUILD_NUMBER) {
    execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUILD_NUMBER}" "${plistPath}"`)
  }

  // 2. 실행 바이너리 이름 변경 (Electron → AutoFlowCut)
  const oldBin = path.join(appDir, 'Contents', 'MacOS', 'Electron')
  const newBin = path.join(appDir, 'Contents', 'MacOS', APP_NAME)
  if (fs.existsSync(oldBin) && !fs.existsSync(newBin)) {
    fs.renameSync(oldBin, newBin)
  }

  // 3. .app 폴더 이름 변경 (Electron.app → AutoFlowCut.app)
  if (fs.existsSync(oldAppDir) && oldAppDir !== newAppDir) {
    fs.renameSync(oldAppDir, newAppDir)
  }

  // 4. electron npm 패키지의 path.txt 업데이트 (어느 .app/바이너리를 실행할지 결정)
  const electronPathFile = path.join(distDir, '..', 'path.txt')
  if (fs.existsSync(electronPathFile)) {
    const content = fs.readFileSync(electronPathFile, 'utf-8')
    const updated = content
      .replace(/Electron\.app/g, `${APP_NAME}.app`)
      .replace(/MacOS\/Electron/g, `MacOS/${APP_NAME}`)
    if (updated !== content) {
      fs.writeFileSync(electronPathFile, updated)
    }
  }

  // 5. 번들 아이콘 교체 (.app 안의 electron.icns → 우리 아이콘)
  //    plist의 CFBundleIconFile은 그대로 'electron.icns' 사용 (파일 내용만 교체)
  const ourIcon = path.join(__dirname, '..', 'assets', 'icon.icns')
  const bundleIcon = path.join(appDir, 'Contents', 'Resources', 'electron.icns')
  if (fs.existsSync(ourIcon) && fs.existsSync(bundleIcon)) {
    const ourBuf = fs.readFileSync(ourIcon)
    const curBuf = fs.readFileSync(bundleIcon)
    if (!ourBuf.equals(curBuf)) {
      fs.writeFileSync(bundleIcon, ourBuf)
    }
  }

  console.log(`[patch-electron-name] Electron.app → ${APP_NAME}.app (plist + binary + bundle + path.txt + icon)`)
} catch (err) {
  console.warn('[patch-electron-name] Failed:', err.message)
}
