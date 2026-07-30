/**
 * useAvailableModels — 라이브 /models 조회로 모델 선택 옵션을 채운다.
 *
 * genAPI.listModels() 결과를 categorizeApiModels 로 T2I/T2V·F2V 로 분류해 노출.
 * 키 없음/오프라인/분류 결과 빈 경우엔 정적 카탈로그(IMAGE_MODELS/VIDEO_MODELS)로
 * graceful 폴백 — 설정 UI 가 항상 동작하도록.
 *
 * state.source: 'dynamic'(라이브 목록 성공) | 'static'(폴백). refetch 게이팅에 쓴다 —
 *   이미 dynamic 이면 설정 열 때 굳이 느린 스크랩을 또 돌리지 않는다.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { IMAGE_MODELS, VIDEO_MODELS, categorizeApiModels } from '../config/genModels'
import { isFlowTarget, isChatgptTarget } from '../config/appRoute.js'
import { FLOW_STATIC_MODELS } from '../engine/flowModels'

// Flow 모드 정적 목록 — 동적 스크랩(Flow UI drift 로 깨짐)을 버리고 미리 추출한 정적 목록을 쓴다.
//   kind 로 분류된 { imageModels, videoModels } (표시 이름 기반 id 라 categorizeApiModels 의
//   /image/ 술어로는 못 거른다 → flowModels.js 가 명시적 kind 로 split).
const FLOW_STATIC = FLOW_STATIC_MODELS

export function useAvailableModels(genAPI, mode, sessionTarget = 'flow') {
  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
  const chatgptTargetActive = isChatgptTarget({ mode, sessionTarget })
  const [state, setState] = useState({
    imageModels: IMAGE_MODELS,
    videoModels: VIDEO_MODELS,
    loading: true,
    error: null,
    source: 'static',
  })

  // genAPI 객체는 렌더마다 새로 생성되지만 listModels(useCallback)는 안정적 →
  // 함수 참조에 의존해 effect 재실행/무한 루프를 막는다.
  const listModels = genAPI?.listModels
  // 요청 시퀀스 — 여러 /models 요청이 겹칠 때(키 교체/삭제 중 늦은 응답) 최신 요청만 반영.
  const runSeqRef = useRef(0)
  // 최신 run 을 보관 — refetch()(설정 열 때 등 외부 트리거)가 같은 로직을 재실행하게 한다.
  const runRef = useRef(() => {})

  useEffect(() => {
    let cancelled = false
    const run = () => {
      const myRun = ++runSeqRef.current
      // unmount(cancelled) 또는 더 최신 요청이 시작됐으면(superseded) 응답 무시.
      const stale = () => cancelled || myRun !== runSeqRef.current
      if (chatgptTargetActive) {
        if (!stale()) setState({
          imageModels: [], videoModels: [], loading: false,
          error: null, source: 'session-target-unavailable',
        })
        return
      }
      // Flow 모드: 동적 스크랩(에이전트 설정 패널 DOM)은 Flow UI 변경 때마다 panel_not_found 로
      //   깨진다(라이브 확인 2026-06-27). 매번 긁는 대신 미리 추출한 정적 FLOW_MODELS 를 그대로 쓴다 —
      //   목록이 Flow UI drift 에 영향받지 않아 안정적. (모델 갱신 시 FLOW_MODELS 만 수정.)
      //   ⚠️ !listModels 게이트보다 먼저 분기한다 — genAPI 가 비어 listModels 가 없어도 Flow 정적
      //   목록('flow-static')을 반환해야 computeModelHeal 이 stale API 모델을 치유한다(API 'static' 아님).
      if (flowTargetActive) {
        // source:'flow-static' = 권위 있는 정적 목록(동적 일시폴백 'static' 과 구분) → computeModelHeal
        //   이 stale API 모델 선택값을 Flow 모델로 치유하게 한다(안 그러면 드롭다운에 API 모델이 섞인다).
        if (!stale()) setState({ imageModels: FLOW_STATIC.imageModels, videoModels: FLOW_STATIC.videoModels, loading: false, error: null, source: 'flow-static' })
        return
      }
      if (!listModels) {
        if (!stale()) setState((s) => ({ ...s, loading: false, error: null, source: 'static' }))
        return
      }

      setState((s) => ({ ...s, loading: true, error: null }))

      listModels()
        .then((res) => {
          if (stale()) return
          if (res?.success) {
            const { imageModels, videoModels } = categorizeApiModels(res.models)
            // 카테고리별 독립 폴백 — 한쪽만 비어도 그쪽만 정적으로.
            const gotDynamic = imageModels.length > 0 || videoModels.length > 0
            setState({
              imageModels: imageModels.length ? imageModels : IMAGE_MODELS,
              videoModels: videoModels.length ? videoModels : VIDEO_MODELS,
              loading: false,
              error: null,
              source: gotDynamic ? 'dynamic' : 'static',
            })
          } else {
            // 무키/실패 → 정적 폴백(이전 키의 동적 목록도 비움).
            setState({ imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS, loading: false, error: res?.error || 'Failed to list models', source: 'static' })
          }
        })
        .catch((e) => {
          if (stale()) return
          setState({ imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS, loading: false, error: e?.message || String(e), source: 'static' })
        })
    }
    runRef.current = run
    run()
    // 키 저장/삭제(byok-key-changed: saveKey/clearKey 둘 다 dispatch) 시 재조회 —
    // 앱 시작 시 무키였다가 키를 넣은 신규 사용자/키 교체가 동적 목록·stale 치유에 반영되도록.
    const onKeyChanged = () => run()
    window.addEventListener('byok-key-changed', onKeyChanged)
    return () => {
      cancelled = true
      window.removeEventListener('byok-key-changed', onKeyChanged)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listModels, mode, flowTargetActive, chatgptTargetActive])

  // 외부 재조회 트리거(Flow 준비됨/설정 모달 오픈 등). Flow 스크랩이 마운트 타이밍에 빈손이어도
  //   페이지가 settle 된 뒤 다시 긁어 동적 목록을 채운다.
  const refetch = useCallback(() => { runRef.current() }, [])

  return { ...state, refetch }
}

export default useAvailableModels
