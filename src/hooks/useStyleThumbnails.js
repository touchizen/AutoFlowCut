/**
 * useStyleThumbnails - 스타일 프리셋 썸네일 생성/로드/캐싱
 *
 * 메모리 최적화: thumbnails에 filePath 저장, 표시 시 file:// 프로토콜 사용
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { STYLE_PRESETS } from '../config/defaults'
import { toast } from '../components/Toast'

const THUMBNAIL_PROMPT_PREFIX = 'A serene landscape with mountains and a river'

// 1~3초 랜덤 딜레이
const randomDelay = () => new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))

// 번들된 썸네일 fallback 로드 (public/style-thumbnails/) — blob URL 사용
// Vite dev server가 missing 파일에 SPA fallback(index.html)을 반환하므로
// Content-Type 을 반드시 검증해서 실제 이미지만 허용
async function loadBundledThumbnails(existingIds = []) {
  const allStyles = STYLE_PRESETS?.styles || []
  const missingStyles = allStyles.filter(s => !existingIds.includes(s.id))
  if (missingStyles.length === 0) return {}

  const bundled = {}
  await Promise.all(
    missingStyles.map(async (style) => {
      try {
        const res = await fetch(`./style-thumbnails/${style.id}.png`)
        if (!res.ok) return
        const contentType = res.headers.get('content-type') || ''
        // 이미지가 아니면 (e.g., SPA fallback HTML) 무시
        if (!contentType.startsWith('image/')) return
        const blob = await res.blob()
        if (blob.size === 0) return
        bundled[style.id] = URL.createObjectURL(blob)
      } catch {}
    })
  )
  if (Object.keys(bundled).length > 0) {
    console.log('[StyleThumbnails] Loaded', Object.keys(bundled).length, 'bundled thumbnails')
  }
  return bundled
}

/**
 * filePath → file:// URL 변환 (표시용)
 */
export function toFileUrl(pathOrUrl) {
  if (!pathOrUrl) return null
  // 이미 URL이면 그대로 (blob:, data:, file://)
  if (pathOrUrl.startsWith('blob:') || pathOrUrl.startsWith('data:') || pathOrUrl.startsWith('file://')) {
    return pathOrUrl
  }
  // 절대 경로 → file:// (캐시 방지용 timestamp)
  if (pathOrUrl.startsWith('/')) {
    return `file://${pathOrUrl}?t=${Date.now()}`
  }
  // Windows 경로
  if (/^[A-Z]:\\/i.test(pathOrUrl)) {
    return `file:///${pathOrUrl.replace(/\\/g, '/')}?t=${Date.now()}`
  }
  return pathOrUrl
}

