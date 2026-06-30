/**
 * video-model-rules — Electron(main) 측 비디오 모델 판별 규칙의 단일 소스.
 *
 * isOmniFlashModel 은 두 곳에서 쓰인다:
 *   1) electron/ipc/video.js — i2v endImage 무시 분기(OmniFlash 종료프레임 미지원).
 *   2) electron/flow-page-injection.js — `${isOmniFlashModel.toString()}` 로 페이지 스크립트에
 *      직렬화 주입(t2v 모델키 강제 분기). → 자기완결적이어야 한다(외부 참조/클로저 금지).
 *
 * 이전엔 정의가 flow-page-injection.js(페이지 주입 문자열 모듈) 안에 있었고 video.js(IPC)가
 * 거기서 import 했다 — IPC 가 주입 직렬화 모듈에 의존하는 잘못된 커플링이었다. 규칙을 이 중립
 * 모듈로 분리한다. (renderer 측 동일 판별은 src/utils/videoModels.js — 렌더/메인 번들 경계라
 * 복사본이며, parity 는 tests/electron/videoModelRules.test.js 가 고정한다.)
 */

/** 앱이 고른 모델이 OmniFlash 인지 — 표시 이름('Omni Flash')/내부키('abra_*') 둘 다 감지. */
export function isOmniFlashModel(model) {
  return /omni.?flash/i.test(model || '') || /^abra/i.test(model || '')
}
