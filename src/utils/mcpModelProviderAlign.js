/**
 * mcpModelProviderAlign — MCP update-settings 의 모델 키를 provider 와 맞춘다 (순수, 렌더러 전용).
 *
 * main 병합(리뷰 A F3): main 의 화이트리스트(mcpSettingsWhitelist)는 imageModel·videoModelT2V·videoModelF2V 를 64자 문자열로만 본다.
 *   multi-provider 에서 이 키들은 "현재 provider 의 활성 모델"이라, 다른 provider 의 카탈로그 모델을 그대로 넣으면
 *   {openai, gemini-3-pro-image} 같은 조합이 되어 이후 모든 생성이 그 adapter 에서 실패한다(computeModelHeal 은 비-google 을 고치지 않는다).
 *   카탈로그가 아는 모델이면 설정 화면(SceneTab)처럼 provider 를 그 모델의 provider 로 전환하고(이전 모델은 슬롯에 기억), 모델은 요청값으로 둔다.
 *   카탈로그 밖 이름은 google 모델로 본다(R3-1). 같은 provider 면 provider·슬롯을 건드리지 않는다. Flow 모드는 정렬하지 않는다(R2-2).
 * main 프로세스(/api/update)는 현재 설정을 모르므로 여기(렌더러)에서만 한다.
 */
import { IMAGE_MODELS, VIDEO_MODELS } from '../config/genModels'
import { computeImageProviderSwitch } from './imageProviderSwitch'
import { computeVideoProviderSwitch } from './videoProviderSwitch'

const VIDEO_STAGE_KEYS = [['t2v', 'videoModelT2V'], ['i2v', 'videoModelF2V']]

/**
 * 리뷰 A R2-2: Flow 모드는 provider 축이 없다(설정 화면이 숨긴다) — 정렬하지 않고 그대로 병합한다(Flow heal 이 Flow 모델로 되돌린다).
 *   Flow 에서 정렬하면 API 로 돌아왔을 때 {openai, gemini-…} 같은 불일치가 되살아난다.
 * @returns 병합된 다음 설정(picked 가 마지막에 이긴다)
 */
export function alignMcpModelProviders(settings, picked, { appMode } = {}) {
  if (appMode === 'flow') return { ...(settings || {}), ...(picked || {}) }
  let next = { ...(settings || {}) }
  // 리뷰 A R3-1: 카탈로그 밖 이름(라벨·Flow 이름·동적 모델)은 google 모델로 본다(imageModelsForProvider 와 같은 규칙) — 비-google provider 에
  //   남기면 heal 도 못 고친다(비-google 은 heal 대상 아님). google 로 맞추면 heal 이 google 목록으로 검증한다.
  const providerOf = (catalog, id) => (catalog.find((m) => m.id === id)?.provider ?? 'google')
  if (typeof picked?.imageModel === 'string') next = { ...next, ...computeImageProviderSwitch(next, providerOf(IMAGE_MODELS, picked.imageModel)) }   // 같은 provider 면 {}
  for (const [stage, key] of VIDEO_STAGE_KEYS) {
    if (typeof picked?.[key] !== 'string') continue
    const target = providerOf(VIDEO_MODELS, picked[key])
    const current = next?.generation?.video?.[stage]?.provider ?? 'google'
    if (target !== current) next = { ...next, ...computeVideoProviderSwitch(next, stage, target) }
  }
  return { ...next, ...(picked || {}) }
}
