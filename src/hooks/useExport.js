/**
 * useExport - CapCut 프로젝트 내보내기 (Electron Desktop)
 *
 * Desktop 버전에서는 exportCapcut()가 Electron 메인 프로세스를 통해
 * 파일 시스템에 직접 기록하고 { success, targetPath }를 반환합니다.
 * 브라우저 다운로드(Blob, URL.createObjectURL) 로직이 제거되었고,
 * JSZip 후처리(SRT 리네임)도 capcut.js / capcutCloud.js 쪽으로 이관되었습니다.
 */

import { useState } from 'react'
import { fileSystemAPI } from './useFileSystem'
import { generateProjectName } from '../utils/formatters'
import { toast } from '../components/Toast'
import useI18n from './useI18n'

/**
 * Export 미디어 결정: 사용자 선택 > auto (I2V > T2V > image)
 */
function resolveExportMedia(scene) {
  const choice = scene.exportMedia || 'auto'
  if (choice === 'i2v' && (scene.videoI2V || scene.videoI2VPath))
    return { type: 'video', data: scene.videoI2V, path: scene.videoI2VPath }
  if (choice === 't2v' && (scene.videoT2V || scene.videoT2VPath))
    return { type: 'video', data: scene.videoT2V, path: scene.videoT2VPath }
  if (choice === 'image')
    return { type: 'image', data: scene.image, path: scene.imagePath }
  // auto: I2V > T2V > image
  if (scene.videoI2V || scene.videoI2VPath)
    return { type: 'video', data: scene.videoI2V, path: scene.videoI2VPath }
  if (scene.videoT2V || scene.videoT2VPath)
    return { type: 'video', data: scene.videoT2V, path: scene.videoT2VPath }
  return { type: 'image', data: scene.image, path: scene.imagePath }
}

