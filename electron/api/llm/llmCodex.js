/**
 * OpenAI Codex SDK Story LLM adapter — llmClaude와 같은 public signature를 제공한다.
 * 인증은 Codex CLI의 ChatGPT 로그인 세션을 사용하며, 실행 세부 옵션은 codexSdk helper가 고정한다.
 */
import {
  buildContinuePrompt,
  buildPromptsPrompt,
  buildReviewPrompt,
  buildRevisePrompt,
  buildScenesReviewPrompt,
  buildScenesRevisePrompt,
  buildPromptsReviewPrompt,
  buildPromptsRevisePrompt,
  buildScriptPrompt,
  buildSplitPrompt,
  buildTitlePrompt,
} from './prompts.js'
import { runCodexJson, runCodexText } from './codexSdk.js'
import { toOpenAiJsonSchema } from './toJsonSchema.js'
import { PROMPTS_SCHEMA, REVIEW_SCHEMA, SCENES_SCHEMA, validateScenesSegments } from './schemas.js'
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
  const out = await runJson(prompt, codexSchema(REVIEW_SCHEMA), runtimeOptions(opts), { signal })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '' }
}

export async function reviseScript(scriptMd, critique, opts = {}, { signal, runText = runCodexText } = {}) {
  const prompt = guardPrompt(buildRevisePrompt(scriptMd, critique, opts))
  const revised = await runText(prompt, runtimeOptions(opts), { signal })
  return { scriptMd: revised }
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
