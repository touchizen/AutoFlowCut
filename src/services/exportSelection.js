/**
 * exportSelection — 어떤 씬을 내보낼 수 있는가에 대한 단일 지점
 *
 * 배경: 타인에게 받은 519 씬 프로젝트에서 518 개가 `status:'pending'` 인데
 * `imagePath` 는 전부 채워져 있었다. 로드 시 `useProjectData` 가 디스크에서 파일을
 * 찾아 `imagePath` 만 갱신하고 pending 은 의도적으로 보존하기 때문이다(프롬프트를
 * 바꿔 재생성 대기 중인 씬을 옛 이미지로 done 처리하면 거짓말이 된다).
 * 화면 썸네일은 `imagePath` 로 그리고 내보내기는 `status` 로 걸러서, 519 개가
 * 전부 보이는데 하나만 나갔고 경고는 "0 개일 때만" 떠서 무음이었다.
 *
 * 여기서 분류(사용자에게 보여줄 숫자)와 선택(실제로 내보낼 배열)이 **같은 술어
 * 함수를 호출**한다. 식을 각자 인라인하면 "N 개 포함"이라 말해놓고 다른 집합을
 * 내보내는, 이번 사건과 같은 형태의 어긋남이 다시 생긴다.
 */

import { hasExportableMedia } from '../utils/sceneMedia'
import { isSceneGenerationDone } from '../services/generationStatus'

/** 지금까지의 내보내기 대상 — 생성 완료 + 미디어 보유. */
export function isReadyExportEligible(scene) {
  return isSceneGenerationDone(scene) && hasExportableMedia(scene)
}

/**
 * 사용자가 "포함"을 고르면 추가되는 대상 — pending 인데 이미지 파일이 있는 씬.
 *
 * `pending` 만 대상이다. `error` 는 생성 실패라 디스크 이미지를 신뢰할 수 없고
 * (`image-missing` 은 파일이 돌아오면 로드 시 자동 치유되므로 남은 error 는 진짜
 * 실패다), `generating` 은 산출물이 미확정이다.
 *
 * 파일 실존을 다시 확인하지 않는다 — 로드 시 `useProjectData` 가 이미 확인했고
 * (없으면 `errorKind:'image-missing'` + `imagePath:null`), 518 회 IPC 재확인은
 * 비용만 크다.
 */
export function isPendingExportEligible(scene) {
  return scene?.status === 'pending' && hasExportableMedia(scene)
}

/**
 * 씬을 세 갈래로 나눈다. 상호배타이고 합집합이 입력 전체다.
 * 모달이 보여줄 숫자가 여기서 나온다.
 */
export function classifyExportScenes(scenes) {
  const ready = []
  const pendingWithImage = []
  const unusable = []
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    if (isReadyExportEligible(scene)) ready.push(scene)
    else if (isPendingExportEligible(scene)) pendingWithImage.push(scene)
    else unusable.push(scene)
  }
  return { ready, pendingWithImage, unusable }
}

/**
 * 실제로 내보낼 배열.
 *
 * ⚠️ **원본 배열을 filter 한다.** `ready.concat(pendingWithImage)` 로 만들면
 * `[pending A, done B]` 가 `[B, A]` 로 뒤집혀 영상 순서와 자막 재배치가 어긋난다.
 * 하류의 슬롯 계산(`computeSceneSlots`)도 이 배열을 인덱스로 읽으므로 순서가
 * 곧 정합성이다.
 */
export function selectExportScenes(scenes, { includePending = false } = {}) {
  return (Array.isArray(scenes) ? scenes : []).filter(
    s => isReadyExportEligible(s) || (includePending && isPendingExportEligible(s))
  )
}

/**
 * 헤더의 내보내기 버튼을 열어줄지 — 전부 pending 인 프로젝트가 모달에 도달조차
 * 못 하면 나머지가 전부 무의미하다.
 */
export function hasExportAccess(scenes) {
  const list = Array.isArray(scenes) ? scenes : []
  return list.some(s => isReadyExportEligible(s) || isPendingExportEligible(s))
}

/**
 * 모달이 보여줄 숫자 한 벌. App 이 이걸 그대로 펼쳐 넘긴다.
 *
 * 계산을 App 안에 인라인하지 않는 이유는 §3.3 의 `hasExportAccess` 와 같다 —
 * App 은 렌더 하네스가 무거워 식이 그 안에 있으면 테스트가 실제로 물지 못한다.
 *
 * `totalSceneCount` 는 **씬 전체**다. `ready + pendingWithImage` 로 계산하면
 * unusable 이 빠져 사용자에게 틀린 숫자를 보여준다.
 */
export function buildExportModalCounts(scenes) {
  const list = Array.isArray(scenes) ? scenes : []
  const { ready, pendingWithImage } = classifyExportScenes(list)
  return {
    totalSceneCount: list.length,
    readyCount: ready.length,
    pendingWithImageCount: pendingWithImage.length,
  }
}
