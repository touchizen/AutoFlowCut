#!/usr/bin/env node
// Pre-build hook: stamp package.json with a deterministic build number
// derived from the git commit count of HEAD. Same HEAD → same build number,
// independent of machine. Written to package.json `buildNumber` so
// electron-builder's artifactName template can use ${buildNumber}.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

let buildNumber;
try {
  buildNumber = parseInt(
    execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim(),
    10,
  );
} catch (err) {
  console.warn('[bump-build] git unavailable — falling back to 0');
  buildNumber = 0;
}

if (pkg.buildNumber === buildNumber) {
  console.log(`[bump-build] already at ${pkg.version}.${buildNumber} — no change`);
  process.exit(0);
}

pkg.buildNumber = buildNumber;

// Preserve original formatting: 2-space indent + trailing newline.
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`[bump-build] stamped ${pkg.version}.${buildNumber}`);
