const path = require('path');
const fs = require('fs');

// .env 파일에서 환경변수 로드
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

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // CI 는 Apple 자격증명이 없다 (그리고 있어서도 안 된다). 패키징 스파이크는 **런타임**을 재지 공증을 재지 않는다.
  // ⚠️ **자격증명이 없다고 알아서 건너뛰면 안 된다** — 누가 .env 를 빠뜨린 채 릴리스를 만들고도 초록을 본다.
  //    공증 안 된 앱은 사용자 맥에서 안 열린다. 그래서 **명시적 스위치로만** 꺼진다.
  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('[notarize] SKIP_NOTARIZE=1 — 공증을 건너뛴다 (릴리스 빌드에서는 절대 쓰지 마라)');
    return;
  }

  const { notarize } = await import('@electron/notarize');

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });

  console.log('Notarization complete!');
};