export function useExport({
  settings,
  scenes,
  videoScenes = [],
  framePairs = [],
  openSettings,
  audioPackage = null,
  isAuthenticated,
  subscription,
  onLoginRequired,
  onPaywallRequired
}) {
  const { t } = useI18n()
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPhase, setExportPhase] = useState(null) // 'saving' | 'launching' | null

  // Handle export button click - open modal
  const handleExportClick = () => {
    const validScenes = scenes.filter(s => s.image || s.imagePath || s.videoT2V || s.videoI2V)
    if (validScenes.length === 0) {
      toast.warning(t('toast.noGeneratedImages'))
      return
    }

    // 인증 체크
    if (!isAuthenticated) {
      onLoginRequired?.()
      return
    }

    // 구독 상태 체크
    if (subscription && !subscription.canExport) {
      onPaywallRequired?.('trial_expired')
      return
    }

    setShowExportModal(true)
  }

  // Handle export confirm from modal
  const handleExportConfirm = async ({ capcutProjectNumber, scaleMode, kenBurns, kenBurnsMode, kenBurnsCycle, kenBurnsScaleMin, kenBurnsScaleMax, subtitleOption, subtitleFontSize }) => {
    const validScenes = scenes.filter(s => s.image || s.imagePath || s.videoT2V || s.videoI2V)

    // 파일 경로가 있는 씬이 있으면 권한 확인
    const hasFilePaths = validScenes.some(s => s.imagePath && !s.imagePath.startsWith('data:'))
    if (hasFilePaths) {
      const permission = await fileSystemAPI.ensurePermission()
      if (!permission.hasPermission) {
        toast.warning(t('toast.filePermissionRequired'))
        setShowExportModal(false)
        openSettings('storage')
        return
      }
    }

    setExporting(true)
    setExportPhase('saving')
    try {
      // dynamic import로 코드 스플리팅
      const { exportCapcut } = await import('../exporters/capcut.js')

      // capcut.js가 기대하는 project 구조로 변환
      // 이미지 트랙(기본) + 영상 트랙(선택) 분리 구조
      const project = {
        name: settings.projectName || generateProjectName(),
        format: settings.aspectRatio === '9:16' ? 'short' : 'landscape',
        scenes: validScenes.map(s => {
          const sceneDuration = s.duration || settings.defaultDuration || 3
          const video = resolveExportMedia(s)
          const hasVideo = video.type === 'video' && (video.path || video.data)
          const videoDuration = hasVideo ? (s.videoT2VDuration || s.videoI2VDuration || 0) : 0

          return {
            id: s.id,
            // ── 이미지 (항상 존재) ──
            media_type: 'image',
            media_path: s.imagePath || s.image,
            image_path: s.imagePath || s.image,
            image_fallback: s.image,
            image_duration: sceneDuration,
            image_size: s.image_size || null,
            // ── 영상 (선택적, 씬 뒤쪽 배치) ──
            video_path: hasVideo ? (video.path || video.data) : null,
            video_duration: videoDuration,
            // ── 자막 ──
            subtitle_ko: s.subtitle || '',
            subtitle_en: s.subtitle_en || '',
            subtitle: s.subtitle || '',
            title: s.title || ''
          }
        }),
        videos: [
          // T2V 비디오 (videoScenes)
          ...videoScenes
            .filter(vs => (vs.status === 'done' || vs.status === 'complete') && (vs.video || vs.videoPath))
            .map(vs => ({
              id: vs.id,
              video_path: vs.videoPath || vs.video,
              prompt: vs.prompt || '',
              source: 't2v',
            })),
          // F→V 비디오 (framePairs)
          ...framePairs
            .filter(p => p.status === 'complete' && (p.base64 || p.videoPath))
            .map(p => ({
              id: p.id,
              video_path: p.videoPath || p.base64,
              from_scene: p.startSceneId || null,
              to_scene: p.endSceneId || null,
              prompt: p.prompt || '',
              source: 'i2v',
            })),
        ]
      }

      console.log('[Export] settings.aspectRatio:', settings.aspectRatio, '→ format:', project.format)
      console.log('[Export] First scene data:', {
        id: project.scenes[0]?.id,
        hasImagePath: !!project.scenes[0]?.image_path,
        hasImageFallback: !!project.scenes[0]?.image_fallback,
        imageSize: project.scenes[0]?.image_size,
        imageFallbackLength: project.scenes[0]?.image_fallback?.length || 0
      })

      // Desktop: exportCapcut은 파일 시스템에 직접 기록하고 { success, targetPath }를 반환
      const result = await exportCapcut(project, {
        scaleMode,
        capcutProjectNumber,
        kenBurns,
        kenBurnsMode,
        kenBurnsCycle,
        kenBurnsScaleMin,
        kenBurnsScaleMax,
        subtitleOption,
        subtitleFontSize,
        audioPackage
      })

      if (!result.success) {
        throw new Error(result.error || 'Export failed')
      }

      // Phase 2: CapCut 실행
      setExportPhase('launching')
      toast.success(t('toast.exportSaveComplete'), 5000)

      // CapCut 열기
      if (window.electronAPI?.openCapcut) {
        try {
          await window.electronAPI.openCapcut()
          console.log('[Export] CapCut app opened')
          toast.info(t('toast.exportCapcutLaunched'), 5000)
        } catch (openError) {
          console.warn('[Export] Failed to open CapCut:', openError)
          toast.warning(t('toast.exportCapcutFailed'), 6000)
        }
      }

      // 1.5초 대기 후 모달 닫기 (사용자에게 상태 전환을 보여줌)
      await new Promise(r => setTimeout(r, 1500))
      setShowExportModal(false)

      // V2 GCF(generateCapcutJson_*)가 quota 검증 + exportCount 증가를 원자적으로 처리하므로
      // 별도 incrementExportCount 호출 불필요
    } catch (error) {
      toast.error(t('toast.exportFailed', { error: error.message }))
    } finally {
      setExporting(false)
      setExportPhase(null)
    }
  }

  return {
    showExportModal,
    setShowExportModal,
    exporting,
    exportPhase,
    handleExportClick,
    handleExportConfirm
  }
}
