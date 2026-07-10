/**
 * OpenAI Codex SDK Story LLM adapter — llmClaude와 같은 public signature를 제공한다.
 * 인증은 Codex CLI의 ChatGPT 로그인 세션을 사용하며, 실행 세부 옵션은 codexSdk helper가 고정한다.
 */
import {
  buildContinuePrompt,
  buildPromptsPrompt,
  buildReviewPrompt,
  buildRevisePrompt,
  buildSynopsisReviewPrompt,
  buildSynopsisRevisePrompt,
  buildScenesReviewPrompt,
  buildScenesRevisePrompt,
  buildPromptsReviewPrompt,
  buildPromptsRevisePrompt,
  buildScriptPrompt,
  buildSplitPrompt,
  buildSynopsisPrompt,
  buildCharacterExtractPrompt,
  buildSynopsisFromScriptPrompt,
  buildTitlePrompt,
  buildResearchAnalyzePrompt,
} from './prompts.js'
import { runCodexJson, runCodexText } from './codexSdk.js'
import { splitSynopsisOutput, parseCharactersJson, createSynopsisDeltaGate } from './synopsisOutput.js'
import { toOpenAiJsonSchema } from './toJsonSchema.js'
import { PROMPTS_SCHEMA, REVIEW_SCHEMA, SCORED_REVIEW_SCHEMA, clampReviewScore, SCENES_SCHEMA, RESEARCH_ANALYSIS_SCHEMA, validateScenesSegments } from './schemas.js'
import { isNarratorSpeaker as isNarratorTrackSpeaker } from '../../../src/utils/storyNarrationTracks.js'

export const DEFAULT_MODEL = 'gpt-5.5'

const STORY_BACKEND_GUARD = [
  'You are being used as an AutoFlowCut Story text generation backend.',
  'Return only the requested story content or JSON. Do not include explanations unless the requested output explicitly asks for them.',
  'Do not inspect local files, run shell commands, call tools, use MCP servers, browse the web, or modify the workspace.',
].join('\n')

function guardPrompt(prompt) {
  return `${STORY_BACKEND_GUARD}\n\n${prompt}`
}

function guardScenesPrompt(prompt) {
  return guardPrompt([
    prompt,
    '',
    'Codex strict JSON rules for SCENES_SCHEMA:',
    '- Include every schema property. Use null for fields that are not applicable; do not omit fields.',
    '- Narration/dialogue segment: type="narration", speaker/text/emotion are strings, description=null.',
    '- SFX segment: type="sfx", description is a short English sound description, speaker/text/emotion=null.',
    '- Every non-narrator speaker used in narration/dialogue segments must have a non-empty English appearance. Use appearance=null only for narrator.',
  ].join('\n'))
}

function runtimeOptions(opts = {}) {
  const out = { model: opts.model || DEFAULT_MODEL }
  if (opts.reasoningEffort) out.reasoningEffort = opts.reasoningEffort
  return out
}

function codexSchema(schema) {
  return toOpenAiJsonSchema(schema)
}

const speakerKey = (v) => String(v || '').replace(/\s/g, '').toLowerCase()
const isNarratorSpeaker = (v) => isNarratorTrackSpeaker(v)

function validateVisibleSpeakerAppearances(scenes = [], speakers = [], fallbackSpeakers = []) {
  const byKey = new Map()
  for (const sp of speakers || []) {
    if (sp?.id) byKey.set(speakerKey(sp.id), sp)
    if (sp?.name) byKey.set(speakerKey(sp.name), sp)
  }
  const fallbackByKey = new Map()
  for (const sp of fallbackSpeakers || []) {
    if (sp?.id) fallbackByKey.set(speakerKey(sp.id), sp)
    if (sp?.name) fallbackByKey.set(speakerKey(sp.name), sp)
  }
  for (const scene of scenes || []) {
    for (const seg of scene.segments || []) {
      if ((seg.type || 'narration') !== 'narration') continue
      if (isNarratorSpeaker(seg.speaker)) continue
      const speaker = byKey.get(speakerKey(seg.speaker)) || fallbackByKey.get(speakerKey(seg.speaker))
      if (!speaker) throw new Error(`Codex scenes speaker '${seg.speaker}' missing from speakers list`)
      const fallback = fallbackByKey.get(speakerKey(speaker.id)) || fallbackByKey.get(speakerKey(speaker.name))
      const appearance = speaker.appearance ?? fallback?.appearance
      if (typeof appearance !== 'string' || !appearance.trim()) {
        throw new Error(`Codex scenes speaker appearance required for ${speaker.name || speaker.id || seg.speaker}`)
      }
    }
  }
}

