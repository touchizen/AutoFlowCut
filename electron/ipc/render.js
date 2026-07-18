// Render IPC — 완전 로컬 MP4 렌더. GCF 미사용. 스펙 §4.8.
// 파이프라인: validate → save dialog → resolve → adapt audio → buildRenderPlan → runFfmpegRender.
import { validateRenderRequest } from '../render/validateRequest.js'
import { resolveAndValidateInputs } from '../render/resolveInputs.js'
import { adaptAudioClips } from '../render/audioAdapter.js'
import { buildRenderPlan, outputSpec } from '../render/buildRenderPlan.js'
import { runFfmpegRender } from '../render/ffmpegRunner.js'

// 씬 누적 시작(ms) — sfxItems 배치용(§4.6).
function computeSceneStartsMs(scenes) {
  const starts = {}
  let accSec = 0
  for (const s of (scenes || [])) {
    starts[s.id] = Math.round(accSec * 1000)
    accSec += Number(s.duration) || 0
  }
  return starts
}

export function registerRenderIPC(ipcMain, deps = {}) {
  const {
    getMainWindow,
    validate = validateRenderRequest,
    resolve = resolveAndValidateInputs,
    adapt = adaptAudioClips,
    build = buildRenderPlan,
    run = runFfmpegRender,
    pickOutPath,          // async () => string|null (dialog); default injected in main.js
    ffmpegPath,           // string; injected in main.js
    fontsDir,             // string; injected in main.js
  } = deps

  const running = new Map() // jobId → jobCtx

  ipcMain.handle('render:export-mp4', async (_event, request) => {
    const v = validate(request)
    if (!v.ok) return { ok: false, error: v.error }

    const { jobId, options, prepared } = request
    if (running.has(jobId)) return { ok: false, error: `job ${jobId} already running` }

    // jobId 를 먼저 예약해 dialog 대기 중에도 중복 진입을 막는다.
    const jobCtx = { cancelled: false, tempFiles: [], phase: null }
    running.set(jobId, jobCtx)
    try {
      const outPath = await pickOutPath()
      if (!outPath) return { ok: false, cancelled: true }

      const cr = prepared.cloudRequest
      const resolved = await resolve(prepared)
      const sceneStartsMs = computeSceneStartsMs(cr.scenes)
      resolved.audioClips = await adapt(cr, resolved, sceneStartsMs)

      const plan = build(resolved, { renderMode: options.renderMode, renderBurnSubtitle: options.renderBurnSubtitle, cloudRequest: cr })
      const spec = outputSpec(cr.format, options.renderMode)

      const onProgress = (p) => {
        const win = getMainWindow?.()
        win?.webContents?.send?.('render:progress', { jobId, ...p })
      }

      await run(plan, jobCtx, onProgress, {
        ffmpegPath, fontsDir, outPath,
        totalDurationMs: plan.totalDurationMs,
      })

      return { ok: true, outPath, durationSec: plan.totalDurationMs / 1000, width: spec.width, height: spec.height }
    } catch (error) {
      if (jobCtx.cancelled) return { ok: false, cancelled: true }
      return { ok: false, error: String(error?.message || error), stderrTail: error?.stderrTail }
    } finally {
      running.delete(jobId)
    }
  })

  ipcMain.handle('render:cancel', async (_event, { jobId } = {}) => {
    const jobCtx = running.get(jobId)
    if (!jobCtx) return { ok: false, error: 'no such job' }
    jobCtx.cancelled = true
    return { ok: true }
  })
}
