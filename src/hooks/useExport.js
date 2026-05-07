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
import { toast } from '../components/Toast'
import useI18n from './useI18n'
import { resolveExportMediaChoice, hasExportableMedia, getExportFilePaths } from '../utils/sceneMedia'

/**
 * Export 미디어를 실제 data/path 와 함께 반환.
 * choice 결정은 SceneList 와 공용 utility 에 위임하여 시각/실제 export 의
 * 일관성을 보장한다.
 */
function resolveExportMedia(scene) {
  const choice = resolveExportMediaChoice(scene)
  if (choice === 'i2v')
    return { type: 'video', data: scene.videoI2V, path: scene.videoI2VPath }
  if (choice === 't2v')
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
  refreshSubscription,
  onLoginRequired,
  onPaywallRequired
}) {
  const { t } = useI18n()
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPhase, setExportPhase] = useState(null) // 'saving' | 'launching' | null

  // Handle export button click - open modal
  const handleExportClick = () => {
    const validScenes = scenes.filter(hasExportableMedia)
    if (validScenes.length === 0) {
      toast.warning(t('toast.noGeneratedImages'))
      return
    }

    // 인증 체크
    if (!isAuthenticated) {
      onLoginRequired?.()
      return
    }

    // 구독 상태 로딩 중이면 — onAuthChange→fetchUserData 사이의 짧은 윈도우 — 무음 차단.
    // 이전 사용자의 canExport: true 가 새 사용자에게 새는 것을 막기 위해 AuthContext 가
    // 전환 직후 status='loading' 으로 잠궈둔 상태이며, 곧 갱신되므로 paywall 을 띄우면 오해를 부른다.
    if (subscription?.status === 'loading') {
      return
    }

    // 구독 정보 조회 실패(terminal) — 사용자에게 알리고 재시도 트리거.
    // paywall 을 띄우면 "체험 만료" 처럼 오해를 부르므로 별도 처리.
    //
    // refreshSubscription 은 fetchUserData 의 throw 를 그대로 전파하므로
    // 재시도 또한 실패할 수 있다. fire-and-forget 시 unhandled promise rejection 발생 가능 → 항상 catch.
    // (refreshSubscription?.().catch() 는 호출 결과 undefined 에 .catch 를 시도해 TypeError — guard 필요)
    if (subscription?.status === 'error') {
      toast.error(t('toast.subscriptionLoadFailed'))
      if (refreshSubscription) {
        Promise.resolve(refreshSubscription()).catch(refreshError => {
          console.warn('[Export] Retry refreshSubscription failed:', refreshError)
        })
      }
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
    const validScenes = scenes.filter(hasExportableMedia)

    // 디스크 read 권한이 필요한 파일 경로가 하나라도 있으면 사전에 권한 확인.
    // image / video(T2V/I2V) path 모두 포함 — 영상만 path-backed 인 케이스에서
    // 권한 누락이 exporter 내부 에러로 빠지는 것을 방지.
    const hasFilePaths = validScenes.some(s => getExportFilePaths(s).length > 0)
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
      if (!settings.projectName) {
        console.warn('[useExport] settings.projectName missing — falling back to "Untitled"')
      }
      const project = {
        name: settings.projectName || 'Untitled',
        format: settings.aspectRatio === '9:16' ? 'short' : 'landscape',
        scenes: validScenes.map(s => {
          const sceneDuration = s.duration || settings.defaultDuration || 3
          const video = resolveExportMedia(s)
          const hasVideo = video.type === 'video' && (video.path || video.data)
          // Fallback chain: explicit video duration → scene duration (typical 3s default).
          // Protects against onLoadedMetadata race — user clicks Export before SceneList mounts
          // the <video> element that would normally populate video{T2V,I2V}Duration.
          const videoDuration = hasVideo ? (s.videoT2VDuration || s.videoI2VDuration || sceneDuration || 0) : 0

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

      // V2 GCF(generateCapcutJson_*)가 quota 검증 + exportCount 증가를 원자적으로 처리하지만,
      // 클라이언트 subscription 캐시는 별개이므로 명시적으로 재조회해야 다음 export 가드가 정확해진다.
      // (refreshSubscription 미주입 시 — 테스트 등 — 무시)
      if (refreshSubscription) {
        try {
          await refreshSubscription()
        } catch (refreshError) {
          console.warn('[Export] Failed to refresh subscription after export:', refreshError)
        }
      }
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
