// Render IPC — 완전 로컬 MP4 렌더. GCF 미사용. 스펙 §4.8.
// 파이프라인: validate → save dialog → resolve → adapt audio → buildRenderPlan → runFfmpegRender.
import { validateRenderRequest } from '../render/validateRequest.js'
import { resolveAndValidateInputs } from '../render/resolveInputs.js'
import { adaptAudioClips } from '../render/audioAdapter.js'
import { buildRenderPlan, outputSpec, buildSceneStartsMs } from '../render/buildRenderPlan.js'
import { runFfmpegRender } from '../render/ffmpegRunner.js'
import { unlink } from 'node:fs/promises'

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
    // before-quit 배리어가 이 잡의 정리 완료까지 기다리도록 done 프라미스를 노출.
    let markDone
    jobCtx.done = new Promise(resolve => { markDone = resolve })
    running.set(jobId, jobCtx)
    try {
      const outPath = await pickOutPath()
      if (!outPath) return { ok: false, cancelled: true }

      const cr = prepared.cloudRequest
      const resolved = await resolve(prepared, { jobId })
      if (Array.isArray(resolved.tempFiles)) jobCtx.tempFiles.push(...resolved.tempFiles) // decode된 base64 이미지 정리 위임
      const sceneStartsMs = buildSceneStartsMs(cr.scenes)  // plan 과 동일 소스(중복 제거, fallback 통일)
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
      // runner 가 돌지 못한 pre-run 실패(resolve/adapt/build throw) 시 decode 임시파일이 고아로
      // 남는다 — runner 는 성공/실패 경로에서 자기 것을 지우지만 pre-run 은 못 지운다. 여기서 정리
      // (runner 가 이미 지운 건 ENOENT 로 무시).
      for (const f of jobCtx.tempFiles) {
        try { await unlink(f) }
        catch (e) { if (e?.code !== 'ENOENT') console.warn(`[render] temp cleanup failed: ${f} (${e?.code || e?.message})`) }
      }
      running.delete(jobId)
      markDone()
    }
  })

  ipcMain.handle('render:cancel', async (_event, { jobId } = {}) => {
    const jobCtx = running.get(jobId)
    if (!jobCtx) return { ok: false, error: 'no such job' }
    jobCtx.cancelled = true
    jobCtx.abort?.()   // 실행 중 ffmpeg 프로세스 즉시 SIGKILL (runner onAbort)
    return { ok: true }
  })

  // 앱 종료 시 렌더 중이면 전부 취소하고 각 잡의 정리(SIGKILL + temp 삭제)가 끝날 때까지 기다린다
  // — abort 만 하고 나가면 Windows 에서 temp 가 잠긴 채 남는다(§4.8 before-quit 배리어).
  return async function cleanupRunningRenders() {
    const jobs = [...running.values()]
    for (const jobCtx of jobs) {
      jobCtx.cancelled = true
      jobCtx.abort?.()
    }
    // 렌더 중 잡은 SIGKILL + temp 정리가 곧 끝난다. 단 save dialog 대기 중인 잡은 abort 로
    // 안 닫혀 done 이 오지 않으므로(ffmpeg/temp 도 없어 안전), 유한 타임아웃으로 배리어를 종료한다.
    await Promise.race([
      Promise.allSettled(jobs.map(j => j.done).filter(Boolean)),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ])
  }
}
