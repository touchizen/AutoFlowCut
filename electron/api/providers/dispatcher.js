import { validateApiKey, listModels as listModelsFromGenai } from '../genai.js'
import { classifyGoogleErrorKind } from './errorKind.js'
import { decodeHandle, encodeHandle } from './handle.js'
import { getImageProvider, getVideoProvider, listProviders } from './index.js'
import { resolveKeyOps } from './keyResolver.js'

const defaultRegistry = { getImageProvider, getVideoProvider, listProviders }
const KEY_STATUS_PROVIDERS = ['google', 'openai', 'grok', 'fal', 'wavespeed', 'higgsfield']

function unknownProvider(provider) {
  return {
    success: false,
    error: `Unknown provider: ${provider}`,
    errorKind: 'invalid-config',
  }
}

// 저장키 부재는 어떤 provider 든 'auth'(키 교체로 해결) — google-only classify 에 의존하지 않고
// 일관 부착(checkVideoStatus 의 per-item 'auth' 와 동일 의미, M1 비-google 등록 시 비대칭 방지).
function noApiKey() {
  return { success: false, error: 'No API key', errorKind: 'auth' }
}

function attachErrorKind(res, provider) {
  if (res?.success === false && res.errorKind === undefined && provider === 'google') {
    res.errorKind = classifyGoogleErrorKind(res.error)
  }
  return res
}

// §5.6 download 라우팅 방어: provider 가 downloadPolicy 를 선언하면 videoUri origin 을 그 allowlist 와
// 정확 대조(scheme+host+port, url.origin) + HTTPS 강제. 비매칭/비-HTTPS 면 키를 붙이지 않고 거부해
// 손상된 project.json·렌더러가 임의 origin 으로 provider 키를 유출하는 것을 막는다.
// downloadPolicy 미선언 provider(google)는 기존 동작(신뢰된 googleapis URI) 유지 — 하위호환.
function checkDownloadOrigin(videoUri, downloadPolicy) {
  let url
  try { url = new URL(String(videoUri)) } catch { return 'Invalid video URI' }
  if (url.protocol !== 'https:') return 'Video URI must use HTTPS'
  const allowed = (downloadPolicy.origins || []).some((o) => o.origin === url.origin)
  if (!allowed) return `Video URI origin not allowed by download policy: ${url.origin}`
  return null
}

function failureStatus(generationId, error, errorKind) {
  const status = { generationId, status: 'failed', error }
  if (errorKind !== undefined) status.errorKind = errorKind
  return status
}

