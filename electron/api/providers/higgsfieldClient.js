/**
 * higgsfieldClient.js — Higgsfield configuration over the shared raw-REST queue transport.
 *
 * All Higgsfield API details remain PROVISIONAL until a real-key smoke passes.
 * HTTP Basic key+secret auth is the G1 provider delta.
 */
import {
  classifyGatewayError,
  createGatewayClient,
} from './gatewayClient.js'

// PROVISIONAL — re-verify exact API origin with a real Higgsfield key pair.
export const HIGGSFIELD_BASE_URL = 'https://api.higgsfield.ai'
// PROVISIONAL — re-verify result origin and auth mode with a real Higgsfield job.
export const HIGGSFIELD_CDN_ORIGIN = 'https://cdn.higgsfield.ai'

/** PROVISIONAL Higgsfield native error → shared errorKind taxonomy. */
export function classifyHiggsfieldError(httpStatus, payload) {
  return classifyGatewayError(httpStatus, payload)
}

/** PROVISIONAL G1: split the stored combined `key:secret` credential. */
export function buildHiggsfieldAuthHeaders(creds) {
  const combined = typeof creds === 'string' ? creds : ''
  const separator = combined.indexOf(':')
  const key = separator >= 0 ? combined.slice(0, separator).trim() : ''
  const secret = separator >= 0 ? combined.slice(separator + 1).trim() : ''
  if (!key || !secret) {
    throw new Error('Higgsfield requires key:secret credentials')
  }
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`, 'utf8').toString('base64')}`,
  }
}

function buildHiggsfieldSubmitPath() {
  // PROVISIONAL — verify exact video submit path with a real-key smoke.
  return '/v1/video/generations'
}

function buildHiggsfieldPollPath(taskId) {
  const segment = String(taskId)
  if (segment === '' || segment === '.' || segment === '..') {
    throw new Error(`Invalid Higgsfield task segment: ${JSON.stringify(segment)}`)
  }
  // PROVISIONAL — verify exact job-status path with a real-key smoke.
  return `/v1/video/generations/${encodeURIComponent(segment)}`
}

export const downloadPolicy = {
  origins: [{
    // PROVISIONAL — the actual result may be signed and use a different CDN origin.
    origin: HIGGSFIELD_CDN_ORIGIN,
    authMode: 'provider-key',
  }],
  buildAuthHeaders(creds) {
    return buildHiggsfieldAuthHeaders(creds)
  },
}

const higgsfieldGateway = createGatewayClient({
  providerName: 'Higgsfield',
  baseUrl: HIGGSFIELD_BASE_URL,
  buildAuthHeaders: buildHiggsfieldAuthHeaders,
  submitPath: buildHiggsfieldSubmitPath,
  pollPath: buildHiggsfieldPollPath,
  validatePath: '/v1/models', // PROVISIONAL — real-key smoke must verify this lightweight endpoint.
  classifyError: classifyHiggsfieldError,
  downloadPolicy,
})

export function higgsfieldFailure(httpStatus, payload, extras = {}) {
  return higgsfieldGateway.failure(httpStatus, payload, extras)
}

export async function submitHiggsfieldTask(
  { apiKey, input } = {},
  { fetchImpl } = {},
) {
  return higgsfieldGateway.submitTask({ apiKey, modelId: undefined, input }, { fetchImpl })
}

export async function pollHiggsfieldTask(
  { apiKey, taskId } = {},
  { fetchImpl } = {},
) {
  return higgsfieldGateway.pollTask({ apiKey, taskId }, { fetchImpl })
}

/** PROVISIONAL lightweight check; a real-key submit smoke remains authoritative. */
export async function validateHiggsfieldKey(
  { apiKey } = {},
  { fetchImpl } = {},
) {
  return higgsfieldGateway.validateKey({ apiKey }, { fetchImpl })
}

/** Download a trusted PROVISIONAL Higgsfield result with Basic-pair auth. */
export async function fetchHiggsfieldAsset(
  { apiKey, assetUrl } = {},
  { fetchImpl, defaultMimeType = 'video/mp4' } = {},
) {
  return higgsfieldGateway.fetchAsset({ apiKey, assetUrl }, { fetchImpl, defaultMimeType })
}
