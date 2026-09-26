/**
 * mcpModelProviderAlign — MCP update-settings 의 모델 키를 provider 와 맞춘다 (순수, 렌더러 전용).
 *
 * main 병합(리뷰 A F3): main 의 화이트리스트(mcpSettingsWhitelist)는 imageModel·videoModelT2V·videoModelF2V 를 64자 문자열로만 본다.
 *   multi-provider 에서 이 키들은 "현재 provider 의 활성 모델"이라, 다른 provider 의 카탈로그 모델을 그대로 넣으면
 *   {openai, gemini-3-pro-image} 같은 조합이 되어 이후 모든 생성이 그 adapter 에서 실패한다(computeModelHeal 은 비-google 을 고치지 않는다).
 *   카탈로그가 아는 모델이면 설정 화면(SceneTab)처럼 provider 를 그 모델의 provider 로 전환하고(이전 모델은 슬롯에 기억), 모델은 요청값으로 둔다.
 *   카탈로그 밖 이름(Flow 모델 이름 등)과 같은 provider 의 모델은 provider 를 건드리지 않는다.
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
  const image = typeof picked?.imageModel === 'string' ? IMAGE_MODELS.find((m) => m.id === picked.imageModel) : null
  if (image) next = { ...next, ...computeImageProviderSwitch(next, image.provider) }   // 같은 provider 면 {}
  for (const [stage, key] of VIDEO_STAGE_KEYS) {
    const video = typeof picked?.[key] === 'string' ? VIDEO_MODELS.find((m) => m.id === picked[key]) : null
    const current = next?.generation?.video?.[stage]?.provider ?? 'google'
    if (video && video.provider !== current) next = { ...next, ...computeVideoProviderSwitch(next, stage, video.provider) }
  }
  return { ...next, ...(picked || {}) }
}
