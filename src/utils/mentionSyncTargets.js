import { selectUnsyncedMentionedRefs } from './flowCharacterSync'
import { flowSyncable } from './refImageGuard'

/**
 * 개별 씬 생성이 "동기화가 필요한 @멘션 캐릭터"를 물을 때의 대상 선정(순수).
 *
 * 두 가지 요청을 구분한다:
 *  - names 없음(프리플라이트): 이 씬이 멘션한 캐릭터 중 **우리 기록상** 미동기화이고 수리 가능한 것.
 *    배치(Start) 게이트와 같은 판정을 그대로 쓴다.
 *  - names 있음(엔진이 미해결로 거절한 뒤): 그 이름들. 우리 기록이 synced 여도 거르지 않는다 —
 *    엔진이 못 쓴다고 했으므로 기록 쪽이 옛것일 수 있다.
 *
 * ⚠️ 이름 대조는 **대소문자 구분**이다. Flow 멘션 해석이 case-sensitive 라서
 *   ([[sceneMentions]]), 소문자로 뭉개면 `@hero` 가 미해결인데 다른 ref `Hero` 를 대상으로
 *   골라 "동기화했지만 프롬프트는 그대로" 인 모달을 반복해서 띄우게 된다.
 *
 * @param {{scene?: object, names?: string[], references?: Array}} req
 * @returns {Array} 동기화 대상 ref 목록(없으면 빈 배열 — 호출부는 모달 없이 진행)
 */
export function selectMentionSyncTargets({ scene, names, references } = {}) {
  const refs = references || []
  const wanted = new Set((names || []).filter(Boolean).map(String))
  const candidates = wanted.size > 0
    ? refs.filter(r => r?.type === 'character' && r?.name && wanted.has(String(r.name)))
    : selectUnsyncedMentionedRefs(scene ? [scene] : [], refs)
  // 고칠 수 없는 ref(이미지도 없고 등록 정보도 없는 빈 카드)로는 모달을 띄우지 않는다 —
  // 사용자가 눌러도 아무것도 바뀌지 않는다.
  return candidates.filter(flowSyncable)
}
