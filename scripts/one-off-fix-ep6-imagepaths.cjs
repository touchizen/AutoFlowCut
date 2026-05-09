#!/usr/bin/env node
/**
 * One-off fix for project.json image-path data — clean stale image paths.
 *
 * Repairs the same scene-image bugs that loadProjectWithResources fixes at load
 * time, but applied directly to the on-disk project.json so the data is clean
 * even before the user opens the project.
 *
 * Loader parity (src/hooks/useProjectData.js): a scene is downgraded to
 * `errorKind: 'image-missing'` ONLY when its file is missing AND one of:
 *   a) scene.imagePath was set (stale path — cross-project leak / file deleted)
 *   b) scene.errorKind === 'image-missing' already (re-flag for i18n hygiene)
 *   c) scene.status === 'done' but no image/imagePath at all (false-Done)
 *
 * Pending scenes (not yet generated, no path, no image) are NEVER touched —
 * the absence of a file is normal for them.
 *
 * Safety:
 *   - Defaults to dry-run. Pass --write to actually modify project.json.
 *   - On --write, creates a timestamped backup `project.json.bak.<timestamp>`
 *     in the same folder before writing.
 *
 * Usage:
 *   node scripts/one-off-fix-ep6-imagepaths.cjs                              # dry-run, default project
 *   node scripts/one-off-fix-ep6-imagepaths.cjs --write                       # apply, default project
 *   node scripts/one-off-fix-ep6-imagepaths.cjs "C:/path/other_project"       # dry-run, custom project
 *   node scripts/one-off-fix-ep6-imagepaths.cjs "C:/path/other_project" --write
 */

const fs = require('fs')
const path = require('path')

const DEFAULT_PROJECT_DIR =
  'C:\\Users\\tuxxo\\OneDrive\\문서\\AutoFlowCut\\ep6_babo_yeonggam'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const PROJECT_DIR =
  args.find((a) => !a.startsWith('--')) || DEFAULT_PROJECT_DIR
const PROJECT_JSON = path.join(PROJECT_DIR, 'project.json')
const SCENES_DIR = path.join(PROJECT_DIR, 'scenes')

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const ERROR_KIND_IMAGE_MISSING = 'image-missing'

if (!fs.existsSync(PROJECT_JSON)) {
  console.error('[fix] project.json not found:', PROJECT_JSON)
  process.exit(1)
}
if (!fs.existsSync(SCENES_DIR)) {
  console.error('[fix] scenes/ folder not found:', SCENES_DIR)
  process.exit(1)
}

const sceneFiles = new Set(fs.readdirSync(SCENES_DIR))

function findSceneFile(sceneId) {
  for (const ext of IMAGE_EXTS) {
    if (sceneFiles.has(sceneId + ext)) return path.join(SCENES_DIR, sceneId + ext)
  }
  return null
}

const json = JSON.parse(fs.readFileSync(PROJECT_JSON, 'utf8'))
const scenes = json.scenes || []

let healed = 0
let staleErrorKindRefreshed = 0
let errorMessageStripped = 0
let pendingUntouched = 0
let alreadyOk = 0
let unchanged = 0

for (const scene of scenes) {
  if (!scene.id) {
    unchanged++
    continue
  }

  const filePath = findSceneFile(scene.id)
  const fileExists = !!filePath

  if (fileExists) {
    // Loader will remap path on next load. Strip leftover localized error string
    // if the scene is still flagged as missing-image but the file is back —
    // keep i18n contract (only the kind is persisted).
    if (scene.errorKind === ERROR_KIND_IMAGE_MISSING && scene.error) {
      scene.error = null
      errorMessageStripped++
    }
    alreadyOk++
    continue
  }

  // File is missing. Mirror loader predicate exactly — only downgrade scenes
  // that already had media (or were claiming 'done'). Pending scenes are left
  // alone because for them, no file is the natural state.
  const isMissingImageCase =
    !!scene.imagePath ||
    (scene.status === 'error' && scene.errorKind === ERROR_KIND_IMAGE_MISSING) ||
    (scene.status === 'done' && !scene.image)

  if (!isMissingImageCase) {
    pendingUntouched++
    continue
  }

  const wasFlagged = scene.errorKind === ERROR_KIND_IMAGE_MISSING
  scene.image = null
  scene.imagePath = null
  scene.status = 'error'
  scene.error = null
  scene.errorKind = ERROR_KIND_IMAGE_MISSING
  if (wasFlagged) staleErrorKindRefreshed++
  else healed++
}

console.log('[fix] project          :', PROJECT_DIR)
console.log('[fix] mode             :', WRITE ? 'WRITE (will modify file)' : 'DRY-RUN (no changes)')
console.log('[fix] total scenes     :', scenes.length)
console.log('[fix] healed (newly fl):', healed)
console.log('[fix] kind re-flagged  :', staleErrorKindRefreshed)
console.log('[fix] error str stripped:', errorMessageStripped)
console.log('[fix] pending untouched:', pendingUntouched)
console.log('[fix] already ok       :', alreadyOk)
console.log('[fix] unchanged (no id):', unchanged)

if (!WRITE) {
  console.log('[fix] dry-run — pass --write to apply changes')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = path.join(PROJECT_DIR, `project.json.bak.${stamp}`)
fs.copyFileSync(PROJECT_JSON, backupPath)
fs.writeFileSync(PROJECT_JSON, JSON.stringify(json, null, 2), 'utf8')

console.log('[fix] backup written   :', backupPath)
console.log('[fix] file written     :', PROJECT_JSON)