export async function generateScript(input, opts = {}, { onDelta, signal, runText = runCodexText } = {}) {
  const prompt = guardPrompt(buildScriptPrompt(input, opts))
  const scriptMd = await runText(prompt, runtimeOptions(opts), { onDelta, signal })
  return { scriptMd }
}

// §3.1 / §v2.8 M4: 시놉시스 게이트 — title은 스트리밍(줄거리+등장인물 JSON),
// pasted는 non-streaming 등장인물 역추출만. 마커 없음/JSON 깨짐은 characters=[] 폴백.
export async function generateSynopsis(input, opts = {}, { onDelta, signal, runText = runCodexText } = {}) {
  if (input?.type === 'pasted') {
    // 대본에서 시놉시스(로그라인/훅/구조/몰입감)+등장인물을 함께 역추출.
    const prompt = guardPrompt(buildSynopsisFromScriptPrompt(input.pastedScript, opts))
    const text = await runText(prompt, runtimeOptions(opts), { signal })
    return splitSynopsisOutput(text)
  }
  const prompt = guardPrompt(buildSynopsisPrompt(input, opts))
  const gate = createSynopsisDeltaGate(onDelta)
  const full = await runText(prompt, runtimeOptions(opts), { onDelta: gate, signal })
  return splitSynopsisOutput(full)
}

export async function generateTitle(scriptMd, opts = {}, { signal, runText = runCodexText } = {}) {
  const prompt = guardPrompt(buildTitlePrompt(scriptMd, opts))
  const text = await runText(prompt, runtimeOptions(opts), { signal })
  return { title: String(text || '').split('\n')[0].trim() }
}

export async function continueScript(existingScript, opts = {}, { onDelta, signal, runText = runCodexText } = {}) {
  const prompt = guardPrompt(buildContinuePrompt(existingScript, opts))
  const added = await runText(prompt, runtimeOptions(opts), { onDelta, signal })
  return { scriptMd: `${existingScript}\n\n${added}` }
}

export async function splitScenes(scriptMd, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardScenesPrompt(buildSplitPrompt(scriptMd, opts))
  const out = await runJson(prompt, codexSchema(SCENES_SCHEMA), runtimeOptions(opts), { signal })
  const scenes = out.scenes || []
  validateScenesSegments(scenes)
  validateVisibleSpeakerAppearances(scenes, out.speakers || [])
  return { scenes, speakers: out.speakers || [] }
}

export async function reviewScript(scriptMd, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildReviewPrompt(scriptMd, opts))
  const out = await runJson(prompt, codexSchema(SCORED_REVIEW_SCHEMA), runtimeOptions(opts), { signal })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '', score: clampReviewScore(out.score) }
}

export async function reviseScript(scriptMd, critique, opts = {}, { signal, runText = runCodexText } = {}) {
  const prompt = guardPrompt(buildRevisePrompt(scriptMd, critique, opts))
  const revised = await runText(prompt, runtimeOptions(opts), { signal })
  return { scriptMd: revised }
}

// 시놉시스 검수(spec 2026-07-10) — reviewScript 미러.
export async function reviewSynopsis(synopsisMd, characters = [], opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildSynopsisReviewPrompt(synopsisMd, characters, opts))
  const out = await runJson(prompt, codexSchema(SCORED_REVIEW_SCHEMA), runtimeOptions(opts), { signal })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '', score: clampReviewScore(out.score) }
}

