/**
 * Veo 영상 오디오 볼륨 패치 (앱 전용 — GCF 수정 없음)
 *
 * Veo 는 오디오를 끌 수 없다(Gemini API 가 generate_audio=false 를 거부). GCF 는 영상 오버레이
 * 세그먼트에 volume 을 쓰지 않아 CapCut 템플릿 기본값 1.0 이 그대로 나가고, 그 결과 Veo 가
 * 지어낸 대사·효과음이 TTS 나레이션 위에 풀 볼륨으로 깔린다.
 *
 * draft JSON 은 GCF 가 만들지만 디스크에 쓰는 건 앱이다(capcutCloud.js). 그래서 받은 draft 에서
 * 영상 세그먼트의 volume 만 여기서 바꾼다. segment.volume 은 CapCut 이 받아들이는 손잡이다
 * (GCF 자신이 SFX 에 쓴다 — whisk2capcut index.suffixed.js:1580).
 *
 * 주의: CapCut draft 는 정지 이미지도 materials.videos 에 담는다(type:'photo'). 그래서 배열
 * 전체가 아니라 videoOverlays 의 filename 집합에 속한 material 만 대상으로 한다.
 */

/** 고를 수 있는 값 — 0 음소거 / 0.15 앰비언스 / 1 원본. 내보내기 창과 MCP 내보내기가 같은 목록을 쓴다. */
export const VIDEO_AUDIO_VOLUMES = Object.freeze([0, 0.15, 1])

/**
 * @param {Object|string} draftInfo - GCF 가 준 CapCut draft (객체 또는 JSON 문자열)
 * @param {Object} opts
 * @param {string[]} opts.videoFilenames - cloudRequest.videoOverlays[].filename
 * @param {number|null} [opts.volume] - 0=음소거, 0.15=앰비언스, 1=원본. null/undefined 면 패치 안 함
 * @returns {Object|string} 입력과 같은 형태(객체→객체, 문자열→문자열)
 */
export function applyVideoAudioVolume(draftInfo, { videoFilenames, volume } = {}) {
  if (volume == null) return draftInfo
  if (!draftInfo) return draftInfo
  if (!Array.isArray(videoFilenames) || videoFilenames.length === 0) return draftInfo

  const wasString = typeof draftInfo === 'string'
  let draft = draftInfo
  if (wasString) {
    try {
      draft = JSON.parse(draftInfo)
    } catch {
      // 파싱 불가면 손대지 않는다 — export 를 깨뜨리는 것보다 볼륨 1.0 이 낫다.
      return draftInfo
    }
  }

  const targets = new Set(videoFilenames)
  const materials = draft?.materials?.videos || []
  const videoMaterialIds = new Set(
    materials.filter((m) => targets.has(m?.material_name)).map((m) => m?.id)
  )

  if (videoMaterialIds.size > 0) {
    for (const track of draft?.tracks || []) {
      for (const segment of track?.segments || []) {
        if (videoMaterialIds.has(segment?.material_id)) segment.volume = volume
      }
    }
  }

  return wasString ? JSON.stringify(draft) : draft
}

export default { applyVideoAudioVolume }
