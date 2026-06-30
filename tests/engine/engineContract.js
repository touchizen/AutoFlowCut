import { expect } from 'vitest'

// 엔진 계약(§3.1.1) — 모든 어댑터(engineApi, M4의 engineFlow)가 노출해야 하는 메서드.
// 값 필드(accessToken, projectId)는 별도 검사. 단일 진실원.
export const ENGINE_METHODS = [
  'getAccessToken', 'clearTokenCache', 'listModels',
  'generateImage', 'submitGeneration', 'checkGeneration', 'collectGeneration', 'clearGenerations',
  'uploadReference', 'fetchMedia',
  'generateVideoT2V', 'generateVideoI2V', 'checkVideoStatus', 'downloadVideo',
  'upscaleVideo', 'upscaleImage', 'fetchGallery', 'listFlowProjects', 'setStopRequested',
]

export function assertEngineContract(engine) {
  expect(engine).toHaveProperty('accessToken')
  expect(engine).toHaveProperty('projectId')
  for (const name of ENGINE_METHODS) {
    expect(typeof engine[name], `engine.${name} must be a function`).toBe('function')
  }
}
