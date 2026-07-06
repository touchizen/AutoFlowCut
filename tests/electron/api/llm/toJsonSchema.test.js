import { describe, it, expect } from 'vitest'
import { toJsonSchema, toOpenAiJsonSchema } from '../../../../electron/api/llm/toJsonSchema.js'

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

  it('OpenAI strict schema는 모든 object에 additionalProperties=false와 전체 required를 적용한다', () => {
    const gemini = {
      type: 'OBJECT',
      properties: {
        scenes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              sceneNo: { type: 'INTEGER' },
              summary: { type: 'STRING' },
              segments: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    speaker: { type: 'STRING' },
                    text: { type: 'STRING' },
                    description: { type: 'STRING' },
                  },
                },
              },
            },
            required: ['sceneNo', 'segments'],
          },
        },
        speakers: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              name: { type: 'STRING' },
              appearance: { type: 'STRING' },
            },
            required: ['id', 'name'],
          },
        },
      },
      required: ['scenes', 'speakers'],
    }

    const out = toOpenAiJsonSchema(gemini)
    expect(out).toMatchObject({
      type: 'object',
      required: ['scenes', 'speakers'],
      additionalProperties: false,
    })
    const scene = out.properties.scenes.items
    expect(scene.additionalProperties).toBe(false)
    expect(scene.required).toEqual(['sceneNo', 'summary', 'segments'])
    expect(scene.properties.summary.type).toEqual(['string', 'null'])
    const segment = scene.properties.segments.items
    expect(segment.additionalProperties).toBe(false)
    expect(segment.required).toEqual(['speaker', 'text', 'description'])
    expect(segment.properties.speaker.type).toEqual(['string', 'null'])
    const speaker = out.properties.speakers.items
    expect(speaker.additionalProperties).toBe(false)
    expect(speaker.required).toEqual(['id', 'name', 'appearance'])
    expect(speaker.properties.appearance.type).toEqual(['string', 'null'])
  })
})
