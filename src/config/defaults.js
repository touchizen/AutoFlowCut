/**
 * AutoFlowCut - Default Configuration
 */

export const DEFAULTS = {
  // 프로젝트 설정
  project: {
    defaultName: 'Untitled', // 초기 프로젝트명 (File System 연결 전)
  },

  // 씬 설정
  scene: {
    duration: 3,           // 기본 duration (초)
  },

  // 생성 설정 (DOM 자동화 모드 — 순차 처리)
  generation: {
    retryCount: 2,         // 재시도 횟수
    delayMin: 2000,        // 최소 딜레이 (ms)
    delayMax: 5000,        // 최대 딜레이 (ms)
    concurrency: 1,        // 항상 순차 (FlowView가 하나이므로)
  },

  // API 엔드포인트 (Flow AI)
  api: {
    baseUrl: 'https://aisandbox-pa.googleapis.com/v1',
    flowUrl: 'https://labs.google/fx/tools/flow',
    endpoints: {
      // 이미지 생성 (projectId 있을 때)
      generateImage: '/projects/{projectId}/flowMedia:batchGenerateImages',
      // 이미지 생성 (projectId 없을 때 fallback)
      generateImageFallback: '/flowMedia:batchGenerateImages',
      // 이미지 업로드
      uploadImage: '/flow/uploadImage',
      // 비디오 생성 (Text-to-Video)
      generateVideoT2V: '/video:batchAsyncGenerateVideoText',
      // 비디오 생성 (Image-to-Video, start frame)
      generateVideoI2V: '/video:batchAsyncGenerateVideoStartImage',
      // 비디오 상태 확인
      checkVideoStatus: '/video:batchCheckAsyncVideoGenerationStatus',
      // 비디오 업스케일 (AutoFlow 10.7.58 역공학)
      upsampleVideo: '/video:batchAsyncGenerateVideoUpsampleVideo',
      // 미디어 URL 리다이렉트
      mediaRedirect: 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect',
      // 세션 (access token 추출)
      session: 'https://labs.google/fx/api/auth/session',
      // OAuth token info
      tokenInfo: 'https://www.googleapis.com/oauth2/v3/tokeninfo',
    },
    payload: {
      tool: 'PINHOLE',     // clientContext.tool for Flow
      recaptchaKey: '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
      recaptchaAction: 'generate',
    },
    // 이미지 모델
    imageModels: [
      { value: 'GEM_PIX_2', label: 'Nano Banana 2 (Default)' },
      { value: 'IMAGEN_4', label: 'Imagen 4' },
    ],
    // 비디오 모델 (v2 API model keys)
    videoModels: [
      { value: 'veo_3_1_t2v_fast_ultra_relaxed', label: 'Veo 3.1 Fast' },
      { value: 'veo_3_1_t2v_quality_ultra_relaxed', label: 'Veo 3.1 Quality' },
    ],
    // 비디오 업스케일 모델 (AutoFlow 10.7.58 역공학)
    upscaleModels: {
      '1080p': { modelKey: 'veo_3_1_upsampler_1080p', resolution: 'VIDEO_RESOLUTION_1080P' },
      '4k':    { modelKey: 'veo_3_1_upsampler_4k',    resolution: 'VIDEO_RESOLUTION_4K' },
    },
  },

  // DOM 셀렉터 (DOM 방식용) - Flow 페이지용 (AutoFlow 10.7.58 검증)
  selectors: {
    // 프롬프트 입력: contenteditable div (NOT textarea)
    prompt_contenteditable: "div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)",
    // Generate 버튼: arrow_forward 아이콘
    generate_btn: "//button[.//i[text()='arrow_forward']] | (//button[.//i[normalize-space(text())='arrow_forward']])",
    // New Project 버튼: add_2 아이콘
    create_project_btn: "//button[.//i[normalize-space(text())='add_2']] | (//button[.//i[normalize-space(.)='add_2']])",
    // 화면비 셀렉터 (CSS selector, NOT XPath)
    ratio_landscape: "button[role='tab'][id$='-trigger-LANDSCAPE'], button[role='tab'][id*='-trigger-LANDSCAPE']",
    ratio_portrait: "button[role='tab'][id$='-trigger-PORTRAIT'], button[role='tab'][id*='-trigger-PORTRAIT']",
    // 에러 팝업
    error_popup: "//li[@data-sonner-toast and .//i[normalize-space(text())='error']]",
  }
}

// 리소스 디렉토리명 (파일시스템 저장 경로)
export const RESOURCE = {
  SCENES: 'scenes',
  REFERENCES: 'references',
}

export const REFERENCE_TYPES = [
  { value: 'character', label: '👤 Character', category: 'MEDIA_CATEGORY_SUBJECT' },
  { value: 'scene', label: '🏞️ Scene', category: 'MEDIA_CATEGORY_SCENE' },
  { value: 'style', label: '🎨 Style', category: 'MEDIA_CATEGORY_STYLE' },
]

// 스타일 프리셋 (type=style 선택 시 사용) - 87개 스타일, 11개 카테고리
import stylePresetsJson from './style_presets.json'
export const STYLE_PRESETS = stylePresetsJson

// UI 기본값
export const UI = {
  DEFAULT_BOTTOM_PANEL_HEIGHT: 180,
  MIN_TOP_PANEL_HEIGHT: 250,
  MIN_BOTTOM_PANEL_HEIGHT: 80,
  DURATION_MIN: 1,
  DURATION_MAX: 30,
  DURATION_STEP: 0.5,
  EXPORT_THRESHOLD: 50,
}

// 타이밍 (ms)
export const TIMING = {
  AUTO_SAVE_DEBOUNCE: 1000,
  AUTH_CHECK_DELAY: 3000,
  AUTH_POLL_INTERVAL: 2000,
  TOAST_EXIT_ANIMATION: 300,
  SETTINGS_HIGHLIGHT: 3000,
  AUTH_ERROR_TOAST: 6000,
  VIDEO_POLL_INTERVAL: 10000,      // 비디오 상태 폴링 간격
  VIDEO_SUBMIT_MIN_DELAY: 7000,    // 제출 간 최소 대기 (ms)
  VIDEO_SUBMIT_MAX_DELAY: 15000,   // 제출 간 최대 대기 (ms)
  VIDEO_MAX_POLL_COUNT: 120,       // 최대 폴링 횟수 (120 × 10초 = 20분)
  UPSCALE_POLL_INTERVAL: 2000,     // 업스케일 폴링 간격 (ms)
  UPSCALE_MAX_POLL_COUNT: 90,      // 업스케일 최대 폴링 (90 × 2초 = 3분)
}

export default DEFAULTS
