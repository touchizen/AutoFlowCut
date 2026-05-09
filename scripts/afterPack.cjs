// electron-builder afterPack hook
// 1. Copies mcp-server/node_modules into the packaged resources
//    (extraResources auto-excludes node_modules)
// 2. Normalizes non-ASCII filenames to NFD form (macOS only) so that
//    codesign signatures remain valid after HFS+ DMG packaging
//    (HFS+ stores filenames as NFD; if the .app was signed with NFC
//    filenames, signature verification fails inside the DMG).

const fs = require('fs')
const path = require('path')

function copyRecursive(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

// Recursively rename files/dirs containing non-ASCII characters to NFD form.
// Walks bottom-up so directory renames don't invalidate child paths.
function normalizeFilenamesToNFD(dir) {
  let renamed = 0
  const stat = fs.statSync(dir)
  if (!stat.isDirectory()) return renamed

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const entryStat = fs.lstatSync(fullPath)
    if (entryStat.isDirectory()) {
      renamed += normalizeFilenamesToNFD(fullPath)
    }
    const nfd = entry.normalize('NFD')
    if (nfd !== entry) {
      const newPath = path.join(dir, nfd)
      fs.renameSync(fullPath, newPath)
      renamed++
    }
  }
  return renamed
}

exports.default = async function (context) {
  const appOutDir = context.appOutDir
  const sourceNodeModules = path.join(context.packager.projectDir, 'mcp-server', 'node_modules')
  const targetNodeModules = path.join(appOutDir, 'resources', 'mcp-server', 'node_modules')

  if (fs.existsSync(sourceNodeModules) && !fs.existsSync(targetNodeModules)) {
    console.log('[afterPack] Copying mcp-server/node_modules...')
    copyRecursive(sourceNodeModules, targetNodeModules)
    console.log('[afterPack] Done.')
  } else if (!fs.existsSync(sourceNodeModules)) {
    console.log('[afterPack] mcp-server/node_modules not found, skipping copy')
  }

  // macOS: normalize non-ASCII filenames to NFD before code signing.
  if (context.electronPlatformName === 'darwin') {
    const resourcesDir = path.join(appOutDir, 'AutoFlowCut.app', 'Contents', 'Resources')
    if (fs.existsSync(resourcesDir)) {
      console.log('[afterPack] Normalizing non-ASCII filenames to NFD (HFS+ DMG compatibility)...')
      const count = normalizeFilenamesToNFD(resourcesDir)
      console.log(`[afterPack] Normalized ${count} filename(s).`)
    }
  }
}
