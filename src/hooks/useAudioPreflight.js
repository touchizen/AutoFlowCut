import { useCallback } from 'react'

/**
 * useAudioPreflight — 오디오 생성 전 필요한 provider 키가 다 해석되는지 main 에 물어본다(spec §4.1/4.4).
 * pipeline.audioPreflight(params) 결과의 providers[].status 로 missing 을 골라 게이트 판단을 준다.
 * 렌더러는 이 결과를 표시만; 실제 실행은 main 이 다시 검사한다.
 */
export function useAudioPreflight(pipeline) {
  const check = useCallback(async (params) => {
    const res = await pipeline.audioPreflight(params)
    const providers = res?.providers || []
    const missing = providers.filter((p) => p.status === 'missing')
    return { ok: missing.length === 0, missing, providers, encryptionAvailable: res?.encryptionAvailable !== false }
  }, [pipeline])
  return { check }
}

export default useAudioPreflight