export function createDispatcher({
  genaiKeyStore,
  multiKeyStore,
  engineDeps = {},
  registry = defaultRegistry,
} = {}) {
  const keyDeps = { genaiKeyStore, multiKeyStore }

  return {
    async generateImage(params = {}) {
      const providerId = params.provider || 'google'
      const provider = registry.getImageProvider(providerId)
      if (!provider) return unknownProvider(providerId)

      const keyOps = resolveKeyOps(providerId, keyDeps)
      if (!keyOps) return unknownProvider(providerId)

      const apiKey = keyOps.getKey()
      if (!apiKey) return noApiKey()

      const { prompt, referenceImages, aspectRatio, model } = params
      const res = await provider.generateImage({
        apiKey,
        prompt,
        referenceImages,
        aspectRatio,
        model,
      }, engineDeps)
      // §2.2/§5.9: 성공 이미지에 actualAspectRatio 를 항상 실어 표면화(값 or null).
      // 근사 provider(openai 16:9→3:2)는 값, 정확 provider(google)는 undefined→null.
      if (res?.success) res.actualAspectRatio = res.actualAspectRatio ?? null
      return attachErrorKind(res, providerId)
    },

    async submitVideo(params = {}) {
      const providerId = params.provider || 'google'
      const provider = registry.getVideoProvider(providerId)
      if (!provider) return unknownProvider(providerId)

      const keyOps = resolveKeyOps(providerId, keyDeps)
      if (!keyOps) return unknownProvider(providerId)

      const apiKey = keyOps.getKey()
      if (!apiKey) return noApiKey()

      const {
        prompt,
        image,
        endImage,
        referenceImages,
        aspectRatio,
        durationSeconds,
        model,
        seed,
        resolution,
      } = params
      const res = await provider.submitVideo({
        apiKey,
        prompt,
        image,
        endImage,
        referenceImages,
        aspectRatio,
        durationSeconds,
        model,
        seed,
        resolution,
      }, engineDeps)
      if (!res.success) return attachErrorKind(res, providerId)

      if (provider.id === 'google') {
        const generationId = encodeHandle(provider.id, res.operationName)
        return { success: true, generationId, operationName: res.operationName, appliedInputs: res.appliedInputs }
      }
      const generationId = encodeHandle(provider.id, res.rawId)
      return { success: true, generationId, appliedInputs: res.appliedInputs }
    },

    async checkVideoStatus({ generationIds = [] } = {}) {
      const statuses = await Promise.all(generationIds.map(async (generationId) => {
        let decoded
        try {
          decoded = decodeHandle(generationId)
        } catch (error) {
          return failureStatus(
            generationId,
            error?.message || String(error),
            'invalid-config'
          )
        }

        const { provider: providerId, rawId } = decoded
        const provider = registry.getVideoProvider(providerId)
        const keyOps = resolveKeyOps(providerId, keyDeps)
        if (!provider || !keyOps) {
          return failureStatus(
            generationId,
            `Unknown provider: ${providerId}`,
            'invalid-config'
          )
        }

        const apiKey = keyOps.getKey()
        if (!apiKey) return failureStatus(generationId, 'No API key', 'auth')

        const res = attachErrorKind(
          await provider.checkVideo({ apiKey, operationName: rawId }, engineDeps),
          providerId
        )
        if (!res.success) {
          return failureStatus(generationId, res.error, res.errorKind)
        }
        if (!res.done) return { generationId, status: 'pending' }
        return { generationId, status: 'completed', videoUri: res.videoUri }
      }))

      return { success: true, statuses }
    },

    async downloadVideo({ videoUri, generationId } = {}) {
      let providerId = 'google'
      if (generationId !== undefined) {
        try {
          providerId = decodeHandle(generationId).provider
        } catch (error) {
          return {
            success: false,
            error: error?.message || String(error),
            errorKind: 'invalid-config',
          }
        }
      }

      const provider = registry.getVideoProvider(providerId)
      const keyOps = resolveKeyOps(providerId, keyDeps)
      if (!provider || !keyOps) return unknownProvider(providerId)

      const apiKey = keyOps.getKey()
      if (!apiKey) return noApiKey()

      // §5.6: downloadPolicy 를 선언한 provider 는 origin allowlist·HTTPS 통과해야 키 부착 다운로드.
      if (provider.downloadPolicy) {
        const policyError = checkDownloadOrigin(videoUri, provider.downloadPolicy)
        if (policyError) return { success: false, error: policyError, errorKind: 'invalid-config' }
      }

      const res = await provider.fetchVideoBase64({ apiKey, videoUri }, engineDeps)
      return attachErrorKind(res, providerId)
    },

    getKeyStatus() {
      // null-guard: KEY_STATUS_PROVIDERS 와 keyResolver 슬롯 맵이 어긋나도(둘이 평행 리스트)
      // get-key-status IPC 전체가 TypeError 로 죽지 않게 미해결 provider 는 false.
      const byProvider = Object.fromEntries(KEY_STATUS_PROVIDERS.map((providerId) => [
        providerId,
        resolveKeyOps(providerId, keyDeps)?.hasKey() ?? false,
      ]))
      return {
        hasKey: byProvider.google,
        encryptionAvailable: genaiKeyStore.isEncryptionAvailable(),
        byProvider,
      }
    },

    setKey({ provider = 'google', apiKey } = {}) {
      const keyOps = resolveKeyOps(provider, keyDeps)
      if (!keyOps) return { success: false, error: `Unknown provider: ${provider}` }
      return keyOps.setKey(apiKey)
    },

    clearKey({ provider = 'google' } = {}) {
      const keyOps = resolveKeyOps(provider, keyDeps)
      if (!keyOps) return { success: false, error: `Unknown provider: ${provider}` }
      return keyOps.clearKey()
    },

    async validateKey({ provider = 'google', apiKey } = {}) {
      if (provider === 'google') {
        const key = apiKey || resolveKeyOps('google', keyDeps).getKey()
        if (!key) return { valid: false, error: 'No API key' }
        return validateApiKey({ apiKey: key }, engineDeps)
      }

      // non-google: provider 객체의 네이티브 validateKey(모달리티 무관 — image/video 어느 레지스트리든).
      const providerObj = registry.getImageProvider(provider) || registry.getVideoProvider(provider)
      if (!providerObj || typeof providerObj.validateKey !== 'function') {
        return { valid: false, error: `Unknown provider: ${provider}` }
      }
      const keyOps = resolveKeyOps(provider, keyDeps)
      const key = apiKey || (keyOps ? keyOps.getKey() : null)
      if (!key) return { valid: false, error: 'No API key' }
      return providerObj.validateKey({ apiKey: key }, engineDeps)
    },

    async listModels({ provider = 'google' } = {}) {
      if (provider !== 'google') return unknownProvider(provider)

      const key = resolveKeyOps('google', keyDeps).getKey()
      if (!key) return noApiKey()

      const res = await listModelsFromGenai({ apiKey: key }, engineDeps)
      return attachErrorKind(res, provider)
    },

    listProviders() {
      return registry.listProviders()
    },
  }
}
