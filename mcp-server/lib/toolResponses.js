export function isFailedAppResponse(res) {
  return !res || Number(res.status) >= 400 || res.data?.success === false
}

export function getAppResponseError(res) {
  if (!res) return 'No response from AutoFlowCut app'
  if (typeof res.data === 'string') return res.data
  return res.data?.error || res.data?.message || JSON.stringify(res.data)
}

export function csvToolResponse(text, warnings = []) {
  const visibleText = warnings.length > 0
    ? `${text}\n\nWarnings:\n${warnings.map(warning => `- ${warning}`).join('\n')}`
    : text
  return {
    content: [{ type: 'text', text: visibleText }],
    ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
  }
}

export function exportCapcutToolResponse(res) {
  if (isFailedAppResponse(res)) {
    return {
      content: [{ type: 'text', text: `CapCut 내보내기 실패 (${res?.status ?? 'unknown'}): ${getAppResponseError(res)}` }],
      isError: true,
    }
  }

  return {
    content: [{ type: 'text', text: `CapCut 내보내기 완료: ${JSON.stringify(res.data)}` }],
  }
}

export async function handleExportCapcutTool(args = {}, fetcher) {
  const port = args.port || 3210
  const body = { includePending: args.includePending === true }
  // 영상 클립 오디오 볼륨(CapCut 전용) — 허용 값만 싣는다. 없으면 앱에 저장된 내보내기 설정을 따른다.
  //   허용 값은 앱의 src/exporters/videoAudioVolume.js VIDEO_AUDIO_VOLUMES 와 같다(앱도 다시 거른다).
  if ([0, 0.15, 1].includes(args.videoAudioVolume)) body.videoAudioVolume = args.videoAudioVolume
  const res = await fetcher(port, 'POST', '/api/export-capcut', body)
  return exportCapcutToolResponse(res)
}

export function exportPremiereToolResponse(res) {
  if (isFailedAppResponse(res)) {
    return {
      content: [{ type: 'text', text: `Premiere 내보내기 실패 (${res?.status ?? 'unknown'}): ${getAppResponseError(res)}` }],
      isError: true,
    }
  }

  return {
    content: [{ type: 'text', text: `Premiere 내보내기 완료: ${JSON.stringify(res.data)}` }],
  }
}

export async function handleExportPremiereTool(args = {}, fetcher) {
  const port = args.port || 3210
  const res = await fetcher(port, 'POST', '/api/export-premiere', { includePending: args.includePending === true })
  return exportPremiereToolResponse(res)
}

export function updateSceneToolResponse(res, args = {}) {
  if (isFailedAppResponse(res)) {
    return {
      content: [{ type: 'text', text: `씬 [${args.index}] 수정 실패 (${res?.status ?? 'unknown'}): ${getAppResponseError(res)}` }],
      isError: true,
    }
  }

  return {
    content: [{ type: 'text', text: `씬 [${args.index}] 수정 완료: ${JSON.stringify(args.fields)}` }],
  }
}

export async function handleUpdateSceneTool(args = {}, fetcher) {
  const port = args.port || 3210
  const res = await fetcher(port, 'POST', '/api/update', {
    type: 'update-scene',
    index: args.index,
    fields: args.fields,
  })
  return updateSceneToolResponse(res, args)
}

/**
 * 2026-10-30 I2V — app_set_frame_pairs: 씬 index(0부터)를 시작 프레임으로 하는 I2V 행을 세우고 나머지 행은 선택을 푼다(POST /api/update set-frame-pairs).
 *   실패(409 busy · 422 no-image/bad-index · 400 모양)는 isError 로.
 */
export async function handleSetFramePairsTool(args = {}, fetcher) {
  const port = args.port || 3210
  const body = { type: 'set-frame-pairs', indexes: args.indexes }
  if (args.promptSource !== undefined) body.promptSource = args.promptSource
  const res = await fetcher(port, 'POST', '/api/update', body)
  if (isFailedAppResponse(res)) {
    const at = (Array.isArray(res?.data?.indexes) ? ` indexes=${JSON.stringify(res.data.indexes)}` : '')
      + (Array.isArray(res?.data?.pairIds) ? ` pairIds=${JSON.stringify(res.data.pairIds)}` : '')   // 주인 씬 없는 갤러리 행(Codex 5차 P3)
    return { content: [{ type: 'text', text: `I2V 행 지정 실패 (${res?.status ?? 'unknown'}): ${getAppResponseError(res)}${at}` }], isError: true }
  }
  return { content: [{ type: 'text', text: `I2V 행 지정 완료: ${JSON.stringify(res.data?.rows ?? [])} — 이제 app_start_scene_batch {mode:'i2v'}` }] }
}

/** app_start_scene_batch — styleId?·force?·mode?(image|video|i2v). 아무것도 없으면 본문 null(옛 호출 호환). 400(모르는 mode 등)은 isError. */
export async function handleStartSceneBatchTool(args = {}, fetcher) {
  const port = args.port || 3210
  const body = {}
  if (args.styleId !== undefined) body.styleId = args.styleId
  if (args.force !== undefined) body.force = !!args.force
  if (args.mode !== undefined) body.mode = args.mode
  const res = await fetcher(port, 'POST', '/api/start-scene-batch', Object.keys(body).length ? body : null)
  if (isFailedAppResponse(res)) {
    return { content: [{ type: 'text', text: `씬 일괄 생성 시작 실패 (${res?.status ?? 'unknown'}): ${getAppResponseError(res)}` }], isError: true }
  }
  return { content: [{ type: 'text', text: `씬 일괄 생성 시작: ${JSON.stringify(res.data)}` }] }
}
