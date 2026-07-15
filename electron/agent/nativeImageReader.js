import { nativeImage } from 'electron'
import { promises as fs } from 'node:fs'

/**
 * D11 이미지 decode seam 의 production 구현 — main-only(Electron `nativeImage`).
 * Tool Core 는 이 객체를 `imageReader` 로 주입받아 get_scene_images 를 구현한다.
 *
 * Electron 36 `nativeImage.createFromPath` 는 PNG/JPEG 만 decode 하고, 유효한 WebP/GIF 는
 * 결정적으로 empty 다 — 그래서 `isEmpty` 로 unsupported-image-format 을 분리한다 (D11).
 * 출력은 JPEG(품질 85) — 토큰 경제상 원본 PNG 대신 다시 인코딩한다.
 */
export function createNativeImageReader() {
  return {
    async exists(filePath) {
      try {
        await fs.access(filePath)
        return true
      } catch {
        return false
      }
    },
    async decodeFile(filePath) {
      const img = nativeImage.createFromPath(filePath)
      const isEmpty = img.isEmpty()
      const { width, height } = isEmpty ? { width: 0, height: 0 } : img.getSize()
      return {
        isEmpty,
        width,
        height,
        toBlock({ resize }) {
          const out = resize ? img.resize(resize) : img
          return { data: out.toJPEG(85).toString('base64'), mimeType: 'image/jpeg' }
        },
      }
    },
  }
}
