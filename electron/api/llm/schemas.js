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
        // V2: appearance = 이미지 생성용 영어 외형 묘사(얼굴·헤어·의상). narrator/비가시 화자는 생략(optional).
        properties: { id: { type: 'STRING' }, name: { type: 'STRING' }, appearance: { type: 'STRING' } },
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

// 대본·시놉시스 검수 전용 — 몰입감 점수(0~100)를 함께 낸다. 씬/프롬프트는 몰입감이 무의미해
// REVIEW_SCHEMA를 그대로 쓴다. score는 required가 아니다: 모델이 빠뜨렸다고 assertSchema가 검수
// 전체를 실패시키면 안 된다(점수가 없으면 배지만 숨긴다).
export const SCORED_REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING' },
    critique: { type: 'STRING' },
    score: { type: 'NUMBER' },
  },
  required: ['verdict', 'critique'],
}

// 0~100 정수로 정규화. 숫자가 아니면 null.
export function clampReviewScore(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

// 리서치 §3.4: 다수 자막 종합 구조분석 — 공통 서사 구조(structure) + 핵심 사실 주장(claims,
// sources=videoId) + 공통 논점(commonThemes). 교차검증(여러 영상 공통 주장 가중)은 프롬프트가 지시.
export const RESEARCH_ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    structure: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { beat: { type: 'STRING' }, summary: { type: 'STRING' } },
        required: ['beat', 'summary'],
      },
    },
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          claim: { type: 'STRING' },
          sources: { type: 'ARRAY', items: { type: 'STRING' } }, // 주장이 나온 videoId들
        },
        required: ['claim', 'sources'],
      },
    },
    commonThemes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['structure', 'claims', 'commonThemes'],
}

// 리서치 §3.5: 주장별 웹검색 팩트체크 — verdict(supported/refuted/unverified) + evidence(url/note).
export const FACTCHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          claim: { type: 'STRING' },
          verdict: { type: 'STRING' }, // 'supported' | 'refuted' | 'unverified'
          evidence: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { url: { type: 'STRING' }, note: { type: 'STRING' } },
              required: ['url', 'note'],
            },
          },
        },
        required: ['claim', 'verdict', 'evidence'],
      },
    },
  },
  required: ['claims'],
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
