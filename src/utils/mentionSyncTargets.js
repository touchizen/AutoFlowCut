import { parseSceneMentions } from './sceneMentions'
import { flowSyncable } from './refImageGuard'

/**
 * 개별 씬 생성이 "동기화가 필요한 @멘션 캐릭터"를 물을 때의 대상 선정(순수).
 *
 * 두 가지 요청을 구분한다:
 *  - names 없음(프리플라이트): **엔진이 쓰는 그 파서**(parseSceneMentions)로 이 씬의 미해결 멘션을
 *    구해 그 이름의 캐릭터 ref 를 고른다. 다른 규칙으로 뽑으면 파서가 둘이 되어, 엔진은 실패하는데
 *    게이트는 "동기화할 것 없음"이라 하거나 그 반대가 된다.
 *  - names 있음(엔진이 미해결/stale 로 거절한 뒤): 그 이름들. 우리 기록이 synced 여도 거르지 않는다 —
 *    엔진이 못 쓴다고 했으므로 기록 쪽이 옛것일 수 있다.
 *
 * ⚠️ 이름 대조는 **대소문자 구분**이다. Flow 멘션 해석이 case-sensitive 라서, 소문자로 뭉개면
 *   `@hero` 가 미해결인데 다른 ref `Hero` 를 대상으로 골라 "동기화는 했는데 프롬프트는 그대로"인
 *   모달을 반복해서 띄우게 된다. 이름이 어느 ref 와도 정확히 맞지 않으면(오타 등) 동기화로 고칠 수
 *   없으므로 대상에서 뺀다.
 *
 * @param {{scene?: object, names?: string[], references?: Array}} req
 * @returns {Array} 동기화 대상 ref 목록(없으면 빈 배열 — 호출부는 모달 없이 진행)
 */
export function selectMentionSyncTargets({ scene, names, references } = {}) {
  const refs = references || []
  const charRefs = refs.filter(r => r?.type === 'character' && r?.name)
  const wanted = names?.length
    ? names.filter(Boolean).map(String)
    : parseSceneMentions(scene?.prompt || '', charRefs).unresolved.map(u => u.name)
  if (wanted.length === 0) return []
  const byName = new Map(charRefs.map(r => [String(r.name), r]))
  const targets = []
  const seen = new Set()
  for (const name of wanted) {
    const ref = byName.get(String(name))
    // 고칠 수 없는 ref(이미지도 등록정보도 없는 빈 카드)로는 모달을 띄우지 않는다 — 눌러도
    // 아무것도 바뀌지 않는다.
    if (!ref || seen.has(ref) || !flowSyncable(ref)) continue
    seen.add(ref)
    targets.push(ref)
  }
  return targets
}
