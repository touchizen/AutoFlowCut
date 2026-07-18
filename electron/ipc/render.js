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
    // AbortController 로 취소 시 실행 중 ffmpeg 프로세스를 즉시 kill (runner 가 signal 을 감시).
    const controller = new AbortController()
    const jobCtx = { jobId, cancelled: false, tempFiles: [], phase: null, signal: controller.signal }
    jobCtx.abort = () => controller.abort()
    running.set(jobId, jobCtx)
    try {
      const outPath = await pickOutPath()
      if (!outPath) return { ok: false, cancelled: true }

      const cr = prepared.cloudRequest
      const resolved = await resolve(prepared)
      if (Array.isArray(resolved.tempFiles)) jobCtx.tempFiles.push(...resolved.tempFiles) // decode된 base64 이미지 정리 위임
      const sceneStartsMs = computeSceneStartsMs(cr.scenes)
      resolved.audioClips = await adapt(cr, resolved, sceneStartsMs)

      const plan = build(resolved, { renderMode: options.renderMode, renderBurnSubtitle: options.renderBurnSubtitle, cloudRequest: cr })
      const spec = outputSpec(cr.format, options.renderMode)

      const onProgress = (p) => {
        const win = getMainWindow?.()
        // jobId 를 스프레드 뒤에 둬 runner 가 실은 jobCtx.jobId(=이 jobId)로 덮어써도 안전.
        win?.webContents?.send?.('render:progress', { ...p, jobId })
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
    jobCtx.abort?.()   // 실행 중 ffmpeg 프로세스 즉시 SIGKILL (runner onAbort)
    return { ok: true }
  })

  // 앱 종료 시 렌더 중이면 전부 취소해 orphan ffmpeg/temp 를 남기지 않는다(§4.8 before-quit).
  return function cleanupRunningRenders() {
    for (const jobCtx of running.values()) {
      jobCtx.cancelled = true
      jobCtx.abort?.()
    }
  }
}
