/**
 * useAppSettings — 앱 설정 관리 (초기화 + localStorage 동기화)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { DEFAULTS, UI } from '../config/defaults'
import { generateProjectName } from '../utils/formatters'
import { DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID } from '../config/genModels'

const STORAGE_KEY = 'autoflowcut_settings'

function createDefaults() {
  const randomSeed = () => Math.floor(Math.random() * 1000000)
  return {
    defaultDuration: DEFAULTS.scene.duration,
    projectName: DEFAULTS.project.defaultName,
    aspectRatio: '16:9', // 프로젝트 화면비: '16:9' 롱폼 / '9:16' 숏폼
    saveMode: 'folder',
    concurrency: DEFAULTS.generation.concurrency,
    videoConcurrency: DEFAULTS.generation.videoConcurrency,
    flowAgentOn: DEFAULTS.generation.flowAgentOn,
    flowPacingMinMs: DEFAULTS.generation.flowPacingMinMs,  // Flow 제출 사이 최소 대기(ms)
    flowPacingMaxMs: DEFAULTS.generation.flowPacingMaxMs,  // Flow 제출 사이 최대 대기(ms)
    exportThreshold: UI.EXPORT_THRESHOLD,
    imageBatchCount: 1,
    imageUpscale: 'off',
    videoBatchCount: 1,
    imageModel: DEFAULT_IMAGE_MODEL_ID,        // T2I 모델 (선택 provider 의 활성 모델 — 하위호환)
    // M1 §5.8: 전역 image provider 축 + provider별 모델 기억.
    // imageModel 은 "선택 provider 의 활성 모델"로 유지(기존 consumer 하위호환).
    generation: {
      image: { provider: 'google' },
      video: {
        t2v: { provider: 'google' },
        i2v: { provider: 'google' },
      },
    },
    modelsByProvider: { google: DEFAULT_IMAGE_MODEL_ID },
    videoModelT2V: DEFAULT_VIDEO_MODEL_ID,      // T2V 모델
    videoModelF2V: DEFAULT_VIDEO_MODEL_ID,      // F2V 모델
    // M2-pre §5.8: T2V/I2V 단계별 provider 모델 기억. flat videoModel* 필드는
    // 현재 단계의 활성 모델로 유지해 기존 consumer와 하위 호환한다.
    modelsByProviderVideo: {
      t2v: { google: DEFAULT_VIDEO_MODEL_ID },
      i2v: { google: DEFAULT_VIDEO_MODEL_ID },
    },
    videoResolution: '720p',
    requireStyle: false,
    seedNo: randomSeed(),
    seedLocked: true,
    mcpHttpEnabled: false,
    mcpHttpPort: 3210
  }
}

function loadSettings() {
  const defaults = createDefaults()
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    const parsed = JSON.parse(saved)
    // 이전 버전 호환: 불필요한 설정 제거
    delete parsed.method
    // seedNo 가 없거나 유효하지 않으면 랜덤으로 초기화
    if (typeof parsed.seedNo !== 'number' || !Number.isFinite(parsed.seedNo)) {
      parsed.seedNo = defaults.seedNo
    }
    const merged = { ...defaults, ...parsed }
    // 옛 Flow(none) 저장 모드 폐기 — 공식 API 는 base64 만 오므로 작업폴더 저장이 필수.
    // 'none'/legacy 값은 'folder' 로 강제 (설정 UI 의 저장 방식 토글도 제거됨).
    if (merged.saveMode !== 'folder') merged.saveMode = 'folder'
    // M1 §5.8 마이그레이션(멱등): flat imageModel → 전역 image provider 축 + provider별 모델 기억.
    // 기존 사용자는 generation/modelsByProvider 가 없다 → google 로 채우고 현재 imageModel 을 시드.
    // generation.image.provider 는 저장값(parsed)만 신뢰 — defaults 병합값이 아닌 실제 저장 구조로 판정.
    merged.generation = (parsed.generation && typeof parsed.generation === 'object') ? { ...parsed.generation } : {}
    merged.generation.image = (merged.generation.image && typeof merged.generation.image === 'object') ? { ...merged.generation.image } : {}
    if (!merged.generation.image.provider) merged.generation.image.provider = 'google'
    const imgProvider = merged.generation.image.provider
    // provider/model desync 방지: 스펙 shape 의 nested generation.image.model 이 있으면 활성 모델로 정합.
    // (UI 는 flat imageModel 을 쓰지만, nested model 로 저장된 설정을 로드할 때 provider=openai +
    //  model=gemini 로 어긋나는 것을 막는다.)
    // **consume-once**: 반영 후 삭제한다 — 남겨두면 아무도 갱신 안 하는 stale nested model 이
    // 매 로드마다 사용자의 이후 모델 선택을 덮어써 되돌린다(Fable 리뷰). flat imageModel 이 단일 진실.
    if (merged.generation.image.model) {
      merged.imageModel = merged.generation.image.model
      delete merged.generation.image.model
    }
    // M2-pre §5.8 마이그레이션(멱등): flat videoModelT2V/videoModelF2V ↔ 단계별
    // provider 축을 연결한다. 스펙 nested model은 M1 image와 같이 한 번 flat active
    // model로 소비하고 삭제해, 재로드 시 이후 사용자 선택을 덮어쓰지 않게 한다.
    merged.generation.video = (merged.generation.video && typeof merged.generation.video === 'object')
      ? { ...merged.generation.video }
      : {}
    merged.generation.video.t2v = (merged.generation.video.t2v && typeof merged.generation.video.t2v === 'object')
      ? { ...merged.generation.video.t2v }
      : {}
    merged.generation.video.i2v = (merged.generation.video.i2v && typeof merged.generation.video.i2v === 'object')
      ? { ...merged.generation.video.i2v }
      : {}
    if (!merged.generation.video.t2v.provider) merged.generation.video.t2v.provider = 'google'
    if (!merged.generation.video.i2v.provider) merged.generation.video.i2v.provider = 'google'
    if (merged.generation.video.t2v.model) {
      merged.videoModelT2V = merged.generation.video.t2v.model
      delete merged.generation.video.t2v.model
    }
    if (merged.generation.video.i2v.model) {
      merged.videoModelF2V = merged.generation.video.i2v.model
      delete merged.generation.video.i2v.model
    }
    // provider별 모델 기억: 저장된 modelsByProvider 가 없으면 옛 설정 → (정합된) imageModel 을 그 슬롯에 시드.
    if (parsed.modelsByProvider && typeof parsed.modelsByProvider === 'object') {
      merged.modelsByProvider = { ...parsed.modelsByProvider }
      if (merged.modelsByProvider[imgProvider] == null) merged.modelsByProvider[imgProvider] = merged.imageModel
    } else {
      merged.modelsByProvider = { [imgProvider]: merged.imageModel }
    }
    const t2vProvider = merged.generation.video.t2v.provider
    const i2vProvider = merged.generation.video.i2v.provider
    const savedVideoMemory = (parsed.modelsByProviderVideo && typeof parsed.modelsByProviderVideo === 'object')
      ? parsed.modelsByProviderVideo
      : {}
    merged.modelsByProviderVideo = {
      t2v: (savedVideoMemory.t2v && typeof savedVideoMemory.t2v === 'object') ? { ...savedVideoMemory.t2v } : {},
      i2v: (savedVideoMemory.i2v && typeof savedVideoMemory.i2v === 'object') ? { ...savedVideoMemory.i2v } : {},
    }
    if (merged.modelsByProviderVideo.t2v[t2vProvider] == null) {
      merged.modelsByProviderVideo.t2v[t2vProvider] = merged.videoModelT2V
    }
    if (merged.modelsByProviderVideo.i2v[i2vProvider] == null) {
      merged.modelsByProviderVideo.i2v[i2vProvider] = merged.videoModelF2V
    }
    // 모델 id 는 coerce 하지 않고 저장값을 그대로 보존한다 — 정적 카탈로그에 없는 동적
    // /models 모델을 선택·저장했을 때 reload 마다 기본값으로 되돌아가지 않도록(리뷰 P2).
    // 실제 사용 가능 여부는 /models 로드 후 ModelSelector 가 조정(없으면 합성 옵션 노출).
    return merged
  }
  return defaults
}

/**
 * @returns {{ settings, setSettings, updateSetting, ensureProjectName, projectNameRef }}
 */
