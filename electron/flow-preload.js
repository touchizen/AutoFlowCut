// Flow WebContentsView 전용 preload — Flow 페이지(원격 Google 도메인)에 attach.
// 보안: 페이지 또는 XSS가 우리 IPC 를 호출할 수 없도록 최소 표면만 노출.
// 노출 대상: flowReportResponse — window.fetch monkey-patch 가 응답 body 를 main 으로 forward 할 때 사용.
// main 의 ipcMain.handle('flow:report-response') 는 sender 검증으로 출처가 flowView 임을 확인한다.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  flowReportResponse: (payload) => ipcRenderer.invoke('flow:report-response', payload),
})
