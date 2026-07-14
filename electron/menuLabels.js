/**
 * 네이티브 앱 메뉴의 커스텀(비 role) 항목 라벨 — 언어별.
 *
 * 메뉴는 main 프로세스에서 만들어져 렌더러의 useI18n 을 못 쓴다. 렌더러가 현재 언어를
 * IPC(app:set-locale)로 push 하면 main 이 currentLang 으로 메뉴를 다시 그린다.
 * role 기반 항목(reload/zoom/quit 등)은 Electron 이 OS 언어로 자동 현지화하므로 제외.
 *
 * 지원 외 언어는 영어로 폴백 (기본 = en).
 */
const LABELS = {
  // File/Edit/View 등 구조 라벨과 'New Project'/'Recent Projects' 는 기존대로 영문 유지.
  // 원래 한국어로 하드코딩돼 있던 커스텀 항목만 현지화한다.
  en: {
    checkForUpdates: 'Check for Updates…',
    showModeSelector: 'Choose Generation Mode…',
    recentEmpty: '(none)',
    github: 'GitHub Repository',
    reportIssue: 'Report an Issue',
    updateTitle: 'AutoFlowCut Update',
    updateAvailable: 'A new version, {version}, is available.',
    currentVersion: 'Current version: {version}',
    downloadPrompt: 'Download it now?',
    downloadNow: 'Download Now',
    later: 'Later',
    updateDownloadFailed: 'Could not download the update.',
    ok: 'OK',
    latestVersion: 'You are using the latest version.',
    updateCheckFailed: 'Could not check for updates.',
    updateReady: 'Version {version} is ready to install.',
    restartInstallPrompt: 'Restart now to install it?\n(If you choose "Later", it will install automatically when the app closes.)',
    restartNow: 'Restart Now',
    storeVersion: 'This is the Microsoft Store version.',
    storeUpdates: 'Updates are managed automatically by the Microsoft Store.',
    devUpdateUnavailable: 'Update checks are not available in development mode.',
    updateAlreadyDownloaded: 'The update is already downloaded. Install it now?',
  },
  ko: {
    checkForUpdates: '업데이트 확인…',
    showModeSelector: '생성 모드 선택…',
    recentEmpty: '(없음)',
    github: 'GitHub 저장소',
    reportIssue: '이슈 보고',
    updateTitle: 'AutoFlowCut 업데이트',
    updateAvailable: '새 버전 {version}이(가) 있습니다.',
    currentVersion: '현재 버전: {version}',
    downloadPrompt: '지금 다운로드하시겠습니까?',
    downloadNow: '지금 다운로드',
    later: '나중에',
    updateDownloadFailed: '업데이트 다운로드에 실패했습니다.',
    ok: '확인',
    latestVersion: '최신 버전을 사용 중입니다.',
    updateCheckFailed: '업데이트 확인에 실패했습니다.',
    updateReady: '새 버전 {version}이(가) 설치 준비되었습니다.',
    restartInstallPrompt: '지금 재시작하여 설치하시겠습니까?\n("나중에"를 선택하면 다음 앱 종료 시 자동 설치됩니다.)',
    restartNow: '지금 재시작',
    storeVersion: 'Microsoft Store 버전입니다.',
    storeUpdates: '업데이트는 Microsoft Store에서 자동으로 처리됩니다.',
    devUpdateUnavailable: '개발 모드에서는 업데이트 확인을 사용할 수 없습니다.',
    updateAlreadyDownloaded: '업데이트가 이미 다운로드되었습니다. 지금 설치하시겠습니까?',
  },
}

export function getMenuLabels(lang) {
  return LABELS[lang] || LABELS.en
}

export default getMenuLabels
