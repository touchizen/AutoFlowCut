/**
 * useAvailableModels — 라이브 /models 조회로 모델 선택 옵션을 채운다.
 *
 * genAPI.listModels() 결과를 categorizeApiModels 로 T2I/T2V·F2V 로 분류해 노출.
 * 키 없음/오프라인/분류 결과 빈 경우엔 정적 카탈로그(IMAGE_MODELS/VIDEO_MODELS)로
 * graceful 폴백 — 설정 UI 가 항상 동작하도록.
 */
import { useState, useEffect } from 'react'
import { IMAGE_MODELS, VIDEO_MODELS, categorizeApiModels } from '../config/genModels'

export function useAvailableModels(genAPI) {
  const [state, setState] = useState({
    imageModels: IMAGE_MODELS,
    videoModels: VIDEO_MODELS,
    loading: true,
    error: null,
  })

  // genAPI 객체는 렌더마다 새로 생성되지만 listModels(useCallback)는 안정적 →
  // 함수 참조에 의존해 effect 재실행/무한 루프를 막는다.
  const listModels = genAPI?.listModels

  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (!listModels) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: null }))
        return
      }
      setState((s) => ({ ...s, loading: true, error: null }))
      listModels()
        .then((res) => {
          if (cancelled) return
          if (res?.success) {
            const { imageModels, videoModels } = categorizeApiModels(res.models)
            // 카테고리별 독립 폴백 — 한쪽만 비어도 그쪽만 정적으로.
            setState({
              imageModels: imageModels.length ? imageModels : IMAGE_MODELS,
              videoModels: videoModels.length ? videoModels : VIDEO_MODELS,
              loading: false,
              error: null,
            })
          } else {
            // 무키/실패 → 정적 폴백(이전 키의 동적 목록도 비움).
            setState({ imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS, loading: false, error: res?.error || 'Failed to list models' })
          }
        })
        .catch((e) => {
          if (cancelled) return
          setState({ imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS, loading: false, error: e?.message || String(e) })
        })
    }
    run()
    // 키 저장/삭제(byok-key-changed: saveKey/clearKey 둘 다 dispatch) 시 재조회 —
    // 앱 시작 시 무키였다가 키를 넣은 신규 사용자/키 교체가 동적 목록·stale 치유에 반영되도록.
    const onKeyChanged = () => run()
    window.addEventListener('byok-key-changed', onKeyChanged)
    return () => {
      cancelled = true
      window.removeEventListener('byok-key-changed', onKeyChanged)
    }
  }, [listModels])

  return state
}

export default useAvailableModels