export function useAppSettings() {
  const [settings, setSettings] = useState(loadSettings)
  const projectNameRef = useRef(settings.projectName)
  // 비동기 coordinator는 렌더 closure가 아니라 현재 프로젝트를 읽어야 한다.
  // 프로젝트 전환으로 settings가 바뀌면 render 시점에 즉시 mirror한다.
  projectNameRef.current = settings.projectName

  // localStorage 동기화
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  // 개별 설정값 변경 헬퍼
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  /**
   * 프로젝트명을 보장한다.
   * - 이미 유효한 값이 있으면 그대로 반환
   * - 없으면(빈 문자열/falsy) 새 이름을 생성해 settings에 고정하고 반환
   *
   * 호출마다 Date.now()가 새로 찍혀 여러 개의 autoflowcut_<ts> 고아 폴더가
   * 만들어지는 문제를 방지하기 위해, React setter보다 ref를 먼저 갱신한다.
   * 같은 tick의 연속 호출은 re-render를 기다리지 않고 방금 확정한 이름을 본다.
   */
  const ensureProjectName = useCallback(() => {
    const current = projectNameRef.current
    if (current && typeof current === 'string' && current.trim()) {
      return current
    }
    const generated = generateProjectName()
    projectNameRef.current = generated
    setSettings(prev => {
      // 동일 렌더에서 다른 호출이 이미 이름을 확정했다면 그 값 유지
      if (prev.projectName && typeof prev.projectName === 'string' && prev.projectName.trim()) {
        return prev
      }
      return { ...prev, projectName: generated }
    })
    return generated
  }, [])

  return { settings, setSettings, updateSetting, ensureProjectName, projectNameRef }
}
