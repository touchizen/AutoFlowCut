#!/usr/bin/env node
// electron-builder afterAllArtifactBuild hook.
// Renames installer artifacts to embed package.json's buildNumber into the
// filename, which electron-builder's artifactName template does not expose
// as a first-class variable.
//
// Input:  AutoFlowCut-0.9.4-win-x64-Setup.exe
// Output: AutoFlowCut-0.9.4.160-win-x64-Setup.exe

const fs = require('fs')
const path = require('path')

module.exports = async function afterAllArtifactBuild(buildResult) {
  const pkg = require('../package.json')
  const bn = pkg.buildNumber
  if (!bn) {
    console.log('[afterAllArtifactBuild] no buildNumber — leaving artifact names as-is')
    return buildResult.artifactPaths
  }

  const newPaths = []
  for (const artifactPath of buildResult.artifactPaths) {
    const dir = path.dirname(artifactPath)
    const base = path.basename(artifactPath)
    // Match the x.y.z version segment sitting between the product name and
    // the platform suffix, and splice .<buildNumber> after it.
    const renamed = base.replace(
      /^(.+?-\d+\.\d+\.\d+)(-(?:win|mac|linux)-)/,
      `$1.${bn}$2`,
    )
    if (renamed === base) {
      newPaths.push(artifactPath)
      continue
    }
    const newPath = path.join(dir, renamed)
    try {
      if (fs.existsSync(newPath)) fs.unlinkSync(newPath)
      fs.renameSync(artifactPath, newPath)
      console.log(`[afterAllArtifactBuild] renamed → ${renamed}`)
      newPaths.push(newPath)
    } catch (err) {
      console.warn(`[afterAllArtifactBuild] rename failed for ${base}:`, err.message)
      newPaths.push(artifactPath)
    }
  }
  return newPaths
}
