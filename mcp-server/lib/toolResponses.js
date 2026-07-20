export function isFailedAppResponse(res) {
  return !res || Number(res.status) >= 400 || res.data?.success === false
}

export function getAppResponseError(res) {
  if (!res) return 'No response from AutoFlowCut app'
  if (typeof res.data === 'string') return res.data
  return res.data?.error || res.data?.message || JSON.stringify(res.data)
}

export function csvToolResponse(text, warnings = []) {
  return {
    content: [{ type: 'text', text }],
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
  const res = await fetcher(port, 'POST', '/api/export-capcut')
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
  const res = await fetcher(port, 'POST', '/api/export-premiere')
  return exportPremiereToolResponse(res)
}
