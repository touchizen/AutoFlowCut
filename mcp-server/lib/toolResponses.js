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
