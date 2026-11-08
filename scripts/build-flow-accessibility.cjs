// Ship a universal helper; installed clients never need Xcode or a Python runtime.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
fs.mkdirSync('dist-electron/flow-native', { recursive: true })
fs.copyFileSync('native/flow/uia.ps1', 'dist-electron/flow-native/uia.ps1')
if (process.platform === 'darwin') {
  execFileSync(
    '/usr/bin/xcrun',
    [
      'clang',
      '-arch',
      'arm64',
      '-arch',
      'x86_64',
      '-mmacosx-version-min=11.0',
      '-fobjc-arc',
      '-O2',
      '-framework',
      'Cocoa',
      '-framework',
      'ApplicationServices',
      'native/flow/ax.m',
      '-o',
      'dist-electron/flow-native/ax',
    ],
    { stdio: 'inherit' },
  )
}
