/**
 * videoProviderSwitch — 영상 stage(t2v|i2v) provider 전환 시 settings 패치 계산 (순수).
 *   SceneTab 의 provider 버튼과 MCP update-settings(모델 키로 provider 정렬 — mcpModelProviderAlign)가 같이 쓴다.
 *   규칙은 imageProviderSwitch 와 같다: 현재 모델을 현재 provider 슬롯에 기억, 새 provider 의 기억 모델(없으면 기본) 복원, provider 교체.
 */
import { defaultVideoModelForProvider } from '../config/genModels'

export function computeVideoProviderSwitch(settings, stage, newProvider) {
  const modelKey = stage === 't2v' ? 'videoModelT2V' : 'videoModelF2V'
  const currentProvider = settings?.generation?.video?.[stage]?.provider ?? 'google'
  const stageMemory = settings?.modelsByProviderVideo?.[stage] || {}
  const remembered = stageMemory[newProvider]
  const nextModel = remembered ?? defaultVideoModelForProvider(newProvider) ?? undefined

  return {
    [modelKey]: nextModel,
    generation: {
      ...settings?.generation,
      video: {
        ...settings?.generation?.video,
        [stage]: {
          ...settings?.generation?.video?.[stage],
          provider: newProvider,
        },
      },
    },
    modelsByProviderVideo: {
      ...settings?.modelsByProviderVideo,
      [stage]: {
        ...stageMemory,
        [currentProvider]: settings?.[modelKey],
      },
    },
  }
}
