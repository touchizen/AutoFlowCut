/**
 * framePairs(I2V 행) id — 기존 행에서 사용 중인 최대 fp_N 을 찾아 다음 번호를 돌려준다.
 * 모듈 스코프 카운터를 쓰면 프로젝트 전환/리로드 시 기존 저장된 ID와 충돌(중복 key)하므로
 * 항상 현재 framePairs를 기준으로 재계산한다. FrameToVideoPanel · MCP set-frame-pairs(mcpFramePairs) 공용.
 */
export function getNextPairId(pairs) {
  const maxId = (pairs || []).reduce((max, p) => {
    const n = parseInt(String(p?.id || '').replace('fp_', ''), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return maxId + 1
}
