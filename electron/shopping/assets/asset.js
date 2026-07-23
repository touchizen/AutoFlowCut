import { createHash } from 'node:crypto'

import { canonicalStringify } from '../planCanonical.js'

export const SHOPPING_ASSET_VERSION = 'shopping-assets/1'

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export function computeAssetDigest(data) {
  return createHash('sha256').update(canonicalStringify(data), 'utf8').digest('hex')
}

/**
 * @template T
 * @param {string} sectionVersion
 * @param {T} data
 * @returns {Readonly<{
 *   assetVersion: 'shopping-assets/1',
 *   sectionVersion: string,
 *   digest: string,
 *   data: T,
 * }>}
 */
export function defineShoppingAsset(sectionVersion, data) {
  deepFreeze(data)
  return Object.freeze({
    assetVersion: SHOPPING_ASSET_VERSION,
    sectionVersion,
    digest: computeAssetDigest(data),
    data,
  })
}