export function useStyleThumbnails(flowAPI) {
  const [thumbnails, setThumbnails] = useState({})         // { presetId: filePath | blobUrl }
  const [generating, setGenerating] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const stopRequestedRef = useRef(false)

  // 앱 시작 시 저장된 썸네일 로드
  useEffect(() => {
    loadThumbnails()
  }, [])

  const loadThumbnails = useCallback(async () => {
    let loaded = {}
    // 1) Electron IPC로 사용자 생성 썸네일 경로 로드 (filePath)
    if (window.electronAPI?.loadStyleThumbnails) {
      try {
        const result = await window.electronAPI.loadStyleThumbnails()
        if (result.success && result.thumbnails) {
          loaded = result.thumbnails  // { presetId: filePath }
          console.log('[StyleThumbnails] Loaded', Object.keys(loaded).length, 'user thumbnail paths')
        }
      } catch (e) {
        console.warn('[StyleThumbnails] IPC load failed:', e)
      }
    }
    // 2) 없는 것은 번들 fallback (blob URL)
    const bundled = await loadBundledThumbnails(Object.keys(loaded))
    const merged = { ...bundled, ...loaded }  // 사용자 생성분(filePath) 우선
    setThumbnails(merged)
    console.log('[StyleThumbnails] Total:', Object.keys(merged).length, 'thumbnails')
  }, [])

  // 썸네일 일괄 생성 (프리셋 + 커스텀 스타일 레퍼런스)
  const generateThumbnails = useCallback(async (presetIds, customRefs, t) => {
    if (!flowAPI?.generateImageDOM) {
      toast.error('Flow API not available')
      return
    }

    const allStyles = STYLE_PRESETS?.styles || []
    // presetIds가 없으면 썸네일이 없는 전체 프리셋 대상
    const targetIds = presetIds || allStyles
      .filter(s => !thumbnails[s.id])
      .map(s => s.id)

    const customTargets = customRefs || []
    const totalCount = targetIds.length + customTargets.length

    if (totalCount === 0) {
      toast.info(t?.('reference.thumbnailComplete') || 'All thumbnails generated')
      return
    }

    stopRequestedRef.current = false
    setStopping(false)
    setGenerating(true)
    setProgress({ current: 0, total: totalCount, startedAt: Date.now() })

    let generated = 0
    let stopped = false

    // Phase 1: 프리셋 썸네일 생성
    for (const presetId of targetIds) {
      if (stopRequestedRef.current) {
        stopped = true
        break
      }

      const preset = allStyles.find(s => s.id === presetId)
      if (!preset) continue

      const prompt = `${THUMBNAIL_PROMPT_PREFIX}, ${preset.prompt_en}`
      console.log(`[StyleThumbnails] Generating preset ${presetId}: ${prompt}`)

      try {
        const result = await flowAPI.generateImageDOM(prompt, [], { batchCount: 1 })

        if (result.success && result.images?.length > 0) {
          const firstImage = result.images[0]
          const imageData = firstImage.base64 || firstImage
          const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`

          if (window.electronAPI?.saveStyleThumbnail) {
            const saveResult = await window.electronAPI.saveStyleThumbnail({ presetId, data: dataUrl })
            if (saveResult.success && saveResult.path) {
              setThumbnails(prev => ({ ...prev, [presetId]: saveResult.path }))
            } else {
              setThumbnails(prev => ({ ...prev, [presetId]: dataUrl }))
            }
          } else {
            setThumbnails(prev => ({ ...prev, [presetId]: dataUrl }))
          }
          generated++
        } else {
          console.warn(`[StyleThumbnails] Failed to generate ${presetId}:`, result.error)
        }
      } catch (e) {
        console.error(`[StyleThumbnails] Error generating ${presetId}:`, e)
        if (e.message?.includes('401') || e.message?.includes('auth')) {
          toast.error(t?.('toast.authErrorStop') || 'Authentication error')
          stopped = true
          break
        }
      }

      setProgress(prev => ({ ...prev, current: prev.current + 1 }))
      await randomDelay()
    }

    // Phase 2: 커스텀 스타일 레퍼런스 생성
    const customResults = []
    if (!stopped) {
      for (const ref of customTargets) {
        if (stopRequestedRef.current) {
          stopped = true
          break
        }

        if (!ref.prompt) continue

        const prompt = `${THUMBNAIL_PROMPT_PREFIX}, ${ref.prompt}`
        console.log(`[StyleThumbnails] Generating custom style "${ref.name}": ${prompt}`)

        try {
          const result = await flowAPI.generateImageDOM(prompt, [], { batchCount: 1 })

          if (result.success && result.images?.length > 0) {
            const firstImage = result.images[0]
            const imageData = firstImage.base64 || firstImage
            const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`
            customResults.push({ refId: ref.id, data: dataUrl })
            generated++
          }
        } catch (e) {
          console.error(`[StyleThumbnails] Error generating custom "${ref.name}":`, e)
          if (e.message?.includes('401') || e.message?.includes('auth')) {
            toast.error(t?.('toast.authErrorStop') || 'Authentication error')
            break
          }
        }

        setProgress(prev => ({ ...prev, current: prev.current + 1 }))
        if (ref !== customTargets[customTargets.length - 1]) {
          await randomDelay()
        }
      }
    }

    if (stopped) {
      toast.info(t?.('reference.thumbnailStopped') || 'Thumbnail generation stopped')
    }

    setGenerating(false)
    setStopping(false)

    if (generated > 0) {
      toast.success(t?.('reference.thumbnailComplete', { count: generated }) || `${generated} thumbnails generated`)
    }

    return customResults  // 커스텀 스타일 결과 반환 → App에서 References 업데이트
  }, [flowAPI, thumbnails])

  const stopGenerating = useCallback(() => {
    stopRequestedRef.current = true
    setStopping(true)
  }, [])

  // 개별 썸네일 삭제
  const deleteThumbnail = useCallback(async (presetId) => {
    if (window.electronAPI?.deleteStyleThumbnail) {
      await window.electronAPI.deleteStyleThumbnail({ presetId })
    }
    setThumbnails(prev => {
      const next = { ...prev }
      delete next[presetId]
      return next
    })
    console.log('[StyleThumbnails] Deleted:', presetId)
  }, [])

  return {
    thumbnails,
    generating,
    stopping,
    progress,
    generateThumbnails,
    stopGenerating,
    deleteThumbnail,
    loadThumbnails
  }
}
