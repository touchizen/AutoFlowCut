/**
 * imageProviderSwitch — 전역 image provider 전환 시 settings 패치 계산 (순수).
 *
 * 규칙(§5.8 per-provider 모델 기억):
 *   - 현재 활성 모델(imageModel)을 현재 provider 슬롯(modelsByProvider)에 저장.
 *   - 새 provider 의 기억 모델을 복원, 없으면 그 provider 기본 모델.
 *   - generation.image.provider 를 새 provider 로. 다른 축(video 등)·다른 슬롯 보존.
 *   - 같은 provider 로 전환은 noop({}).
 */
import { defaultImageModelForProvider } from '../config/genModels'

/**
 * @param {object} settings - 현재 설정 (imageModel, generation, modelsByProvider)
 * @param {string} newProvider - 전환할 image provider id
 * @returns {object} setSettings 에 병합할 패치 (같은 provider 면 {})
 */
export function computeImageProviderSwitch(settings, newProvider) {
  const current = settings?.generation?.image?.provider ?? 'google'
  if (newProvider === current) return {}

  const remembered = settings?.modelsByProvider?.[newProvider]
  const nextModel = remembered ?? defaultImageModelForProvider(newProvider)

  return {
    generation: {
      ...settings?.generation,
      image: { ...settings?.generation?.image, provider: newProvider },
    },
    modelsByProvider: {
      ...settings?.modelsByProvider,
      [current]: settings?.imageModel, // 현재 모델을 이전 provider 슬롯에 기억
    },
    imageModel: nextModel,
  }
}
