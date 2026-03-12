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
import { incrementExportCount } from '../firebase/functions'
import useI18n from './useI18n'

export function useExport({
  settings,
  scenes,
  videoScenes = [],
  framePairs = [],
  refPairs = [],
  openSettings,
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
    const validScenes = scenes.filter(s => s.image || s.imagePath)
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
  const handleExportConfirm = async ({ capcutProjectNumber, scaleMode, kenBurns, kenBurnsMode, kenBurnsCycle, kenBurnsScaleMin, kenBurnsScaleMax, subtitleOption }) => {
    const validScenes = scenes.filter(s => s.image || s.imagePath)

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
      const project = {
        name: settings.projectName || generateProjectName(),
        format: settings.aspectRatio === '9:16' ? 'short' : 'landscape',
        scenes: validScenes.map(s => ({
          id: s.id,
          image_path: s.imagePath || s.image, // 파일 경로 또는 base64
          image_fallback: s.image, // 파일 읽기 실패 시 fallback용 base64
          image_duration: s.duration || settings.defaultDuration || 3,
          image_size: s.image_size || null,
          subtitle_ko: s.subtitle || '',  // 한국어 자막
          subtitle_en: s.subtitle_en || '',  // 영어 자막
          subtitle: s.subtitle || '',
          title: s.title || ''
        })),
        videos: [
          // T2V 비디오 (videoScenes)
          ...videoScenes
            .filter(vs => (vs.status === 'done' || vs.status === 'complete') && vs.video)
            .map(vs => ({
              id: vs.id,
              video_path: vs.video,
              prompt: vs.prompt || '',
              source: 't2v',
            })),
          // F→V 비디오 (framePairs)
          ...framePairs
            .filter(p => p.status === 'complete' && p.base64)
            .map(p => ({
              id: p.id,
              video_path: p.base64,
              from_scene: p.startSceneId || null,
              to_scene: p.endSceneId || null,
              prompt: p.prompt || '',
              source: 'i2v',
            })),
          // R→V 비디오 (refPairs)
          ...refPairs
            .filter(p => p.status === 'complete' && p.base64)
            .map(p => ({
              id: p.id,
              video_path: p.base64,
              prompt: p.prompt || '',
              source: 'r2v',
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
        subtitleOption
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

      // 내보내기 카운트 증가 (fire and forget)
      incrementExportCount().catch(countError => {
        console.warn('[Export] Failed to increment export count:', countError)
      })
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
