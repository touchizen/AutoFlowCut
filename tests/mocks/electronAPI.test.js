import { describe, it, expect } from 'vitest'
import { mockElectronAPI } from './electronAPI.js'

describe('mockElectronAPI contract', () => {
  it('exposes Story LLM catalog bridge', () => {
    expect(typeof mockElectronAPI.storyListLlmOptions).toBe('function')
  })
})
