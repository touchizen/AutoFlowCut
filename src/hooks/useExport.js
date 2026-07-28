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
import { resolveExportVideos, hasExportableMedia, getExportFilePaths } from '../utils/sceneMedia'
import { resolveDisplayError } from '../utils/errorDisplay'
import { pruneSrtTrackToScenes, rebaseSrtTrackToScenes } from '../utils/srtTrack'
import { isSceneGenerationDone } from '../services/generationStatus'
import { normalizeExportFormat, EXPORT_FORMATS } from '../utils/exportFormat'
import { computeSceneSlots } from '../services/sceneSlots'

function isExportableScene(scene) {
  return isSceneGenerationDone(scene) && hasExportableMedia(scene)
}

export function useExport({
  settings,
  scenes,
  srtTrack = [],
  videoScenes = [],
  framePairs = [],
  openSettings,
  audioPackage = null,
  storyProjectPath = null,  // M2a-4: story 프로젝트면 export 직전 manifest+lastPushedRevision 로드해 나레이션 배치.
  isAuthenticated,
  subscription,
  refreshSubscription,
  onLoginRequired,
  onPaywallRequired,
  onExportSuccess
}) {
  const { t } = useI18n()
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPhase, setExportPhase] = useState(null) // 'saving' | 'launching' | null
  // 마지막 선택 포맷 — split 진입 버튼 본체 동작/문구 + 모달 초기 탭에 사용. localStorage 영속.
  const [exportFormat, setExportFormat] = useState(() => {
    try { return normalizeExportFormat(localStorage.getItem('lastExportFormat')) } catch { return 'capcut' }
  })

  // Handle export button click - open modal.
  // split 드롭다운/본체에서 유효 포맷을 넘기면 기억(없거나 깨진 값이면 기존 유지).
  const handleExportClick = (format) => {
    if (EXPORT_FORMATS.includes(format)) {
      setExportFormat(format)
      try { localStorage.setItem('lastExportFormat', format) } catch {}
    }
    const validScenes = scenes.filter(isExportableScene)
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

  // M2a-4 IP-A2: story 프로젝트면 export 직전에 최신 manifest+lastPushedRevision 을 로드한다.
  // (App state 에 미리 담으면 stale — export 시점 디스크가 source of truth.) 정합 판단은
  // prepareCloudRequest 가 하고, manifest 없으면(audio 미실행) null → 오디오 없이 export.
  // CapCut/Premiere 전용 — Vrew 는 오디오 미배치라 호출하지 않는다(IP-A3).
  //   - storyProjectPath 를 넘겨 교차 프로젝트 주입을 막는다(Codex finding 1, main 에서 대조).
  //   - 손상 manifest 는 IPC 가 reject → 삼키지 않고 상위 export 핸들러로 전파해 export 를
  //     차단한다(Codex finding 3, fail-fast). IPC 자체가 없으면(테스트 등) optional chain → null.
  const loadStoryAudio = async () => {
    if (!storyProjectPath) return null
    const pkg = (await window.electronAPI?.storyLoadAudioPackage?.(storyProjectPath)) ?? null
    // main 은 stale/손상 manifest 를 { error: kind } 로 알린다(throw 는 IPC 를 건너며 errorKind 가
    // 소실된다). 그대로 흘려보내면 이 객체가 storyAudio 로 들어가 manifest 없는 채 export 가
    // 진행된다 — 막고, kind 를 실어 던져 catch 가 로케일 문구로 바꾸게 한다.
    if (pkg?.error) throw Object.assign(new Error(pkg.error), { errorKind: pkg.error })
    return pkg
  }

  // CapCut / Premiere 공통 — exporter 가 기대하는 project 구조 빌드.
  // 이미지 트랙(기본) + 영상 트랙(선택) 분리 구조. handleExportConfirm /
  // handleExportPremiere 가 동일한 cloudRequest 를 만들도록 한 곳에 모음.
  const buildExportProject = (validScenes) => {
    if (!settings.projectName) {
      console.warn('[useExport] settings.projectName missing — falling back to "Untitled"')
    }
    // 씬 사이 무음 간격을 앞 씬에 흡수한다 — 슬롯을 누적하면 cum(i) === start_i 가
    // 되어 이미지가 내레이션보다 앞서지 않는다. 시각이 성립하지 않는 프로젝트는
    // 전체 폴백(all-or-nothing)해서 현행과 바이트 동일하게 동작한다.
    const slots = computeSceneSlots(validScenes, settings)
    if (!slots.useSlots && validScenes.length > 0) {
      console.warn(`[useExport] scene slots unavailable (${slots.reason}) — falling back to legacy durations`)
    }
    return {
      name: settings.projectName || 'Untitled',
      // 'portrait' / 'landscape' — GCF가 기대하는 값.
      format: settings.aspectRatio === '9:16' ? 'portrait' : 'landscape',
      // Phase 5 + R1 + R8 review fix: srtTrack 을 validScenes 순서로 rebase.
      // 슬롯일 때만 누적 길이(srtSlots)와 시드(start_0)를 넘긴다 — 폴백 프로젝트에
      // 넘기면 사이드카 시작 시각이 현행과 달라진다.
      srtTrack: rebaseSrtTrackToScenes(
        pruneSrtTrackToScenes(srtTrack, validScenes, { preserveUnlinked: true }),
        validScenes,
        {
          preserveUnlinked: true,
          ...(slots.useSlots ? {
            durationOf: (_scene, i) => slots.srtSlots[i],
            initialCumulative: Number(validScenes[0].startTime) || 0,
          } : {}),
        }
      ),
      // P1 review fix: prune/rebase 전 원본 srtTrack 도 보존.
      rawSrtTrack: srtTrack,
      scenes: validScenes.map((s, i) => {
        // 슬롯 = 다음 씬 시작까지(간격 흡수). 폴백이면 기존 레거시 값 그대로.
        const sceneDuration = slots.imageSlots[i]
        // 씬 자기 길이 — 영상 오버레이는 슬롯이 아니라 이걸 기준으로 배치된다.
        const sourceDuration = slots.useSlots ? slots.sourceDurations[i] : null
        const videos = resolveExportVideos(s).map(v => ({
          source: v.source,
          path: v.path || v.data,
          // 자체 길이 없는 영상은 발화 구간 → 슬롯 순으로 폴백한다. 0 으로 두면
          // prepareCloudRequest 의 `videoDuration <= 0 continue` 에서 증발한다.
          duration: v.duration || sourceDuration || sceneDuration || 0,
        }))

        return {
          id: s.id,
          // ── 이미지 (항상 존재) ──
          media_type: 'image',
          media_path: s.imagePath || s.image,
          image_path: s.imagePath || s.image,
          image_fallback: s.image,
          image_duration: sceneDuration,
          image_size: s.image_size || null,
          // ── 영상 오버레이 배치 기준 (슬롯일 때만) ──
          ...(slots.useSlots ? {
            source_duration: sourceDuration,
            source_offset: slots.sourceOffsets[i],
          } : {}),
          // ── 영상 (0~2개, 하이브리드: i2v 앞 / t2v 뒤) ──
          videos,
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
            scene_id: p.ownerSceneId || null,
            from_scene: p.startSceneId || null,
            to_scene: p.endSceneId || null,
            prompt: p.prompt || '',
            source: 'i2v',
          })),
      ]
    }
  }

  // Handle export confirm from modal
  const handleExportConfirm = async ({ capcutProjectNumber, scaleMode, kenBurns, kenBurnsMode, kenBurnsCycle, kenBurnsScaleMin, kenBurnsScaleMax, subtitleOption, subtitleFontSize }) => {
    const validScenes = scenes.filter(isExportableScene)
    if (validScenes.length === 0) {
      toast.warning(t('toast.noGeneratedImages'))
      setShowExportModal(false)
      return { success: false, error: t('toast.noGeneratedImages') }
    }

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
        return { success: false, error: t('toast.filePermissionRequired') }
      }
    }

    setExporting(true)
    setExportPhase('saving')
    try {
      // dynamic import로 코드 스플리팅
      const { exportCapcut } = await import('../exporters/capcut.js')

      // capcut.js가 기대하는 project 구조로 변환 (CapCut/Premiere 공통 빌더)
      const project = buildExportProject(validScenes)

      console.log('[Export] settings.aspectRatio:', settings.aspectRatio, '→ format:', project.format)
      console.log('[Export] First scene data:', {
        id: project.scenes[0]?.id,
        hasImagePath: !!project.scenes[0]?.image_path,
        hasImageFallback: !!project.scenes[0]?.image_fallback,
        imageSize: project.scenes[0]?.image_size,
        imageFallbackLength: project.scenes[0]?.image_fallback?.length || 0
      })

      const storyAudio = await loadStoryAudio()

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
        audioPackage,
        storyAudio
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

      // 내보내기 성공 — Store 평점 유도 카운터 증가 (모달 트리거는 호출측에서 판단)
      onExportSuccess?.()
      return { success: true, targetPath: result.targetPath }
    } catch (error) {
      toast.error(t('toast.exportFailed', { error: resolveDisplayError(t, error.errorKind, error.message) }))
      return { success: false, error: error.message }
    } finally {
      setExporting(false)
      setExportPhase(null)
    }
  }

  // Handle Premiere export (mirror of handleExportConfirm).
  // capcutProjectNumber 는 .prproj 를 쓸 출력 폴더 경로로 재사용된다.
  // Premiere 자막은 XML 에 embed 되므로 SRT sidecar / 앱 실행 단계는 없다.
  const handleExportPremiere = async ({ capcutProjectNumber, scaleMode, kenBurns, kenBurnsMode, kenBurnsCycle, kenBurnsScaleMin, kenBurnsScaleMax, subtitleOption, subtitleFontSize }) => {
    const validScenes = scenes.filter(isExportableScene)
    if (validScenes.length === 0) {
      toast.warning(t('toast.noGeneratedImages'))
      setShowExportModal(false)
      return { success: false, error: t('toast.noGeneratedImages') }
    }

    // 디스크 read 권한이 필요한 파일 경로가 하나라도 있으면 사전에 권한 확인.
    const hasFilePaths = validScenes.some(s => getExportFilePaths(s).length > 0)
    if (hasFilePaths) {
      const permission = await fileSystemAPI.ensurePermission()
      if (!permission.hasPermission) {
        toast.warning(t('toast.filePermissionRequired'))
        setShowExportModal(false)
        openSettings('storage')
        return { success: false, error: t('toast.filePermissionRequired') }
      }
    }

    setExporting(true)
    setExportPhase('saving')
    try {
      const { exportPremiere } = await import('../exporters/premiere.js')
      const project = buildExportProject(validScenes)

      console.log('[Export] Premiere — aspectRatio:', settings.aspectRatio, '→ format:', project.format)

      const storyAudio = await loadStoryAudio()

      // Desktop: exportPremiere 는 .prproj 를 디스크에 직접 쓰고 { success, targetPath } 반환
      const result = await exportPremiere(project, {
        scaleMode,
        capcutProjectNumber,
        kenBurns,
        kenBurnsMode,
        kenBurnsCycle,
        kenBurnsScaleMin,
        kenBurnsScaleMax,
        subtitleOption,
        subtitleFontSize,
        audioPackage,
        storyAudio
      })

      if (!result.success) {
        throw new Error(result.error || 'Export failed')
      }

      toast.success(t('toast.premiereSaveComplete'), 5000)

      // Premiere Pro 로 .prproj 열기 (CapCut 의 앱 실행 단계 미러).
      setExportPhase('launching')
      if (window.electronAPI?.openPremiereProject) {
        try {
          const open = await window.electronAPI.openPremiereProject({ targetPath: result.targetPath })
          if (open?.success) {
            toast.info(t('toast.premiereLaunched'), 5000)
          } else {
            toast.warning(t('toast.premiereLaunchFailed'), 6000)
          }
        } catch (openError) {
          console.warn('[Export] Failed to open Premiere:', openError)
          toast.warning(t('toast.premiereLaunchFailed'), 6000)
        }
      }

      await new Promise(r => setTimeout(r, 1500))
      setShowExportModal(false)

      // export quota 재조회 (CapCut 과 동일 — GCF 가 exportCount 증가 처리).
      if (refreshSubscription) {
        try {
          await refreshSubscription()
        } catch (refreshError) {
          console.warn('[Export] Failed to refresh subscription after export:', refreshError)
        }
      }

      onExportSuccess?.()
      return { success: true, targetPath: result.targetPath }
    } catch (error) {
      toast.error(t('toast.exportFailed', { error: resolveDisplayError(t, error.errorKind, error.message) }))
      return { success: false, error: error.message }
    } finally {
      setExporting(false)
      setExportPhase(null)
    }
  }

  // Handle Vrew export (local generator + local zip packaging).
  // capcutProjectNumber 는 .vrew 를 쓸 출력 폴더 경로로 재사용된다.
  const handleExportVrew = async ({ capcutProjectNumber, scaleMode, kenBurns, kenBurnsMode, kenBurnsCycle, kenBurnsScaleMin, kenBurnsScaleMax, subtitleOption, subtitleFontSize }) => {
    const validScenes = scenes.filter(isExportableScene)
    if (validScenes.length === 0) {
      toast.warning(t('toast.noGeneratedImages'))
      setShowExportModal(false)
      return { success: false, error: t('toast.noGeneratedImages') }
    }

    const hasFilePaths = validScenes.some(s => getExportFilePaths(s).length > 0)
    if (hasFilePaths) {
      const permission = await fileSystemAPI.ensurePermission()
      if (!permission.hasPermission) {
        toast.warning(t('toast.filePermissionRequired'))
        setShowExportModal(false)
        openSettings('storage')
        return { success: false, error: t('toast.filePermissionRequired') }
      }
    }

    setExporting(true)
    setExportPhase('saving')
    try {
      const { exportVrew } = await import('../exporters/vrew.js')
      const project = buildExportProject(validScenes)

      console.log('[Export] Vrew — aspectRatio:', settings.aspectRatio, '→ format:', project.format)

      const result = await exportVrew(project, {
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

      toast.success(t('toast.vrewSaveComplete'), 5000)
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toast.warning(t('toast.vrewExportWarnings', { count: result.warnings.length }), 8000)
      }

      setExportPhase('launching')
      if (window.electronAPI?.openVrewProject) {
        try {
          const open = await window.electronAPI.openVrewProject({ targetPath: result.targetPath })
          if (open?.success) {
            toast.info(t('toast.vrewLaunched'), 5000)
          } else {
            toast.warning(t('toast.vrewLaunchFailed'), 6000)
          }
        } catch (openError) {
          console.warn('[Export] Failed to open Vrew:', openError)
          toast.warning(t('toast.vrewLaunchFailed'), 6000)
        }
      }

      await new Promise(r => setTimeout(r, 1500))
      setShowExportModal(false)
      onExportSuccess?.()
      return { success: true, targetPath: result.targetPath, warnings: result.warnings }
    } catch (error) {
      toast.error(t('toast.exportFailed', { error: resolveDisplayError(t, error.errorKind, error.message) }))
      return { success: false, error: error.message }
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
    exportFormat,
    handleExportClick,
    handleExportConfirm,
    handleExportPremiere,
    handleExportVrew
  }
}
