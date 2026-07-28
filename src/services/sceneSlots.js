/**
 * sceneSlots — 씬 사이 간격을 앞 씬에 흡수하는 슬롯 산출
 *
 * 배경: buildExportProject 가 startTime 을 안 보내서 prepareCloudRequest 가
 * duration 을 순차 누적한다 → 자막 그룹 사이 무음 간격이 전부 붕괴해 이미지가
 * 내레이션보다 앞서고(519 씬 프로젝트에서 최대 80 s), GCF 가 부족분을 마지막
 * 씬 하나에 얹는다(8.2 s → 92 s).
 *
 * 해결: 각 씬의 슬롯을 `next.startTime - cur.startTime` 으로 잡으면 누적이
 * telescoping 해서 cum(i) === start_i 가 된다 → drift 0, GCF 무수정.
 * 무음 구간은 앞 이미지가 유지된다(hold).
 *
 * 맵이 두 벌인 이유: 첫 씬만 선두 오프셋을 흡수해야 하는데(이미지 타임라인은
 * 0 에서 시작해야 한다), 사이드카 SRT 의 rebase 는 씬의 첫 자막 줄에 앵커하므로
 * 흡수하면 안 된다. 대신 initialCumulative = start_0 로 시드한다.
 */

/**
 * @param {Array} scenes — export 대상 씬(validScenes). 시간순 가정하지 않는다.
 * @param {object} settings — { defaultDuration } (레거시 폴백 값 계산용)
 * @returns {{
 *   useSlots: boolean,
 *   reason: string|null,
 *   imageSlots: number[],
 *   srtSlots: number[],
 *   sourceDurations: number[]|null,
 *   sourceOffsets: number[]|null,
 * }}
 */
export function computeSceneSlots(scenes, settings = {}) {
  const list = Array.isArray(scenes) ? scenes : []

  const reason = validateForSlots(list)
  if (reason) {
    // 전체 폴백 — 반드시 all-or-nothing 이다. 씬 단위로 폴백하면 망원합이 깨져
    // 이후 전 씬이 흡수 못 한 간격만큼 영구히 이르다(= drift ≠ 0).
    // 레거시 값은 useExport.js 의 기존 식 그대로여야 현행과 바이트 동일하다.
    const legacy = list.map(s => s.duration || settings.defaultDuration || 3)
    return {
      useSlots: false,
      reason,
      imageSlots: legacy,
      srtSlots: legacy,
      sourceDurations: null,
      sourceOffsets: null,
    }
  }

  const n = list.length
  const startOf = s => Number(s.startTime)
  const endOf = s => Number(s.endTime)

  const srtSlots = list.map((s, i) =>
    i < n - 1 ? startOf(list[i + 1]) - startOf(s) : endOf(s) - startOf(s)
  )
  // 첫 씬만 선두 오프셋을 흡수한다(startTime 을 0 으로 간주).
  // 씬이 하나뿐이면 마지막-씬 규칙과 충돌하는데 선두 흡수가 이긴다 —
  // 그래야 "이미지 슬롯 합계 === 마지막 endTime" 불변식이 성립한다.
  const imageSlots = srtSlots.slice()
  imageSlots[0] = (n > 1 ? startOf(list[1]) : endOf(list[0])) - 0

  return {
    useSlots: true,
    reason: null,
    imageSlots,
    srtSlots,
    sourceDurations: list.map(s => endOf(s) - startOf(s)),
    sourceOffsets: list.map((s, i) => (i === 0 ? startOf(s) : 0)),
  }
}

/**
 * 검사 순서가 곧 reason 계약이다 — 한 픽스처가 여러 검사를 동시에 위반할 수
 * 있으므로(중복 startTime 은 단조·겹침·슬롯을 셋 다 위반) 순서를 고정한다.
 *
 * @returns {string|null} 폴백 사유. null 이면 슬롯 사용.
 */
function validateForSlots(scenes) {
  // 빈 배열은 스펙의 ∀-검사를 공허하게 통과하지만, 슬롯 경로가 scenes[0] 을
  // 역참조하므로 폴백시킨다. 산출물은 [] 로 동일하고 warn 도 호출부가 막는다.
  if (scenes.length === 0) return 'non-finite-times'

  // 1) 시각 자체가 성립하는가
  for (const s of scenes) {
    const start = Number(s?.startTime)
    const end = Number(s?.endTime)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) {
      return 'non-finite-times'
    }
  }
  // 2) 씬 자기 span 이 양수인가
  for (const s of scenes) {
    if (Number(s.endTime) <= Number(s.startTime)) return 'non-positive-span'
  }
  // 3) 배열 순서와 startTime 이 일치하는가 (strict — 중복도 여기서 걸린다)
  for (let i = 0; i < scenes.length - 1; i++) {
    if (!(Number(scenes[i].startTime) < Number(scenes[i + 1].startTime))) {
      return 'not-monotonic'
    }
  }
  // 4) 겹치지 않는가. 단조만으로는 A(0–10), B(5–8) 이 통과하는데 그러면
  //    source > slot 이 되어 오버레이가 다음 씬 화면을 덮는다.
  for (let i = 0; i < scenes.length - 1; i++) {
    if (Number(scenes[i].endTime) > Number(scenes[i + 1].startTime)) {
      return 'overlap'
    }
  }
  // 5) 방어선 — 검사 1~4 가 통과하면 모든 슬롯은 양수 유한임이 증명된다
  //    (비-마지막은 검사 3, 마지막은 검사 2, 첫 씬은 3+1, 단일 씬은 2+1).
  //    즉 이 분기는 도달 불가이고, 구현이 깨졌을 때만 잡힌다.
  const n = scenes.length
  for (let i = 0; i < n; i++) {
    const slot = i < n - 1
      ? Number(scenes[i + 1].startTime) - Number(scenes[i].startTime)
      : Number(scenes[i].endTime) - Number(scenes[i].startTime)
    if (!Number.isFinite(slot) || slot <= 0) return 'non-positive-slot'
  }
  return null
}
