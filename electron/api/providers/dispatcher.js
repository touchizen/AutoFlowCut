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

function attachErrorKind(res, provider) {
  if (res?.success === false && res.errorKind === undefined && provider === 'google') {
    res.errorKind = classifyGoogleErrorKind(res.error)
  }
  return res
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
      if (!apiKey) return attachErrorKind({ success: false, error: 'No API key' }, providerId)

      const { prompt, referenceImages, aspectRatio, model } = params
      const res = await provider.generateImage({
        apiKey,
        prompt,
        referenceImages,
        aspectRatio,
        model,
      }, engineDeps)
      return attachErrorKind(res, providerId)
    },

    async submitVideo(params = {}) {
      const providerId = params.provider || 'google'
      const provider = registry.getVideoProvider(providerId)
      if (!provider) return unknownProvider(providerId)

      const keyOps = resolveKeyOps(providerId, keyDeps)
      if (!keyOps) return unknownProvider(providerId)

      const apiKey = keyOps.getKey()
      if (!apiKey) return attachErrorKind({ success: false, error: 'No API key' }, providerId)

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

      const generationId = encodeHandle(provider.id, res.operationName)
      if (provider.id === 'google') {
        return { success: true, generationId, operationName: res.operationName }
      }
      return { success: true, generationId }
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
      if (!apiKey) return attachErrorKind({ success: false, error: 'No API key' }, providerId)

      const res = await provider.fetchVideoBase64({ apiKey, videoUri }, engineDeps)
      return attachErrorKind(res, providerId)
    },

    getKeyStatus() {
      const byProvider = Object.fromEntries(KEY_STATUS_PROVIDERS.map((providerId) => [
        providerId,
        resolveKeyOps(providerId, keyDeps).hasKey(),
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
      if (provider !== 'google') {
        return { valid: false, error: `Unknown provider: ${provider}` }
      }

      const key = apiKey || resolveKeyOps('google', keyDeps).getKey()
      if (!key) return { valid: false, error: 'No API key' }
      return validateApiKey({ apiKey: key }, engineDeps)
    },

    async listModels({ provider = 'google' } = {}) {
      if (provider !== 'google') return unknownProvider(provider)

      const key = resolveKeyOps('google', keyDeps).getKey()
      if (!key) return attachErrorKind({ success: false, error: 'No API key' }, provider)

      const res = await listModelsFromGenai({ apiKey: key }, engineDeps)
      return attachErrorKind(res, provider)
    },

    listProviders() {
      return registry.listProviders()
    },
  }
}
