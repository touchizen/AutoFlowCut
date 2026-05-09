/**
 * errorDisplay — 에러 메시지 표시 통합 유틸
 *
 * i18n 컨트랙트:
 *   - errorKind  : 코드화된 에러 종류 (예: 'image-missing'). 표시 시점에
 *                  `errorSection.kind.<kind>` 키로 번역.
 *   - error      : 자유 형식 에러 (주로 generation 실패의 API 메시지 등).
 *                  errorKind 가 없거나 번역 실패 시 fallback.
 *
 * useI18n 의 t() 는 키가 없을 때 `key` 자체를 반환한다. 단순히 t() 결과를
 * 그대로 쓰면 알 수 없는 errorKind 가 들어왔을 때 'errorSection.kind.foo'
 * 같은 raw 키 문자열이 UI 에 노출되고 free-form error 도 가려지는
 * 회귀가 발생한다. 이 유틸은 번역 실패를 감지해 free-form error 로
 * graceful fallback 하도록 가드한다.
 *
 * 표시 컴포넌트 (ErrorSection, ResultsTable) 는 모두 이 유틸을 거쳐
 * 동일한 우선순위 / fallback 정책을 가진다.
 */

/**
 * 표시할 에러 메시지를 결정한다.
 *
 * @param {(key: string, params?: object) => string} t  i18n translator (useI18n().t).
 * @param {string|null|undefined} errorKind  코드화된 에러 종류 (예: 'image-missing')
 * @param {string|null|undefined} error      자유 형식 에러 메시지
 * @returns {string|null}  렌더링할 메시지. 둘 다 비어 있거나 어떤 메시지도
 *                         찾을 수 없으면 null (호출 측은 conditional render).
 */
export function resolveDisplayError(t, errorKind, error) {
  if (errorKind) {
    const key = `errorSection.kind.${errorKind}`
    const translated = typeof t === 'function' ? t(key) : null
    // useI18n 의 t() 는 키가 없으면 key 자체를 그대로 반환 (`return value || key`).
    // 번역 결과가 key 와 같다는 것은 locale 에 등록되지 않은 errorKind 라는 뜻 →
    // raw 키 문자열을 UI 에 노출하지 않고 free-form error 로 떨어진다.
    if (translated && translated !== key) return translated
  }
  return error || null
}
