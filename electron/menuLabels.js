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
  },
  ko: {
    checkForUpdates: '업데이트 확인…',
    showModeSelector: '생성 모드 선택…',
    recentEmpty: '(없음)',
    github: 'GitHub 저장소',
    reportIssue: '이슈 보고',
  },
}

export function getMenuLabels(lang) {
  return LABELS[lang] || LABELS.en
}

export default getMenuLabels
