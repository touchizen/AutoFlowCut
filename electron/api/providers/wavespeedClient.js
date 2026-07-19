/**
 * wavespeedClient.js — WaveSpeed configuration over the shared raw-REST queue transport.
 *
 * Base URL, endpoints, response codes, and result CDN/auth rules remain PROVISIONAL
 * until a real-key smoke passes. Bearer auth is the WaveSpeed-specific delta.
 */
import {
  classifyGatewayError,
  createGatewayClient,
} from './gatewayClient.js'

// PROVISIONAL — re-verify the exact API origin with a real WaveSpeed key.
export const WAVESPEED_BASE_URL = 'https://api.wavespeed.ai'
// PROVISIONAL — the real result URL may be signed and use a different CDN origin.
export const WAVESPEED_CDN_ORIGIN = 'https://cdn.wavespeed.ai'

/** PROVISIONAL WaveSpeed native error → shared errorKind taxonomy. */
export function classifyWaveSpeedError(httpStatus, payload) {
  return classifyGatewayError(httpStatus, payload)
}

/**
 * Encode each model-id segment independently so '/' remains a path separator (G4).
 * PROVISIONAL — exact /api/v3 submit template requires the real-key smoke.
 */
function assertSafePathSegment(seg, label) {
  if (seg === '' || seg === '.' || seg === '..') {
    throw new Error(`Invalid ${label} segment: ${JSON.stringify(seg)}`)
  }
}

export function buildWaveSpeedSubmitPath(modelId) {
  const segments = String(modelId).split('/')
  segments.forEach((segment) => assertSafePathSegment(segment, 'model'))
  return `/api/v3/${segments.map(encodeURIComponent).join('/')}`
}

function buildWaveSpeedPollPath(taskId) {
  const segment = String(taskId)
  assertSafePathSegment(segment, 'task')
  return `/api/v3/predictions/${encodeURIComponent(taskId)}`
}

function buildWaveSpeedAuthHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` }
}

export const downloadPolicy = {
  origins: [{
    // PROVISIONAL — real-key smoke re-verifies both origin and provider-key auth mode.
    // The actual result may be a signed URL, in which case authMode becomes 'none'.
    origin: WAVESPEED_CDN_ORIGIN,
    authMode: 'provider-key',
  }],
  buildAuthHeaders(creds) {
    return buildWaveSpeedAuthHeaders(creds)
  },
}

const waveSpeedGateway = createGatewayClient({
  providerName: 'WaveSpeed',
  baseUrl: WAVESPEED_BASE_URL,
  buildAuthHeaders: buildWaveSpeedAuthHeaders,
  submitPath: buildWaveSpeedSubmitPath,
  pollPath: buildWaveSpeedPollPath,
  validatePath: '/api/v3/models',
  classifyError: classifyWaveSpeedError,
  downloadPolicy,
})

export function waveSpeedFailure(httpStatus, payload, extras = {}) {
  return waveSpeedGateway.failure(httpStatus, payload, extras)
}

export async function submitWaveSpeedTask(
  { apiKey, modelId, input } = {},
  { fetchImpl } = {},
) {
  return waveSpeedGateway.submitTask({ apiKey, modelId, input }, { fetchImpl })
}

export async function pollWaveSpeedTask(
  { apiKey, taskId } = {},
  { fetchImpl } = {},
) {
  return waveSpeedGateway.pollTask({ apiKey, taskId }, { fetchImpl })
}

/** PROVISIONAL lightweight check; a real-key submit smoke remains authoritative. */
export async function validateWaveSpeedKey(
  { apiKey } = {},
  { fetchImpl } = {},
) {
  return waveSpeedGateway.validateKey({ apiKey }, { fetchImpl })
}

/** Download a trusted provisional WaveSpeed result asset with provider Bearer auth. */
export async function fetchWaveSpeedAsset(
  { apiKey, assetUrl } = {},
  { fetchImpl, defaultMimeType = 'video/mp4' } = {},
) {
  return waveSpeedGateway.fetchAsset({ apiKey, assetUrl }, { fetchImpl, defaultMimeType })
}
