// Flow WebContentsView 전용 preload — 원격 Flow 페이지에 최소 표면만 노출(보안).
// M4에서 fetch 캡처 응답 forward(flowReportResponse)에 사용. 지금은 표면만 확보.
import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('electronAPI', {
  flowReportResponse: (payload) => ipcRenderer.invoke('flow:report-response', payload),
  // 진단 트레이스(AUTOFLOWCUT_NET_TRACE=1) — XHR/fetch 요청·응답을 main 이 JSONL 로 남긴다. 꺼져 있으면 main 이 거절.
  flowReportXhr: (payload) => ipcRenderer.invoke('flow:report-xhr', payload),
})
