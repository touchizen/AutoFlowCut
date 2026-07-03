import { describe, it, expect } from 'vitest'

describe('claude-agent-sdk 로드', () => {
  it('query export가 존재한다', async () => {
    const mod = await import('@anthropic-ai/claude-agent-sdk')
    expect(typeof mod.query).toBe('function')
  })
})