// 스키마 없음 — CHARACTERS_JSON 마커 텍스트를 splitSynopsisOutput으로 분해(generateSynopsis와 동일 계약).
export async function reviseSynopsis(synopsisMd, characters = [], critique, opts = {}, { signal, runText = runCodexText } = {}) {
  const prompt = guardPrompt(buildSynopsisRevisePrompt(synopsisMd, characters, critique, opts))
  const text = await runText(prompt, runtimeOptions(opts), { signal })
  return splitSynopsisOutput(text)
}

export async function reviewScenes(scriptMd, scenes, speakers, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildScenesReviewPrompt(scriptMd, scenes, speakers, opts))
  const out = await runJson(prompt, codexSchema(REVIEW_SCHEMA), runtimeOptions(opts), { signal })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '' }
}

export async function reviseScenes(scriptMd, scenes, speakers, critique, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardScenesPrompt(buildScenesRevisePrompt(scriptMd, scenes, speakers, critique, opts))
  const out = await runJson(prompt, codexSchema(SCENES_SCHEMA), runtimeOptions(opts), { signal })
  const revisedScenes = out.scenes || []
  validateScenesSegments(revisedScenes)
  validateVisibleSpeakerAppearances(revisedScenes, out.speakers || [], speakers)
  return { scenes: revisedScenes, speakers: out.speakers || [] }
}

export async function reviewPrompts(scenes, context, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildPromptsReviewPrompt(scenes, context, opts))
  const out = await runJson(prompt, codexSchema(REVIEW_SCHEMA), runtimeOptions(opts), { signal })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '' }
}

export async function revisePrompts(scenes, context, critique, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildPromptsRevisePrompt(scenes, context, critique, opts))
  const out = await runJson(prompt, codexSchema(PROMPTS_SCHEMA), runtimeOptions(opts), { signal })
  const byNo = new Map((out.scenes || []).map((s) => [s.sceneNo, s]))
  for (const s of scenes) {
    const p = byNo.get(s.sceneNo)
    if (!p || typeof p.imagePrompt !== 'string' || !p.imagePrompt.trim()
        || typeof p.videoPrompt !== 'string' || !p.videoPrompt.trim()) {
      throw new Error(`revisePrompts: scene ${s.sceneNo} missing/empty prompt`)
    }
  }
  return {
    scenes: scenes.map((s) => ({
      ...s,
      imagePrompt: byNo.get(s.sceneNo).imagePrompt,
      videoPrompt: byNo.get(s.sceneNo).videoPrompt,
    })),
  }
}

// 리서치 §3.4 (D10/N1): 구조분석은 웹검색이 불필요해 Codex도 지원 — 라우터 등록 메서드라
// llmClaude와 양쪽 필수 구현. factCheckClaims는 Codex에 만들지 않는다(M1 — 팩트체크는 Claude 강제).
export async function analyzeResearch(transcripts, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildResearchAnalyzePrompt(transcripts, opts))
  const out = await runJson(prompt, codexSchema(RESEARCH_ANALYSIS_SCHEMA), runtimeOptions(opts), { signal })
  return { structure: out.structure || [], claims: out.claims || [], commonThemes: out.commonThemes || [] }
}

export async function writePrompts(scenes, context, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildPromptsPrompt(scenes, context, opts))
  const out = await runJson(prompt, codexSchema(PROMPTS_SCHEMA), runtimeOptions(opts), { signal })
  const byNo = new Map((out.scenes || []).map((s) => [s.sceneNo, s]))
  for (const s of scenes) {
    const p = byNo.get(s.sceneNo)
    if (!p || typeof p.imagePrompt !== 'string' || !p.imagePrompt.trim()
        || typeof p.videoPrompt !== 'string' || !p.videoPrompt.trim()) {
      throw new Error(`writePrompts: scene ${s.sceneNo} missing/empty prompt`)
    }
  }
  return {
    scenes: scenes.map((s) => ({
      ...s,
      imagePrompt: byNo.get(s.sceneNo)?.imagePrompt ?? s.imagePrompt ?? null,
      videoPrompt: byNo.get(s.sceneNo)?.videoPrompt ?? s.videoPrompt ?? null,
    })),
  }
}
