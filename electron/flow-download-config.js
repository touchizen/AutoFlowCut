/**
 * Flow DOM 다운로드/업스케일 폴링 타임아웃.
 *
 * Flow 다운로드는 단순 fetch 가 아니라 다운로드 메뉴 클릭 → 해상도(1080p/4K) 선택 시 업스케일까지
 * 끝나야 temp 디렉토리에 파일이 나타난다(flow-api.js DOMDownload 폴링). 처리 시간이 미디어 종류에
 * 따라 크게 다르다:
 *   - 동영상: 4K 업스케일이 길어 2분으로 부족(라이브 timeout) → 5분.
 *   - 이미지: 단일 프레임 업스케일이라 2분으로 충분.
 */

/** 동영상 DOM 다운로드(+업스케일) 대기 한도. */
export const VIDEO_DOWNLOAD_TIMEOUT_MS = 300000 // 5분

/** 이미지 업스케일 DOM 다운로드 대기 한도. */
export const IMAGE_UPSCALE_TIMEOUT_MS = 120000 // 2분
