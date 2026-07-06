/**
 * handleTagGender(App.jsx)의 stale F0 가드 보조 — 순수 함수로 분리.
 *
 * 분리 이유: App.jsx는 렌더 테스트가 부담스러움(electron IPC 의존 다수). 가드 로직만
 * 순수 함수로 빼서 단위 테스트로 same code path 검증 (tests/services/genderGuard.test.js).
 *
 * 배경(Codex 최종 리뷰 Finding 2): 미확정 성우 미리듣기로 F0 추정이 in-flight인 상태에서
 * 사용자가 우클릭으로 수동 성별을 지정하면(source: 'manual'), 뒤늦게 도착하는 stale F0
 * 결과(source: 'f0')가 수동 지정을 덮어쓰던 race. ttsVoices는 React state라 갱신이
 * 비동기(패시브)이므로, 같은 tick에 manual→f0가 연이어 도착하면 ttsVoicesRef 기반 체크만으로는
 * 늦을 수 있다. manualGenderKeys는 App.jsx에서 handleTagGender 호출 시 동기적으로 add하는
 * ref(Set)라 이 레이스에도 항상 최신이다.
 *
 * @param {object} args
 * @param {string} args.source - 'manual' | 'f0' | ...
 * @param {string} args.voiceKey - `${provider}:${voiceId}`
 * @param {Set<string>} args.manualGenderKeys - App.jsx의 manualGenderKeysRef.current (동기 갱신)
 * @param {string|null|undefined} args.existingGenderSource - ttsVoicesRef 기준 기존 genderSource
 * @returns {boolean} true면 이 f0 태그를 무시(skip)해야 함
 */
export function shouldSkipStaleF0Gender({ source, voiceKey, manualGenderKeys, existingGenderSource }) {
  if (source !== 'f0') return false
  if (manualGenderKeys?.has(voiceKey)) return true
  return existingGenderSource === 'manual'
}
