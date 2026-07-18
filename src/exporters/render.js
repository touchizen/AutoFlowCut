// Self-render exporter — 완전 로컬 MP4. prepareCloudRequest payload 재사용, GCF(callExportFunction) 미호출.
import { prepareCloudRequest } from './prepareCloudRequest.js'

let jobCounter = 0
export function makeRenderJobId(project) {
  const base = String(project?.name || 'project').replace(/\W+/g, '_')
  jobCounter += 1
  return `render_${base}_${jobCounter}`
}
const defaultJobId = makeRenderJobId

export async function exportRenderVideo(project, options, deps = {}) {
  const prepare = deps.prepareCloudRequest || prepareCloudRequest
  const renderMp4 = deps.renderMp4 || ((payload) => window.electronAPI.renderMp4(payload))
  const makeJobId = deps.makeJobId || (() => defaultJobId(project))

  const prepared = await prepare(project, options)

  // v1 미지원: 생성 비디오 오버레이가 있으면 정지 이미지로 대체됨 — 명시적 동의 필수(스펙 §4.9).
  const overlays = prepared?.cloudRequest?.videoOverlays
  if (Array.isArray(overlays) && overlays.length > 0) {
    const confirmed = deps.confirmOverlays ? await deps.confirmOverlays(overlays.length) : true
    if (!confirmed) return { ok: false, cancelled: true }
  }

  // IPC 등록(renderMp4) 전에 취소가 눌렸으면 여기서 멈춘다 — 안 그러면 등록 전 취소가 no-op 이 되고
  // 렌더가 그대로 시작된다(prepareCloudRequest/story audio 로딩 중 취소 창).
  if (deps.shouldCancel?.()) return { ok: false, cancelled: true }

  const jobId = makeJobId()

  return renderMp4({
    prepared,
    options: {
      renderMode: options.renderMode,
      renderBurnSubtitle: options.renderBurnSubtitle,
    },
    jobId,
  })
}
