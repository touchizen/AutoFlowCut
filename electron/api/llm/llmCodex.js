/**
 * OpenAI Codex SDK Story LLM adapter — llmClaude와 같은 public signature를 제공한다.
 * 인증은 Codex CLI의 ChatGPT 로그인 세션을 사용하며, 실행 세부 옵션은 codexSdk helper가 고정한다.
 */
import {
  buildContinuePrompt,
  buildPromptsPrompt,
  buildReviewPrompt,
  buildRevisePrompt,
  buildScriptPrompt,
  buildSplitPrompt,
  buildTitlePrompt,
} from './prompts.js'
import { runCodexJson, runCodexText } from './codexSdk.js'
import { toJsonSchema } from './toJsonSchema.js'
import { PROMPTS_SCHEMA, REVIEW_SCHEMA, SCENES_SCHEMA, validateScenesSegments } from './schemas.js'

export const DEFAULT_MODEL = 'gpt-5.5'

const STORY_BACKEND_GUARD = [
  'You are being used as an AutoFlowCut Story text generation backend.',
  'Return only the requested story content or JSON. Do not include explanations unless the requested output explicitly asks for them.',
  'Do not inspect local files, run shell commands, call tools, use MCP servers, browse the web, or modify the workspace.',
].join('\n')

function guardPrompt(prompt) {
  return `${STORY_BACKEND_GUARD}\n\n${prompt}`
}

function runtimeOptions(opts = {}) {
  const out = { model: opts.model || DEFAULT_MODEL }
  if (opts.reasoningEffort) out.reasoningEffort = opts.reasoningEffort
  return out
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
  const prompt = guardPrompt(buildSplitPrompt(scriptMd, opts))
  const out = await runJson(prompt, toJsonSchema(SCENES_SCHEMA), runtimeOptions(opts), { signal })
  const scenes = out.scenes || []
  validateScenesSegments(scenes)
  return { scenes, speakers: out.speakers || [] }
}

export async function reviewScript(scriptMd, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildReviewPrompt(scriptMd, opts))
  const out = await runJson(prompt, toJsonSchema(REVIEW_SCHEMA), runtimeOptions(opts), { signal })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '' }
}

export async function reviseScript(scriptMd, critique, opts = {}, { signal, runText = runCodexText } = {}) {
  const prompt = guardPrompt(buildRevisePrompt(scriptMd, critique, opts))
  const revised = await runText(prompt, runtimeOptions(opts), { signal })
  return { scriptMd: revised }
}

export async function writePrompts(scenes, context, opts = {}, { signal, runJson = runCodexJson } = {}) {
  const prompt = guardPrompt(buildPromptsPrompt(scenes, context, opts))
  const out = await runJson(prompt, toJsonSchema(PROMPTS_SCHEMA), runtimeOptions(opts), { signal })
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
