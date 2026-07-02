/** Gemini responseSchema 정의 — 스펙 §4-②/④ structured output. */
export const SCENES_SCHEMA = {
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
                emotion: { type: 'STRING' },
              },
              required: ['speaker', 'text'],
            },
          },
        },
        required: ['sceneNo', 'summary', 'segments'],
      },
    },
    speakers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, name: { type: 'STRING' } },
        required: ['id', 'name'],
      },
    },
  },
  required: ['scenes', 'speakers'],
}

export const PROMPTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sceneNo: { type: 'INTEGER' },
          imagePrompt: { type: 'STRING' },
          videoPrompt: { type: 'STRING' },
        },
        required: ['sceneNo', 'imagePrompt', 'videoPrompt'],
      },
    },
  },
  required: ['scenes'],
}
