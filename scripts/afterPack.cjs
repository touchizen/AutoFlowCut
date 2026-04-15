// electron-builder afterPack hook
// Copies mcp-server/node_modules into the packaged resources
// because extraResources auto-excludes node_modules

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

exports.default = async function (context) {
  const appOutDir = context.appOutDir
  const sourceNodeModules = path.join(context.packager.projectDir, 'mcp-server', 'node_modules')
  const targetNodeModules = path.join(appOutDir, 'resources', 'mcp-server', 'node_modules')

  if (!fs.existsSync(sourceNodeModules)) {
    console.log('[afterPack] mcp-server/node_modules not found, skipping')
    return
  }

  if (fs.existsSync(targetNodeModules)) {
    console.log('[afterPack] Target node_modules already exists, skipping')
    return
  }

  console.log('[afterPack] Copying mcp-server/node_modules...')
  copyRecursive(sourceNodeModules, targetNodeModules)
  console.log('[afterPack] Done.')
}
