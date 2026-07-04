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
            // M2b: narration/sfx 두 종류의 세그먼트를 한 배열에 담는다. Claude structured
            // validator가 oneOf/discriminated union을 지원하지 않으므로 스키마는 loose(모두
            // optional)로 두고, splitScenes 반환 후 validateScenesSegments로 type별 검증한다.
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING' }, // 'narration'(기본) | 'sfx'
                speaker: { type: 'STRING' }, // narration
                text: { type: 'STRING' }, // narration
                emotion: { type: 'STRING' }, // narration
                description: { type: 'STRING' }, // sfx — 효과음 생성 묘사
              },
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

/**
 * M2b post-validation — SCENES_SCHEMA가 loose(oneOf 미지원 우회)라 스키마만으로는
 * narration/sfx 세그먼트의 필수 필드를 강제할 수 없다. splitScenes 반환 후 type별로 검증:
 * narration은 speaker+text, sfx는 description. 알 수 없는 type은 거부한다.
 */
export function validateScenesSegments(scenes) {
  for (const sc of scenes || []) {
    for (const seg of sc.segments || []) {
      const type = seg.type || 'narration'
      if (type === 'narration') {
        if (typeof seg.speaker !== 'string' || !seg.speaker.trim()
          || typeof seg.text !== 'string' || !seg.text.trim()) {
          throw new Error(`invalid narration segment (speaker/text required) in scene ${sc.sceneNo}`)
        }
      } else if (type === 'sfx') {
        if (typeof seg.description !== 'string' || !seg.description.trim()) {
          throw new Error(`invalid sfx segment (description required) in scene ${sc.sceneNo}`)
        }
      } else {
        throw new Error(`unknown segment type '${type}' in scene ${sc.sceneNo}`)
      }
    }
  }
}

// M3: 대본 검토 structured output — verdict(pass/revise) + critique.
export const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING' }, // 'pass' | 'revise'
    critique: { type: 'STRING' },
  },
  required: ['verdict', 'critique'],
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
