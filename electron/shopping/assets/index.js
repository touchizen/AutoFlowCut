export { computeAssetDigest, SHOPPING_ASSET_VERSION } from './asset.js'
export { personaMapping } from './personaMapping.js'
export { qualityChecks } from './qualityChecks.js'
export { scriptTemplates } from './scriptTemplates.js'
export { style } from './style.js'

import { personaMapping } from './personaMapping.js'
import { qualityChecks } from './qualityChecks.js'
import { scriptTemplates } from './scriptTemplates.js'
import { style } from './style.js'

export const shoppingAssets = Object.freeze({
  personaMapping,
  scriptTemplates,
  qualityChecks,
  style,
})
