/**
 * 한국어 문자열
 */

export default {
  // 앱 이름
  appName: 'AutoCraft Studio',
  
  // 헤더
  header: {
    export: 'CapCut 내보내기',
    settings: '설정',
    login: '로그인',
    authenticated: '인증됨',
    checking: '확인 중...',
    language: '언어',
  },
  
  // 시작 화면
  welcome: {
    title: 'AutoCraft Studio',
    description: 'Flow AI로 이미지/비디오를 생성하고\nCapCut 프로젝트로 내보내세요',
    openFlow: 'Flow 열기',
    waitingLogin: '로그인 대기 중...',
    loginHint: 'Flow에서 로그인하면 자동으로 진입합니다',
    checking: '인증 확인 중...',
  },
  
  // 탭
  tabs: {
    text: '프롬프트',
    list: '씬목록',
    import: '가져오기',
    references: '레퍼런스',
  },
  
  // 프롬프트 입력
  prompt: {
    placeholder: `프롬프트를 입력하세요 (줄바꿈으로 구분)

예시:
A king sitting on a golden throne in a palace
The queen enters the throne room gracefully
The king and queen discuss important matters`,
    count: '{count}개 프롬프트',
    tip: 'Tip: 각 줄이 하나의 씬이 됩니다',
  },
  
  // 씬 목록
  sceneList: {
    empty: '프롬프트가 없습니다.',
    emptyHint: '텍스트 탭에서 입력하거나 파일을 Import 하세요.',
    total: '총 {count}개 씬 / {duration}',
    addScene: '+ 씬 추가',
    clearAll: '전체 삭제',
    clearConfirm: '모든 씬을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.',
    time: '시간(초)',
    promptCol: '프롬프트 / 자막',
    tags: '매칭 태그',
    image: '이미지',
    character: '캐릭터',
    background: '배경',
    style: '스타일',
    durationTitle: '지속시간 (초)',
    characterTitle: '캐릭터 태그 (레퍼런스 매칭용)',
    backgroundTitle: '배경 태그',
    styleTitle: '스타일 태그',
    tagLegend: '레퍼런스 매칭:',
    tagMatched: '있음',
    tagUnmatched: '없음',
  },
  
  // 레퍼런스
  reference: {
    title: '레퍼런스 이미지',
    hint: '씬의 태그와 이름이 일치하면 자동 적용됩니다',
    hintCollapsed: '클릭하여 펼치기',
    add: '추가',
    upload: '클릭하여 업로드',
    uploading: '업로드 중...',
    uploadedToFlow: 'Flow에 업로드됨',
    name: '이름',
    namePlaceholder: '이름 (태그 매칭용)',
    character: '캐릭터',
    scene: '배경',
    style: '스타일',
    generate: '생성',
    generating: '생성 중...',
    generateAll: '일괄 생성',
    detail: '상세',
    type: '타입',
    prompt: '프롬프트',
    promptPlaceholder: '이미지 생성용 프롬프트를 입력하세요',
    clickToEdit: '클릭하여 편집',
    clickToChange: '클릭하여 변경',
    caption: 'Caption',
    captionHelp: 'Flow가 자동 생성한 이미지 설명입니다. 이미지 생성 시 함께 전달되어 품질 향상에 도움을 줍니다.',
    selectStyle: '스타일 선택',
    styleTextOnly: '스타일은 이미지 없이 프롬프트만 사용됩니다',
    autoFilled: '자동 입력',
    history: '기록',
    regenerate: '재생성',
    clearAll: '전체 삭제',
    clearConfirm: '모든 레퍼런스를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.',
  },
  
  // 액션 버튼
  actions: {
    start: '생성 시작',
    pause: '일시정지',
    resume: '재개',
    stop: '중지',
    retryErrors: '에러 재시도',
    retryOne: '재시도',
    exportCapcut: 'CapCut 내보내기',
    scenesComplete: '{done}/{total} 씬 완료',
  },

  // 설정 (화면비/Seed/방식은 Flow UI에서 직접 설정)
  config: {
  },

  // 상태
  status: {
    ready: '준비',
    running: '실행 중',
    paused: '일시정지',
    done: '완료!',
    stopped: '중지됨',
    error: '오류',
    pending: '대기',
    generating: '생성중',
    checkingAuth: '인증 확인 중...',
    checkingFolder: '작업 폴더 확인 중...',
    uploadingRefs: '레퍼런스 업로드 중... ({current}/{total})',
    generatingScene: '생성 중: {ids} ({current}/{total})',
    retrying: '재시도 중: {id} ({count}/{max})',
    loginRequired: '로그인 필요 - labs.google 탭을 열어주세요',
    folderNotSet: '설정에서 작업 폴더를 선택하세요',
    folderPermission: '작업 폴더 권한이 필요합니다',
    folderPermissionStopped: '작업 폴더 권한이 필요합니다. 생성 중지됨.',
    authErrorStopped: '인증 오류로 중단되었습니다. Flow에 로그인 후 다시 시도해주세요.',
    stopping: '중지 중...',
    resuming: '재개...',
  },
  
  // 결과 테이블
  results: {
    empty: '프롬프트를 입력하고 생성을 시작하세요',
    prompt: '프롬프트',
    image: '이미지',
    status: '상태',
  },
  
  // 설정
  settings: {
    title: '설정',
    save: '저장',
    cancel: '취소',
    
    // 탭
    tabStorage: '저장',
    tabGeneration: '생성',
    tabScene: '씬',
    tabDisplay: '화면',
    
    // 이미지 저장
    imageSave: '이미지 저장',
    saveMode: '저장 방식',
    saveAuto: '자동',
    saveAutoDesc: '작업폴더에 저장',
    saveFlow: 'Flow',
    saveFlowDesc: '로컬 저장 안함',
    workFolder: '작업 폴더',
    selectFolder: '폴더 선택',
    changeFolder: '폴더 변경',
    requestPermission: '권한 요청',
    folderNotSelected: '폴더 미선택',
    folderDeleted: '폴더가 삭제됨',
    folderDeletedDesc: '작업 폴더가 삭제되었거나 이동되었습니다. 다시 선택해주세요.',
    folderRequired: '작업 폴더를 선택하면 이미지 저장 및 프로젝트 관리가 가능합니다',
    permissionGranted: '권한 있음',
    permissionNeeded: '권한 필요',
    // 프로젝트
    project: '프로젝트',
    projectNote: '이미지, 레퍼런스 등이 프로젝트 폴더에 저장됩니다',
    noProjects: '프로젝트 없음',
    createProject: '새 프로젝트',
    projectNamePlaceholder: '프로젝트명 (비우면 자동 생성)',
    create: '생성',
    renameProject: '이름 변경',
    invalidProjectName: '폴더명에 사용할 수 없는 문자가 포함되어 있습니다',
    projectExists: '같은 이름의 프로젝트가 이미 존재합니다',
    renameFailed: '이름 변경 실패',
    
    // 이미지 생성 (화면비/방식 등은 Flow UI에서 직접 설정)
    generationInfo: '이미지 생성은 Flow UI 자동화로 동작합니다. 화면비 등 옵션은 Flow 패널에서 직접 설정하세요.',
    
    // 씬 설정
    sceneSettings: '씬 설정',
    defaultDuration: '기본 지속시간 (초)',
    seconds: '',
    projectName: '프로젝트 이름',
    exportThreshold: '내보내기 버튼 표시 완료율',
    exportThresholdHint: '씬 생성 완료 후, 이 비율 이상 성공 시 내보내기 버튼 표시',

    // 화면 레이아웃
    layoutMode: '레이아웃',
    layoutTab: '탭 전환',
    layoutSplitLeft: 'Flow 왼쪽',
    layoutSplitRight: 'Flow 오른쪽',
    layoutSplitTop: 'Flow 상단',
    layoutSplitBottom: 'Flow 하단',
    splitRatio: 'Flow 비율',
    layoutDomHint: 'DOM 모드에서는 Flow 화면이 필요하여 탭 모드를 사용할 수 없습니다.',
  },
  
  // Import 모달
  import: {
    title: '파일 불러오기',
    close: '닫기',
    selectFormat: '파일 형식을 선택하세요',
    textTab: '텍스트',
    csvTab: 'CSV',
    srtTab: 'SRT',
    textTitle: '프롬프트 Text 파일',
    textDesc: '줄바꿈으로 구분된 프롬프트',
    textHint: '각 줄 = 하나의 씬',
    csvTitle: '씬 CSV 파일',
    csvDesc: '구조화된 씬 데이터',
    csvExample: 'CSV 예시',
    srtTitle: '자막 SRT 파일',
    srtDesc: '자막 파일로 씬 자동 생성',
    srtHint: '타임코드 + 자막 → 프롬프트',
    refTitle: '레퍼런스 CSV 파일',
    refDesc: '캐릭터/배경/스타일 정의',
    refExample: '레퍼런스 예시',
    textPlaceholder: '프롬프트를 붙여넣기 (줄바꿈으로 구분)',
    csvPlaceholder: 'CSV 내용 붙여넣기\n\n필수: prompt\n선택: subtitle, characters, scene_tag, style_tag, duration',
    srtPlaceholder: 'SRT 자막 내용 붙여넣기',
    fileSelect: '또는 파일 선택',
    import: 'Import',
    // 가이드 링크 버튼
    guide: '가이드',
    sample: '샘플',
    aiPrompt: 'AI 생성',
    guideTooltip: '사용법 가이드 보기',
    sampleTooltip: '샘플 파일 다운로드',
    aiPromptTooltip: 'AI로 파일 생성하는 방법',
    wrongTypeReference: '이 파일은 레퍼런스 CSV입니다.\n레퍼런스로 import할까요?',
    wrongTypeScene: '이 파일은 씬 CSV입니다.\n씬으로 import할까요?',
    wrongTypeSrt: '이 파일은 SRT 자막 파일입니다.\nSRT로 import할까요?',
    wrongTypeCsv: '이 파일은 CSV 파일입니다.\n씬 CSV로 import할까요?',
    wrongTypeText: '이 파일은 일반 텍스트입니다.\n프롬프트로 import할까요?',
  },
  
  // 기록
  history: {
    title: '기록',
    empty: '생성된 이미지가 없습니다',
    clearAll: '전체 삭제',
    detail: '상세 정보',
    date: '날짜',
    project: '프로젝트',
    file: '파일',
    aspectRatio: '화면비',
    prompt: '프롬프트',
    subtitle: '자막',
  },
  
  // 언어
  language: {
    ko: '한국어',
    en: 'English',
  },
  
  // Export 모달
  exportModal: {
    title: 'CapCut 내보내기',
    capcutPackage: 'CapCut JSON Package',
    capcutPackageDesc: 'CapCut desktop/mobile용 프로젝트 패키지',
    zipDesc: '이미지와 타임라인 정보가 포함된 ZIP 파일',
    output: 'Output:',
    username: '시스템 사용자명',
    usernameRequired: '시스템 사용자명을 입력해주세요.',
    usernameHintMac: '터미널에서 whoami 명령어로 확인',
    usernameHintWin: 'CMD에서 whoami → COMPUTER\\user 중 user 부분만 입력',
    projectNumber: 'CapCut 프로젝트 번호',
    projectNumberRequired: 'CapCut 프로젝트 번호를 입력해주세요.',
    projectNumberPlaceholder: '예: 0128, 0201',
    projectNumberHint: 'CapCut 프로젝트 폴더명 (4자리 숫자)',
    generatedPath: '생성될 경로:',
    pathPresetCustom: '직접 입력',
    customPathPlaceholder: '전체 프로젝트 경로를 입력하세요...',
    scaleMode: '이미지 스케일',
    scaleFill: '프레임 채움 (일부 잘림)',
    scaleFit: '전체 보임 (여백 생김)',
    scaleNone: '원본 크기 (100%)',
    scaleFillHint: '이미지가 프레임을 완전히 채웁니다. 비율이 맞지 않으면 일부가 잘립니다.',
    scaleFitHint: '이미지 전체가 보입니다. 비율이 맞지 않으면 검은 여백이 생깁니다.',
    scaleNoneHint: '이미지를 원본 크기로 사용합니다.',
    kenBurns: 'Ken Burns 효과',
    kenBurnsHint: '이미지에 자동 줌/패닝 애니메이션 적용',
    kenBurnsTooltip: 'Ken Burns 효과: 이미지에 서서히 줌인/줌아웃하거나 좌우/상하로 패닝하는 애니메이션을 적용합니다. 다큐멘터리나 슬라이드쇼에서 정적인 이미지에 역동적인 느낌을 주는 기법입니다.',
    kenBurnsModeRandom: '랜덤',
    kenBurnsModePattern: '패턴',
    kenBurnsModeTooltip: '랜덤: 매 주기마다 완전히 랜덤한 위치/크기로 이동\n패턴: 미리 정의된 줌인, 줌아웃, 패닝 패턴 중 선택',
    kenBurnsCycle: '주기:',
    kenBurnsCycleUnit: '초',
    kenBurnsCycleTooltip: '애니메이션이 변화하는 주기 (초)',
    kenBurnsScale: '스케일',
    kenBurnsScaleTooltip: '줌 효과 범위 (auto-scale에 곱해짐, 100%~150% 권장)',
    includeSubtitle: '자막 포함 (SRT)',
    includeSubtitleHint: 'SRT 자막 파일을 ZIP에 포함합니다.',
    importGuide: 'CapCut 내보내기 방법:',
    guideBtn: '가이드',
    importStep1: 'ZIP 압축 해제',
    importStep2: '프로젝트 폴더를 CapCut 폴더로 복사',
    importStep3Path: '위에서 생성된 경로의 상위 폴더에 복사하세요',
    importStep4: 'CapCut 재시작 후 프로젝트 목록에서 확인',
    macPathSearch: '프로젝트 폴더를 찾을 수 없나요? 터미널에서 실행:',
    macSearchCmd: 'find ~ -type d -name "com.lveditor.draft" 2>/dev/null',
    winPathSearch: '프로젝트 폴더를 찾을 수 없나요? CMD에서 실행:',
    winSearchCmd: 'dir "com.lveditor.draft" /s /ad C:\\Users\\%USERNAME%',
    copyPathTooltip: '상위 폴더 경로를 복사합니다. 탐색기/Finder 주소창에 붙여넣어 확인하세요.',
    autoDownloadTip: '저장 다이얼로그 없이 바로 다운로드하려면, Chrome 설정 > 다운로드 > "다운로드 전 파일 저장 위치 확인" 옵션을 끄세요.',
    trialBadge: '{exports}회/{days}일',
    upgradeBtn: '프로',
    cancel: '취소',
    export: '내보내기',
    exporting: '내보내는 중...',
    preparingPackage: 'CapCut 패키지 준비 중...',
    pleaseWait: '잠시만 기다려주세요',
    launchingCapcut: 'CapCut 실행 중...',
    launchingHint: 'CapCut이 열리면 프로젝트를 확인하세요',
  },

  // 결제 (Paywall)
  paywall: {
    loginRequired: '로그인이 필요합니다',
    loginDescription: 'CapCut 내보내기를 사용하려면 먼저 로그인해주세요.',
    trialEnded: '무료 체험이 종료되었습니다',
    trialEndedDesc: '5회 내보내기와 7일 체험 기간이 모두 만료되었습니다.',
    exportsUsed: '무료 내보내기 횟수를 모두 사용했습니다',
    exportsUsedDesc: '5회 무료 내보내기를 모두 사용했습니다. ({days}일 남음)',
    periodExpired: '체험 기간이 만료되었습니다',
    periodExpiredDesc: '7일 체험 기간이 종료되었습니다. ({exports}회 남음)',
    upgradeTitle: 'Pro로 업그레이드하세요',
    upgradeDesc: '무제한 내보내기와 모든 기능을 사용하세요.',
    monthly: '월간',
    yearly: '연간',
    month: '월',
    year: '년',
    feature1: '무제한 CapCut 내보내기',
    feature2: 'Ken Burns 효과 (랜덤/패턴)',
    feature3: '자막 자동 삽입',
    feature4: '우선 지원',
    upgradeBtn: 'Pro로 업그레이드',
    processing: '처리 중...',
    later: '나중에 하기',
    error: '결제 페이지를 열 수 없습니다. 다시 시도해주세요.',
  },

  // 구독
  subscription: {
    expired: '체험 기간이 만료되었습니다',
    upgrade: '업그레이드',
    upgradeToPro: '⭐ Pro로 업그레이드',
    trial: '체험판',
    expiredBadge: '만료됨',
    proActive: 'Pro 구독 중',
    trialRemaining: '{exports}회 / {days}일 남음',
    trialExpired: '체험 기간 만료',
    manageSubscription: '구독 관리',
    loadingPortal: '로딩...',
    logout: '로그아웃',
  },

  // 로그인 모달
  auth: {
    title: 'AutoCraft Studio',
    subtitle: '로그인하고 무료 체험을 시작하세요',
    feature1: 'CapCut 프로젝트 내보내기',
    feature2: '무료 체험: 5회 또는 7일',
    feature3: 'Ken Burns 효과 자동 적용',
    loginButton: 'Google로 계속하기',
    loggingIn: '로그인 중...',
    loginFailed: '로그인에 실패했습니다.',
    termsNotice: '로그인하면 서비스 이용약관에 동의하는 것으로 간주됩니다.',
  },

  // 사이드 드로워
  drawer: {
    resources: '리소스',
    flow: 'Google Flow',
    flowDesc: 'AI로 이미지 & 영상 생성',
    website: '웹사이트',
    websiteDesc: '공식 웹사이트 & 튜토리얼',
    youtube: 'YouTube',
    youtubeDesc: '영상 튜토리얼 & 팁',
    twitter: 'X (Twitter)',
    twitterDesc: '업데이트 & 공지',
    discord: 'Discord',
    discordDesc: '커뮤니티 & 지원',
    docs: '문서',
    docsDesc: '사용 가이드 & API 문서',
    feedback: '피드백',
    feedbackDesc: '버그 신고 & 제안',
    madeWith: 'Made with',
    copyright: '© 2026 Touchizen',
  },

  // 공통
  common: {
    loading: '로딩 중...',
    error: '오류',
    success: '성공',
    confirm: '확인',
    delete: '삭제',
    cancel: '취소',
    save: '저장',
    expand: '펼치기',
    collapse: '접기',
    clickToRestore: '클릭하여 복원',
    copy: '복사',
    copied: '복사됨',
    copyFailed: '복사 실패',
  },

  // 씬 상세 모달
  sceneDetail: {
    cancel: '취소',
    generating: '⏳ 생성 중...',
    regenerate: '🔄 재생성',
    save: '저장',
    generatingStatus: '생성 중...',
    noImage: '이미지 없음',
    prompt: '프롬프트',
    promptPlaceholder: '이미지 생성 프롬프트',
    subtitle: '💬 자막',
    subtitlePlaceholder: '영상에 표시될 자막 (선택사항)',
    startTime: '시작 시간',
    duration: '길이 (초)',
    character: '👤 캐릭터',
    characterPlaceholder: '레퍼런스와 매칭될 캐릭터 이름 (쉼표 구분)',
    background: '🏞️ 배경',
    backgroundPlaceholder: '배경 레퍼런스 이름',
    style: '🎨 스타일',
    styleSelect: '스타일 선택...',
    styleNone: '(없음)',
    history: '📜 기록',
  },

  // 이미지 히스토리 모달
  imageHistory: {
    title: '📜 이미지 기록 - {sceneId}',
    close: '닫기',
    currentImage: '현재 이미지',
    currentBadge: '사용중',
    loading: '⏳ 기록 로딩 중...',
    previousVersions: '이전 버전 ({count})',
    noPreviousVersions: '이전 버전이 없습니다.',
    noPreview: '미리보기 없음',
    restoring: '복원중...',
    useThisImage: '이 이미지 사용',
    delete: '삭제',
    deleteConfirm: '이 기록을 삭제하시겠습니까?',
    restoreFailed: '복원 실패',
  },

  // 구독 훅
  subscriptionHook: {
    loginFirst: '로그인 후 무료 체험을 시작하세요',
    proActive: 'Pro 구독 중',
    trialExpired: '체험 기간이 만료되었습니다',
    trialInfo: '무료 체험: {exports}회 / {days}일 남음',
    loginRequired: '내보내기를 사용하려면 로그인이 필요합니다.',
    trialExpiredUpgrade: '무료 체험이 만료되었습니다. Pro로 업그레이드하세요.',
  },

  // 씬 훅
  scenesHook: {
    duplicateRefConfirm: '동일한 이름의 레퍼런스가 있습니다:\n{names}\n\n기존 레퍼런스를 업데이트할까요?\n(취소: 중복 건너뛰기)',
  },

  // 헤더 추가
  headerExtra: {
    clickToDetail: '클릭하여 상세보기',
    cannotChangeProject: '생성 중에는 프로젝트를 변경할 수 없습니다',
  },

  // Export 모달 추가
  exportModalExtra: {
    pathRequired: '내보내기 경로가 필요합니다.',
    autoDetected: '자동 감지됨',
    capcutNotInstalled: 'CapCut이 설치되어 있지 않습니다. 다운로드하시겠습니까?',
  },

  // CapCut Cloud
  capcutCloud: {
    projectPathRequired: 'CapCut 프로젝트 폴더 경로가 필요합니다.',
  },

  // Toast 메시지
  toast: {
    noPrompt: '프롬프트가 없습니다.',
    allScenesGenerated: '모든 씬이 이미 생성되었습니다. 개별 씬에서 재생성하세요.',
    allRefsGenerated: '모든 레퍼런스가 이미 생성되었습니다.',
    permissionReleasedMemory: '권한이 해제되어 메모리에 보관 중... 완료 후 저장합니다.',
    generateFailed: '생성 실패: {error}',
    generateError: '생성 오류: {error}',
    serverErrorRetry: '서버 오류, {retry}차 재시도 중...',
    serverErrorPersist: '서버 오류가 지속되어 중단합니다.',
    tokenRefreshing: '토큰 갱신 중...',
    authErrorStop: '인증 오류로 중단합니다. Flow에 로그인 후 다시 시도해주세요.',
    batchCompleteNeedPermission: '이미지 생성 완료! 저장을 위해 권한을 허용해주세요.',
    folderDeleted: '작업 폴더가 삭제되었습니다. 다시 선택해주세요.',
    folderPermissionNeeded: '작업 폴더 권한이 필요합니다.',
    folderSelectFirst: '작업 폴더를 먼저 설정해주세요.',
    flowLoginRequired: 'Flow 로그인이 필요합니다. labs.google 탭을 열어 로그인해주세요.',
    memoryWarning: '메모리 사용량이 높습니다. 일부 이미지가 저장되지 않을 수 있습니다.',
    memoryCritical: '메모리 부족으로 중단합니다. 설정에서 저장 권한을 허용해주세요.',
    noGeneratedImages: '생성된 이미지가 없습니다.',
    filePermissionRequired: '파일 읽기 권한이 필요합니다. 설정에서 권한을 허용해주세요.',
    exportSaveComplete: 'CapCut 프로젝트 저장 완료!',
    exportCapcutLaunched: 'CapCut이 실행되었습니다. 프로젝트를 확인하세요!',
    exportCapcutFailed: 'CapCut 실행에 실패했습니다. 수동으로 열어주세요.',
    exportFailed: 'Export 실패: {error}',
    sceneGenerateSuccess: 'Scene {sceneId} 생성 완료',
    sceneGenerateFailed: '생성 실패: {error}',
    sceneGenerateError: '생성 오류: {error}',
    projectRenamed: '프로젝트 이름이 변경되었습니다.',
  },
}
