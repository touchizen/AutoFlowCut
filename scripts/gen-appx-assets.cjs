#!/usr/bin/env node
/**
 * Generate the complete branded APPX/MSIX visual-asset set into assets/appx/.
 *
 * Why this exists
 * ---------------
 * electron-builder only injects its own (Electron-logo) sample assets for four
 * base tiles when they are missing: StoreLogo / Square150x150Logo /
 * Square44x44Logo / Wide310x150Logo. Those four are already branded, so the
 * Start tiles look correct — but the Windows TASKBAR / Alt+Tab / Start app-list
 * icon for a packaged app is resolved from the `Square44x44Logo` *targetsize*
 * MRT variants (`*.targetsize-NN_altform-unplated.png`) via `resources.pri`.
 *
 * electron-builder only generates `resources.pri` (via makepri.exe) when at
 * least one user asset name contains `.scale-` or `.targetsize-`
 * (isScaledAssetsProvided in app-builder-lib/out/targets/AppxTarget.js). With no
 * such variants present, PRI generation is skipped entirely and Windows falls
 * back to the default Electron icon in the taskbar.
 *
 * So: emitting the full scale/targetsize variant set here makes electron-builder
 * (a) map every variant into the package and (b) auto-generate resources.pri —
 * after which scripts/buildappx.bat's makeappx step packs the complete, branded
 * set. No build-pipeline change is required.
 *
 * electron-builder filename conventions (AppxTarget.js):
 *   Square310x310Logo  -> LargeTile.png
 *   Square71x71Logo    -> SmallTile.png
 *   SplashScreen       -> SplashScreen.png
 * The four base tiles keep their literal names.
 *
 * Run: npm run make-appx-assets   (or: node scripts/gen-appx-assets.cjs)
 */
const path = require('path')
const fs = require('fs')
// sharp is not a direct dependency; reuse the copy vendored under docs tooling.
const sharp = require('../docs/ms-store/screenshots/en/node_modules/sharp')

const SRC = path.join(__dirname, '..', 'assets', 'icon.png') // 512x512 RGBA master
const OUT = path.join(__dirname, '..', 'assets', 'appx')

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/** Scale percentages Windows requests for tiles. */
const SCALES = [100, 125, 150, 200, 400]
/** Target sizes Windows requests for the 44x44 app-list / taskbar icon. */
const TARGET_SIZES = [16, 24, 32, 48, 256]

/** Render the square master into a WxH transparent canvas (icon centered). */
async function render(width, height, outName) {
  const out = path.join(OUT, outName)
  await sharp(SRC)
    .resize(width, height, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toFile(out)
  return outName
}

/**
 * Emit `${base}.png` plus its scale-* variants for a square or rectangular tile.
 * baseW/baseH are the 100% (scale-100) pixel dimensions.
 */
async function tile(base, baseW, baseH, { scales = SCALES } = {}) {
  const written = []
  // Neutral fallback referenced directly by the manifest.
  written.push(await render(baseW, baseH, `${base}.png`))
  for (const s of scales) {
    const w = Math.round((baseW * s) / 100)
    const h = Math.round((baseH * s) / 100)
    written.push(await render(w, h, `${base}.scale-${s}.png`))
  }
  return written
}

/**
 * Emit the Square44x44Logo targetsize variants — both plated and the
 * altform-unplated forms that drive the taskbar / Alt+Tab / Start list icon.
 */
async function targetSizeVariants(base) {
  const written = []
  for (const t of TARGET_SIZES) {
    written.push(await render(t, t, `${base}.targetsize-${t}.png`))
    written.push(await render(t, t, `${base}.targetsize-${t}_altform-unplated.png`))
    written.push(await render(t, t, `${base}.targetsize-${t}_altform-lightunplated.png`))
  }
  return written
}

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`source icon not found: ${SRC}`)
  }
  fs.mkdirSync(OUT, { recursive: true })

  const written = []

  // Four base tiles (electron-builder vendor-fallback set) + scale variants.
  written.push(...(await tile('StoreLogo', 50, 50)))
  written.push(...(await tile('Square44x44Logo', 44, 44)))
  written.push(...(await tile('Square150x150Logo', 150, 150)))
  written.push(...(await tile('Wide310x150Logo', 310, 150)))

  // Optional tiles, using electron-builder's expected filenames.
  written.push(...(await tile('SmallTile', 71, 71)))            // Square71x71Logo
  // Large tile: cap at scale-200 to avoid heavy upscaling past the 512 master.
  written.push(...(await tile('LargeTile', 310, 310, { scales: [100, 125, 150, 200] }))) // Square310x310Logo
  written.push(...(await tile('SplashScreen', 620, 300, { scales: [100, 125, 150, 200] })))

  // Taskbar / Alt+Tab / Start app-list icon variants.
  written.push(...(await targetSizeVariants('Square44x44Logo')))

  for (const name of written) console.log(`✓ ${name}`)
  console.log(`\nGenerated ${written.length} APPX asset files → assets/appx/`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
