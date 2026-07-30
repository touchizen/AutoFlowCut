import { it, expect } from 'vitest'
import { computeModelHeal } from '../../src/config/genModels.js'

it('flow+chatgpt never heals API video settings with the Flow catalog', () => {
  const available = {
    loading: false,
    imageModels: [{ id: 'flow-image' }],
    videoModels: [{ id: 'flow-video' }],
  }
  const settings = { imageModel: 'api-image', videoModelT2V: 'api-t2v', videoModelF2V: 'api-i2v' }
  const patch = computeModelHeal(available, settings, 'flow', 'chatgpt')
  expect(patch).toEqual({})
})
