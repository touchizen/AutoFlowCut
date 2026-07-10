import {
  STORY_LLM_OPTIONS,
  normalizeStoryLlmOptions,
} from '../../../src/utils/storyLlmCatalog.js'

export {
  STORY_LLM_OPTIONS,
  DEFAULT_STORY_LLM,
  findStoryLlmOption,
  findStoryLlmOptionById,
  hydrateStoryLlmSelection,
  normalizeStoryLlmOptions,
} from '../../../src/utils/storyLlmCatalog.js'

export { default } from '../../../src/utils/storyLlmCatalog.js'

// 카탈로그는 앱 시작 시 엔진에서 받아 채운다(storyLlmDiscovery). 렌더러가 보내는 model 은 그
// 동적 카탈로그의 값('sonnet')이므로, 메인의 라우터/스텝머신도 같은 카탈로그로 검증해야 한다.
let activeCatalog = STORY_LLM_OPTIONS

export function setActiveStoryLlmCatalog(catalog) {
  activeCatalog = Array.isArray(catalog) && catalog.length ? catalog : STORY_LLM_OPTIONS
}

export function getActiveStoryLlmCatalog() {
  return activeCatalog
}

export function normalizeActiveStoryLlmOptions(options = {}) {
  return normalizeStoryLlmOptions(options, activeCatalog)
}
