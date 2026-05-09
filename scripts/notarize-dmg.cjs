/**
 * afterAllArtifactBuild hook
 *
 * electron-builder의 afterSign은 .app만 노타라이즈한다.
 * DMG는 .app이 패키징된 뒤에 만들어지므로, 별도로 노타라이즈 + 스테이플이 필요하다.
 * 이 훅은 모든 아티팩트가 빌드된 후 실행되어, .dmg 파일을 노타라이즈하고 ticket을 staple 한다.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// .env 로드
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...vals] = trimmed.split('=');
      if (key && vals.length > 0) {
        process.env[key.trim()] = vals.join('=').trim();
      }
    }
  }
}

module.exports = async function afterAllArtifactBuild(buildResult) {
  const dmgs = buildResult.artifactPaths.filter(p => p.endsWith('.dmg'));
  if (dmgs.length === 0) {
    return [];
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.warn('[notarize-dmg] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 누락 - DMG 노타라이즈 건너뜀');
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`\n[notarize-dmg] Submitting ${path.basename(dmg)} to Apple notary service...`);
    execSync(
      `xcrun notarytool submit "${dmg}" ` +
      `--apple-id "${APPLE_ID}" ` +
      `--password "${APPLE_APP_SPECIFIC_PASSWORD}" ` +
      `--team-id "${APPLE_TEAM_ID}" ` +
      `--wait`,
      { stdio: 'inherit' }
    );

    console.log(`[notarize-dmg] Stapling ticket to ${path.basename(dmg)}...`);
    execSync(`xcrun stapler staple "${dmg}"`, { stdio: 'inherit' });

    console.log(`[notarize-dmg] ✅ ${path.basename(dmg)} notarized + stapled`);
  }

  return [];
};
