import { describe, it, expect } from 'vitest'
import { toJsonSchema } from '../../../../electron/api/llm/toJsonSchema.js'

describe('toJsonSchema', () => {
  it('중첩 properties/items/required를 재귀 변환한다', () => {
    const gemini = {
      type: 'OBJECT',
      properties: {
        scenes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { sceneNo: { type: 'INTEGER' }, summary: { type: 'STRING' } },
            required: ['sceneNo', 'summary'],
          },
        },
      },
      required: ['scenes'],
    }
    expect(toJsonSchema(gemini)).toEqual({
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sceneNo: { type: 'integer' }, summary: { type: 'string' } },
            required: ['sceneNo', 'summary'],
          },
        },
      },
      required: ['scenes'],
    })
  })
})
