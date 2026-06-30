/**
 * Electron IPC Handler - Premiere Pro Project File Operations
 *
 * Receives a RAW Premiere XML string (media tokens already substituted with
 * absolute paths on the renderer side), gzips it, and writes it as a
 * <name>.prproj file. A .prproj is gzipped XML.
 *
 * Volume-path resolution is shared with CapCut (capcut:get-volume-path /
 * window.electronAPI.getVolumePath), so this module only registers the
 * project-write handler.
 */

import fs from 'fs/promises'
import path from 'path'
import zlib from 'zlib'
import { shell } from 'electron'

/**
 * Register Premiere-related IPC handlers on the given ipcMain instance.
 */
export function registerPremiereIPC(ipcMain) {

  // ----------------------------------------------------------
  // premiere:write-project
  //
  // Gzip the RAW Premiere XML and write it as <name>.prproj.
  // targetPath resolves to the full file path (e.g. /folder/Name.prproj).
  // ----------------------------------------------------------
  ipcMain.handle('premiere:write-project', async (_event, { targetPath, premiereXml }) => {
    try {
      if (typeof premiereXml !== 'string' || !premiereXml) {
        return { success: false, targetPath, error: 'premiereXml is empty' }
      }

      // Ensure the parent folder exists.
      await fs.mkdir(path.dirname(targetPath), { recursive: true })

      // .prproj is gzipped XML.
      const gzipped = zlib.gzipSync(Buffer.from(premiereXml, 'utf-8'))
      await fs.writeFile(targetPath, gzipped)

      return { success: true, targetPath }
    } catch (error) {
      return { success: false, targetPath, error: error.message }
    }
  })

  // ----------------------------------------------------------
  // premiere:check-installed
  //
  // Adobe Premiere Pro 설치 여부. 버전별 폴더("Adobe Premiere Pro 2024")라
  // prefix 매칭. 에러 시 차단하지 않도록 installed:true (CapCut 핸들러와 동일 정책).
  // ----------------------------------------------------------
  ipcMain.handle('premiere:check-installed', async () => {
    try {
      const platform = process.platform
      if (platform === 'darwin') {
        const apps = await fs.readdir('/Applications').catch(() => [])
        return { installed: apps.some(d => d.startsWith('Adobe Premiere Pro')) }
      } else if (platform === 'win32') {
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
        const dirs = await fs.readdir(path.join(programFiles, 'Adobe')).catch(() => [])
        return { installed: dirs.some(d => d.startsWith('Adobe Premiere Pro')) }
      }
      return { installed: true } // 미지원 플랫폼은 차단하지 않음
    } catch (error) {
      console.warn('[premiere:check-installed] Error:', error.message)
      return { installed: true }
    }
  })

  // ----------------------------------------------------------
  // premiere:open-project
  //
  // 생성된 .prproj 를 OS 기본 연결(Premiere Pro)로 연다.
  // shell.openPath 사용 — shell 미경유라 command injection 불가, mac/win 공통.
  // ----------------------------------------------------------
  ipcMain.handle('premiere:open-project', async (_event, { targetPath }) => {
    try {
      if (!targetPath) return { success: false, error: 'targetPath required' }
      // shell.openPath 는 shell 을 거치지 않고 OS 가 직접 기본 연결 앱(Premiere)으로 연다.
      // → command injection 불가, mac/win 공통. 성공 시 '' 반환, 실패 시 에러 메시지 문자열.
      const err = await shell.openPath(targetPath)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}
