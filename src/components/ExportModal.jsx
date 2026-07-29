import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import { useAuth } from '../contexts/AuthContext'
import { useExportSettings } from '../hooks/useExportSettings'
import { useModalVisibility } from '../hooks/useModalVisibility'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { normalizeExportFormat } from '../utils/exportFormat'
import { formatExpiryDate } from '../utils/formatters'
import './ExportModal.css'

// 경로 프리셋 정의
const PATH_PRESETS = {
  mac: [
    { value: 'capcut', label: 'CapCut', template: (u, p) => `/Users/${u}/Movies/CapCut/User Data/Projects/com.lveditor.draft/${p}` },
    { value: 'custom', label: 'Custom' }
  ],
  windows: [
    { value: 'capcut', label: 'CapCut', template: (u, p) => `C:\\Users\\${u}\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft\\${p}` },
    { value: 'capcutpro', label: 'CapCut Pro', template: (u, p) => `C:\\Users\\${u}\\AppData\\Local\\CapCutPro\\User Data\\Projects\\com.lveditor.draft\\${p}` },
    { value: 'capcut_docs', label: 'Documents', template: (u, p) => `C:\\Users\\${u}\\Documents\\CapCut\\Projects\\${p}` },
    { value: 'custom', label: 'Custom' }
  ]
}

// 포맷 카드 — CapCut / Premiere 공통 프리젠테이셔널. details(children)만 포맷별로 다름.
function FormatCard({ icon, title, description, children }) {
  return (
    <div className="export-format-card selected">
      <div className="format-header">
        <span className="format-icon">{icon}</span>
        <div className="format-info">
          <h3>{title}</h3>
          <p className="format-description">{description}</p>
        </div>
      </div>
      <div className="format-details">{children}</div>
    </div>
  )
}

export const ExportModal = ({ isOpen, onClose, onExport, onExportPremiere, onExportVrew, initialFormat = 'capcut', projectName, loading, exportPhase, hasSubtitles, onUpgradeClick,
  // 이미지가 있는 pending 씬을 포함할지 묻기 위한 카운트. 씬 배열을 통째로 넘기지
  // 않는다 — 모달은 표시만 하고 분류는 App 이 한 번 한다.
  // ⚠️ 기본값 필수: 기존 테스트들이 이 prop 을 안 넘긴다.
  totalSceneCount = 0, readyCount = 0, pendingWithImageCount = 0 }) => {
  const { t, lang } = useI18n()
  const { isAuthenticated, subscription } = useAuth()
  const { settings: savedSettings, isLoaded, saveSettings } = useExportSettings()

  // OS 감지 (기본값 결정용)
  const detectedMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

  // 내보내기 포맷 — 'capcut'(기본) | 'premiere' | 'vrew'.
  // CapCut 은 draft 폴더 경로 + 설치확인 + 앱 실행, Premiere 는 프로젝트 폴더에
  // .prproj 자동 저장(경로 UI 불필요). Scale/KenBurns/자막 옵션은 공유.
  const [format, setFormat] = useState(() => normalizeExportFormat(initialFormat))

  // ── 내보내기 시도 상태기계 ──────────────────────────────────────────
  // 모달은 unmount 되지 않고 `if (!isOpen) return null` 일 뿐이라 state 가 살아남는다.
  // 그리고 preflight(설치확인·폴더확인)가 전부 비동기라, 그 사이에 모달이 닫히거나
  // 다시 열릴 수 있다. attempt 토큰이 그 경계를 가른다.
  //
  // phase 는 **반드시 ref** 다 — React state 는 동기 latch 가 아니라서 같은 flush
  // 안의 두 클릭이 둘 다 통과한다. isOpen 도 마찬가지로 async handler 가 캡처한
  // closure 값은 열려 있던 시점의 것이라 항상 true 다.
  const attemptRef = useRef(0)
  const phaseRef = useRef('idle')   // 'idle' | 'preflight' | 'choosing' | 'dispatching'
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen        // 렌더마다 동기화 (useRef(isOpen) 은 최초값만 잡는다)
  const [phase, setPhase] = useState('idle')      // 렌더용 거울
  const [pendingChoice, setPendingChoice] = useState(null)

  // Premiere 출력 폴더 — localStorage 가 비어도 ensurePermission(config 복원/기본폴더)
  // 으로 해소될 수 있으므로 resolver 결과를 state 로 들고 표시/가드에 사용.
  const [premiereWorkFolder, setPremiereWorkFolder] = useState(() => localStorage.getItem('workFolderPath') || '')

  const [username, setUsername] = useState('')
  const [projectNumber, setProjectNumber] = useState('')
  const [fullPath, setFullPath] = useState('')
  const [pathPreset, setPathPreset] = useState('capcut')
  const [pathManuallyEdited, setPathManuallyEdited] = useState(false)
  const [pathCopied, setPathCopied] = useState(false)
  const [scaleMode, setScaleMode] = useState('none')
  const [includeSubtitle, setIncludeSubtitle] = useState(true)
  const [kenBurns, setKenBurns] = useState(true)
  const [kenBurnsMode, setKenBurnsMode] = useState('random')
  const [kenBurnsCycle, setKenBurnsCycle] = useState(5)
  const [kenBurnsScaleMin, setKenBurnsScaleMin] = useState(100)
  const [kenBurnsScaleMax, setKenBurnsScaleMax] = useState(130)
  const [selectedOS, setSelectedOS] = useState(detectedMac ? 'mac' : 'windows')
  const [detectedBasePath, setDetectedBasePath] = useState('')  // 감지된 CapCut basePath

  // 현재 OS에 해당하는 프리셋 목록
  const currentPresets = PATH_PRESETS[selectedOS] || PATH_PRESETS.windows

  // 저장된 설정 로드
  useEffect(() => {
    if (isLoaded) {
      setScaleMode(savedSettings.scaleMode || 'none')
      setIncludeSubtitle(savedSettings.includeSubtitle !== false)
      setKenBurns(savedSettings.kenBurns !== false)
      setKenBurnsMode(savedSettings.kenBurnsMode || 'random')
      setKenBurnsCycle(savedSettings.kenBurnsCycle || 5)
      setKenBurnsScaleMin(savedSettings.kenBurnsScaleMin || 100)
      setKenBurnsScaleMax(savedSettings.kenBurnsScaleMax || 130)
      // pathPreset 로드
      setPathPreset(savedSettings.pathPreset || 'capcut')
    }
  }, [isLoaded, savedSettings])

  // 모달 열릴 때 진입에서 고른 포맷으로 초기화 (모달은 unmount 안 되므로 useState 초기값만으론 부족).
  // useLayoutEffect — paint 전 동기 적용해 "이전 탭이 한 프레임 보이는" 깜빡임 방지.
  useLayoutEffect(() => {
    if (isOpen) setFormat(normalizeExportFormat(initialFormat))
  }, [isOpen, initialFormat])

  // 닫히면 시도 상태를 리셋한다. **attempt 를 올리는 것이 핵심** — 외부에서 닫는
  // 경로가 실재한다(업그레이드 버튼이 setShowExportModal(false) 를 직접 부르고,
  // 그 버튼은 preflight 중에도 눌린다). attempt 를 안 올리면 뒤늦게 resolve 한
  // preflight 가 paywall 뒤에서 내보내기를 발사한다.
  //
  // ⚠️ dispatching 중이면 phase 는 건드리지 않는다 — 이미 발사된 콜백은 취소하지
  // 않고, 잠금 해제는 오직 dispatch 의 finally 가 한다.
  useLayoutEffect(() => {
    if (isOpen) return
    attemptRef.current += 1
    setPendingChoice(null)
    if (phaseRef.current !== 'dispatching') {
      phaseRef.current = 'idle'
      setPhase('idle')
    }
  }, [isOpen])

  // 모달 열릴 때 시스템 정보 자동 감지
  useEffect(() => {
    if (!isOpen) return

    async function autoDetect() {
      try {
        // 0. Premiere 출력 폴더 확보 — localStorage 가 비어도 config/기본폴더에서 복원.
        //    (CapCut 도 미디어 경로에 workFolder 를 쓰므로 무해)
        try {
          await fileSystemAPI.ensurePermission()
        } catch (e) {
          console.warn('[ExportModal] ensurePermission failed:', e?.message)
        }
        setPremiereWorkFolder(localStorage.getItem('workFolderPath') || '')

        // 1. 시스템 정보 (username, platform)
        if (window.electronAPI?.getSystemInfo) {
          const info = await window.electronAPI.getSystemInfo()
          if (info.success) {
            setUsername(info.username)
            setSelectedOS(info.platform === 'darwin' ? 'mac' : 'windows')
          }
        }

        // 2. CapCut 경로 자동 감지
        if (window.electronAPI?.detectCapcutPath) {
          const pathResult = await window.electronAPI.detectCapcutPath()
          if (pathResult.success && pathResult.basePath) {
            setDetectedBasePath(pathResult.basePath)

            // 3. 다음 프로젝트 번호 자동 계산
            if (window.electronAPI?.getNextProjectNumber) {
              const numResult = await window.electronAPI.getNextProjectNumber({ basePath: pathResult.basePath })
              if (numResult.success && numResult.folderName) {
                setProjectNumber(numResult.folderName)
              }
            }
          }
        }
      } catch (error) {
        console.warn('[ExportModal] Auto-detect failed:', error)
      }
    }

    autoDetect()
  }, [isOpen])

  // 전체 경로 자동 생성: detectedBasePath 기반 또는 프리셋 기반
  const generatePath = () => {
    if (!projectNumber) return ''

    // detectedBasePath가 있으면 그것 기반으로 생성
    if (detectedBasePath && pathPreset === 'capcut') {
      const sep = selectedOS === 'mac' ? '/' : '\\'
      return `${detectedBasePath}${sep}${projectNumber}`
    }

    // 프리셋 템플릿 기반 생성
    if (!username) return ''
    const preset = currentPresets.find(p => p.value === pathPreset)
    if (preset?.template) {
      return preset.template(username, projectNumber)
    }
    return '' // custom은 빈 문자열 (사용자 직접 입력)
  }

  // username, projectNumber, OS, pathPreset 변경 시 자동 경로 업데이트
  useEffect(() => {
    if (pathPreset !== 'custom' && !pathManuallyEdited) {
      setFullPath(generatePath())
    }
  }, [username, projectNumber, selectedOS, pathPreset, detectedBasePath])

  // OS 변경 시 해당 OS에 없는 프리셋이면 capcut으로 리셋
  useEffect(() => {
    const presets = PATH_PRESETS[selectedOS] || PATH_PRESETS.windows
    const exists = presets.some(p => p.value === pathPreset)
    if (!exists) {
      setPathPreset('capcut')
      setPathManuallyEdited(false)
    }
  }, [selectedOS])

  // 모달 열릴 때 Flow 뷰 숨기기 (네이티브 레이어는 CSS z-index로 가릴 수 없음)
  useModalVisibility(isOpen)

  if (!isOpen) return null

  // preflight 부터 dispatching 까지 액션을 잠근다. choosing 만 잠그면 preflight 중
  // 포맷을 바꿔 "보이는 포맷" 과 "발사되는 포맷" 이 갈린다.
  const busy = phase !== 'idle'

  // Premiere 출력 — 프로젝트 폴더(`${workFolder}/${projectName}`)에 `${projectName}.prproj` 자동 저장.
  // 작업 폴더는 이미지 생성 시점에 강제되므로 export 시점엔 항상 존재(방어용으로만 빈값 처리).
  const safeProjectName = projectName || 'untitled'
  const premiereOutputFolder = `${premiereWorkFolder}/${safeProjectName}`
  const premiereTargetPath = `${premiereOutputFolder}/${safeProjectName}.prproj`
  const vrewOutputFolder = `${premiereWorkFolder}/${safeProjectName}`
  const vrewTargetPath = `${vrewOutputFolder}/${safeProjectName}.vrew`

  // 포맷 공통 옵션 — CapCut/Premiere 콜백에 동일하게 전달.
  const buildExportOptions = () => ({
    scaleMode,  // 'fill' | 'fit' | 'none'
    kenBurns,
    kenBurnsMode,
    kenBurnsCycle: Number(kenBurnsCycle) || 5,
    kenBurnsScaleMin: Number(kenBurnsScaleMin) / 100 || 1.0,  // % → 비율
    kenBurnsScaleMax: Number(kenBurnsScaleMax) / 100 || 1.15,  // % → 비율
    subtitleOption: hasSubtitles && includeSubtitle ? 'ko' : 'none'
  })

  const persistOptions = () => {
    saveSettings({
      pathPreset,
      scaleMode,
      includeSubtitle,
      kenBurns,
      kenBurnsMode,
      kenBurnsCycle: Number(kenBurnsCycle) || 5,
      kenBurnsScaleMin: Number(kenBurnsScaleMin) || 100,
      kenBurnsScaleMax: Number(kenBurnsScaleMax) || 130,
    })
  }

  // Premiere — 프로젝트 폴더에 .prproj 자동 저장. 경로 검증/설치확인/앱실행 단계 없음.
  // CapCut 은 폴더 번호 자동증가라 충돌이 없지만, Premiere 는 파일명이 고정이라
  // 기존 .prproj 가 있으면 덮어쓰기 전에 확인 (Premiere 에서 손본 내용 보호).
  // 이 시도가 아직 유효한가 — 모든 await 직후에 부른다. 토큰이 바뀌었으면 그
  // 사이에 닫혔다 열렸다는 뜻이고, 닫혀 있으면 애초에 발사하면 안 된다.
  const isAlive = (my) => my === attemptRef.current && isOpenRef.current

  const callbackFor = (kind) => (
    kind === 'premiere' ? onExportPremiere
      : kind === 'vrew' ? (onExportVrew || (() => {}))
        : onExport
  )

  // phase 를 여는 유일한 지점이자 닫는 유일한 지점.
  //
  // ⚠️ **finally 에 attempt 가드를 걸지 않는다.** dispatch 중에 모달을 닫으면
  // attempt 가 올라가는데, 여기에 `my === attemptRef.current` 를 붙이면 그 경우
  // 리셋이 스킵돼 phase 가 'dispatching' 에 영구히 잠긴다(앱 재시작 전까지 내보내기
  // 사망). preflight finally 는 정반대로 가드가 **필수**다 — 의미가 반대다.
  const dispatch = async (kind, options, includePending) => {
    phaseRef.current = 'dispatching'
    setPhase('dispatching')
    setPendingChoice(null)
    // 발사 직전에만 저장한다(취소하면 저장하지 않는다) — 기존 동작 보존.
    persistOptions()
    try {
      await callbackFor(kind)({ ...options, includePending })
    } catch (err) {
      // 콜백은 실제로 reject 할 수 있다(권한 확인이 핸들러 try 바깥이다).
      // 삼키지 않으면 unhandled rejection 이 된다.
      console.warn('[ExportModal] export dispatch failed:', err)
    } finally {
      phaseRef.current = 'idle'
      setPhase('idle')
    }
  }

  const handleExport = async () => {
    if (phaseRef.current !== 'idle') return    // 동기 latch
    const my = ++attemptRef.current
    phaseRef.current = 'preflight'
    setPhase('preflight')
    try {
      const prepared = format === 'premiere' ? await preparePremiere(my)
        : format === 'vrew' ? await prepareVrew(my)
          : await prepareCapcut(my)
      if (!prepared || !isAlive(my)) return

      // Vrew 는 pending 포함을 지원하지 않는다(별건) → 항상 즉시 발사.
      if (prepared.kind === 'vrew' || pendingWithImageCount === 0) {
        await dispatch(prepared.kind, prepared.options, false)
        return
      }
      setPendingChoice({ attempt: my, kind: prepared.kind, options: prepared.options })
      phaseRef.current = 'choosing'
      setPhase('choosing')
    } finally {
      // ⚠️ 토큰 가드가 있어야 한다. A 가 늦게 resolve 하면서 B 의 latch 를 풀어버리는
      // 것을 막는다. choosing/dispatching 으로 전이한 경우에도 풀면 안 된다.
      if (my === attemptRef.current && phaseRef.current === 'preflight') {
        phaseRef.current = 'idle'
        setPhase('idle')
      }
    }
  }

  const handlePendingChoice = async (includePending) => {
    const choice = pendingChoice
    if (!choice || phaseRef.current !== 'choosing') return
    await dispatch(choice.kind, choice.options, includePending)
  }

  const handlePendingCancel = () => {
    setPendingChoice(null)
    phaseRef.current = 'idle'
    setPhase('idle')
    // 모달은 열린 채로 둔다 — 옵션을 고쳐 다시 시도할 수 있게.
  }

  // 닫기 일원화 — 백드롭/X/footer 취소가 전부 이걸 탄다. isOpen=false effect 가
  // 리셋을 하지만, 그건 App 이 실제로 닫아준 뒤에야 돈다.
  const handleClose = () => {
    onClose()
  }

  // preflight 는 **옵션만 만들어 돌려준다.** 콜백은 진입점(runExport)이 게이트를
  // 통과시킨 뒤 공통 dispatch 가 부른다 — 그래야 "포함/배제" 를 묻는 자리가 하나다.
  // 취소/조기 return 은 null.
  const preparePremiere = async (my) => {
    if (!premiereWorkFolder) {
      alert(t('exportModal.premiereWorkFolderRequired'))
      return
    }
    // Premiere Pro 설치 확인 — 미설치 시 다운로드 페이지 안내 (CapCut/Vrew 패턴).
    // Premiere 는 MS Store 미등재라 store 딥링크 없음 → appx 빌드는 외부링크 금지(정책)라
    // 안내 텍스트만, 그 외(nsis/mac)는 confirm 후 다운로드 페이지 열기.
    if (window.electronAPI?.checkPremiereInstalled) {
      const inst = await window.electronAPI.checkPremiereInstalled()
      if (!isAlive(my)) return null
      if (!inst?.installed) {
        if (__BUILD_TARGET__ === 'appx') {
          alert(t('exportModalExtra.premiereNotInstalled'))
        } else if (window.confirm(t('exportModalExtra.premiereNotInstalledConfirm'))) {
          window.electronAPI.openExternal?.('https://www.adobe.com/products/premiere.html')
        }
        return null
      }
    }
    // checkFolderExists 는 내부적으로 fs.access(pathExists) 라 파일에도 동작 — .prproj 존재 확인에 재사용.
    const existing = await window.electronAPI?.checkFolderExists?.({ folderPath: premiereTargetPath })
    if (!isAlive(my)) return null
    if (existing?.exists && !window.confirm(t('exportModal.premiereOverwriteConfirm'))) {
      return null
    }
    return {
      kind: 'premiere',
      options: {
        capcutProjectNumber: premiereOutputFolder,  // .prproj 를 쓸 출력 폴더
        ...buildExportOptions()
      }
    }
  }

  const prepareVrew = async (my) => {
    // Vrew 미설치 시 다운로드 안내 (CapCut 설치확인 패턴 미러). MS Store 미배포 → 다운로드 페이지.
    if (window.electronAPI?.checkVrewInstalled) {
      try {
        const result = await window.electronAPI.checkVrewInstalled()
        if (!isAlive(my)) return null
        if (!result.installed) {
          if (__BUILD_TARGET__ === 'appx') {
            // MS Store(appx) 빌드: 외부 다운로드 링크 유도 금지(스토어 정책) → 안내 텍스트만.
            // Vrew 는 MS Store 미배포라 CapCut 처럼 store 딥링크도 못 줌.
            alert(t('exportModalExtra.vrewNotInstalledStore'))
          } else if (window.confirm(t('exportModalExtra.vrewNotInstalled'))) {
            window.electronAPI.openExternal?.('https://vrew.voyagerx.com/')
          }
          return null
        }
      } catch (err) {
        console.warn('[ExportModal] Vrew install check failed:', err)
        // 체크 실패 시 export 막지 않음. ⚠️ 삼킨 뒤에도 stale 검사는 해야 한다 —
        // 이 catch 는 fail-open 이라 여기서 안 보면 닫힌 뒤 재개될 수 있다.
      }
      if (!isAlive(my)) return null
    }

    if (!premiereWorkFolder) {
      alert(t('exportModal.premiereWorkFolderRequired'))
      return null
    }
    const existing = await window.electronAPI?.checkFolderExists?.({ folderPath: vrewTargetPath })
    if (!isAlive(my)) return null
    if (existing?.exists && !window.confirm(t('exportModal.vrewOverwriteConfirm'))) {
      return null
    }
    return {
      kind: 'vrew',
      options: {
        capcutProjectNumber: vrewOutputFolder,
        ...buildExportOptions()
      }
    }
  }

  const prepareCapcut = async (my) => {
    // 필수 입력 검증
    if (!fullPath.trim()) {
      alert(t('exportModalExtra.pathRequired'))
      return null
    }

    // CapCut 설치 확인 (Custom 경로가 아닌 경우에만)
    if (pathPreset !== 'custom' && window.electronAPI?.checkCapcutInstalled) {
      try {
        const result = await window.electronAPI.checkCapcutInstalled()
        if (!isAlive(my)) return null
        if (!result.installed) {
          const wantDownload = window.confirm(t('exportModalExtra.capcutNotInstalled'))
          if (wantDownload) {
            const url = __BUILD_TARGET__ === 'appx'
              ? 'ms-windows-store://pdp/?ProductId=XP9KN75RRB9NHS'
              : 'https://www.capcut.com/download'
            window.electronAPI.openExternal(url)
          }
          return null
        }
      } catch (err) {
        console.warn('[ExportModal] CapCut install check failed:', err)
        // Don't block export on check failure. 삼킨 뒤에도 stale 검사는 한다 —
        // fail-open 이라 여기서 안 보면 닫힌 뒤 재개될 수 있다.
        //
        // 측정 결과 이 한 줄은 **등가 뮤턴트**다: 지우면 handleExport 의 최종
        // isAlive 백스톱이 어차피 잡고, 그 사이에 관찰 가능한 일이 없다. 다른
        // 사이트들과 달리 뒤따르는 대화상자가 없기 때문. 규칙("모든 await 직후")을
        // 깨서 다음 사람이 헷갈리게 두느니 남긴다.
      }
      if (!isAlive(my)) return null
    }

    return {
      kind: 'capcut',
      options: {
        capcutProjectNumber: fullPath,  // 전체 경로 (자동 생성 또는 수동 편집)
        ...buildExportOptions()
      }
    }
  }

  return createPortal(
    <div className="export-modal-overlay" onClick={loading ? undefined : handleClose}>
      {pendingChoice && (
        <div className="pending-choice-backdrop" onClick={(e) => e.stopPropagation()}>
          <div className="pending-choice" role="dialog" aria-modal="true">
            <p className="pending-choice-message">
              {t('exportModal.pendingChoiceMessage', {
                total: totalSceneCount,
                pending: pendingWithImageCount,
              })}
            </p>
            <p className="pending-choice-caveat">{t('exportModal.pendingChoiceCaveat')}</p>
            <div className="pending-choice-actions">
              <button type="button" className="export-btn export-btn-export"
                onClick={() => handlePendingChoice(true)}>
                {t('exportModal.pendingChoiceInclude')}
              </button>
              <button type="button" className="export-btn"
                onClick={() => handlePendingChoice(false)}>
                {t('exportModal.pendingChoiceExclude')}
              </button>
              <button type="button" className="export-btn export-btn-cancel"
                onClick={handlePendingCancel}>
                {t('exportModal.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* 로딩 오버레이 */}
        {loading && (
          <div className="export-loading-overlay">
            <div className="export-loading-content">
              <div className="export-loading-spinner"></div>
              <p>{exportPhase === 'launching'
                ? (format === 'premiere'
                  ? t('exportModal.premiereLaunching')
                  : format === 'vrew'
                    ? t('exportModal.vrewLaunching')
                    : t('exportModal.launchingCapcut'))
                : (format === 'premiere'
                  ? t('exportModal.premiereExporting')
                  : format === 'vrew'
                    ? t('exportModal.vrewExporting')
                    : t('exportModal.preparingPackage'))
              }</p>
              <span className="export-loading-hint">{exportPhase === 'launching'
                ? (format === 'premiere'
                  ? t('exportModal.premiereLaunchingHint')
                  : format === 'vrew'
                    ? t('exportModal.vrewLaunchingHint')
                    : t('exportModal.launchingHint'))
                : t('exportModal.pleaseWait')
              }</span>
            </div>
          </div>
        )}
        <div className="export-modal-header">
          <div className="header-title-wrap">
            <h2>📦 {format === 'premiere'
              ? t('exportModal.premiereTitle')
              : format === 'vrew'
                ? t('exportModal.vrewTitle')
                : t('exportModal.title')}</h2>
            {/* 'loading' 상태에서 0/0 garbage 가 새는 걸 막기 위해 trial/expired 만 명시.
                useExport gateway 가 loading 윈도우엔 모달을 안 열지만, defense in depth. */}
            {isAuthenticated && (subscription.status === 'trial' || subscription.status === 'expired') && (
              <span className="header-trial-badge">
                🎁 {t('exportModal.trialBadge', { exports: subscription.exportsRemaining, days: subscription.daysRemaining })}
              </span>
            )}
            {isAuthenticated && subscription.status === 'active' && subscription.expiresAt && (
              <span className="header-pro-badge">
                {subscription.plan === 'yearly' ? '👑' : '💎'} Pro ~{formatExpiryDate(subscription.expiresAt, lang)}
              </span>
            )}
          </div>
          <button className="close-btn" onClick={handleClose}>✕</button>
        </div>

        <div className="export-modal-content">
          {/* 포맷 선택 세그먼트 — 가능한 내보내기 포맷을 항상 노출 (발견성) */}
          <div className="export-format-tabs" role="group" aria-label={t('exportModal.formatSelectLabel')}>
            <button
              type="button"
              className={`export-format-tab ${format === 'capcut' ? 'active' : ''}`}
              aria-pressed={format === 'capcut'}
              disabled={busy}
              onClick={() => setFormat('capcut')}
            >
              ✂️ CapCut
            </button>
            <button
              type="button"
              className={`export-format-tab ${format === 'premiere' ? 'active' : ''}`}
              aria-pressed={format === 'premiere'}
              disabled={busy}
              onClick={() => setFormat('premiere')}
            >
              🎬 Premiere
            </button>
            <button
              type="button"
              className={`export-format-tab ${format === 'vrew' ? 'active' : ''}`}
              aria-pressed={format === 'vrew'}
              disabled={busy}
              onClick={() => setFormat('vrew')}
            >
              📝 Vrew
            </button>
          </div>

          {format === 'capcut' ? (
            <FormatCard icon="✂️" title={t('exportModal.capcutPackage')} description={t('exportModal.capcutPackageDesc')}>
              <p>{t('exportModal.zipDesc')}</p>
              <div className="format-output">
                <span className="output-label">{t('exportModal.output')}</span>
                <code>{projectName || 'untitled'}_capcut.zip</code>
              </div>
            </FormatCard>
          ) : format === 'premiere' ? (
            <FormatCard icon="🎬" title={t('exportModal.premierePackage')} description={t('exportModal.premierePackageDesc')}>
              <p>{t('exportModal.premiereSaveDesc')}</p>
              {premiereWorkFolder ? (
                <div className="format-output">
                  <span className="output-label">📁 {t('exportModal.premiereSaveLocation')}</span>
                  <code style={{ wordBreak: 'break-all' }}>{premiereTargetPath}</code>
                </div>
              ) : (
                // 작업 폴더 미설정 — 가짜 경로 대신 안내. Export 버튼도 비활성(사후 alert 보다 사전 차단).
                <p className="option-hint">📁 {t('exportModal.premiereWorkFolderRequired')}</p>
              )}
            </FormatCard>
          ) : (
            <FormatCard icon="📝" title={t('exportModal.vrewPackage')} description={t('exportModal.vrewPackageDesc')}>
              <p>{t('exportModal.vrewSaveDesc')}</p>
              {premiereWorkFolder ? (
                <div className="format-output">
                  <span className="output-label">📁 {t('exportModal.premiereSaveLocation')}</span>
                  <code style={{ wordBreak: 'break-all' }}>{vrewTargetPath}</code>
                </div>
              ) : (
                <p className="option-hint">📁 {t('exportModal.premiereWorkFolderRequired')}</p>
              )}
            </FormatCard>
          )}

          {/* ── CapCut 전용: 경로/번호/프리셋 (Premiere/Vrew 는 프로젝트 폴더 자동 저장) ── */}
          {format === 'capcut' && (<>
          {/* 자동 감지된 설정 (사용자명 + 프로젝트 번호) */}
          <div className="export-option-section">
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85em', color: '#888' }}>
                {selectedOS === 'mac' ? '🍎 macOS' : '🪟 Windows'} • 👤 {username || '...'}
              </span>
            </div>

            {/* CapCut 프로젝트 번호 (자동 감지, 수정 가능) */}
            <label className="option-label">
              📁 {t('exportModal.projectNumber')}
            </label>
            <input
              type="text"
              placeholder={t('exportModal.projectNumberPlaceholder')}
              value={projectNumber}
              onChange={(e) => setProjectNumber(e.target.value)}
              className="folder-input"
            />
            <p className="option-hint">
              💡 {t('exportModal.projectNumberHint')} ({t('exportModalExtra.autoDetected')})
            </p>
          </div>

          {/* 생성될 경로 미리보기 + 프리셋 선택 */}
          {fullPath && (
            <div className="export-option-section" style={{ background: pathPreset === 'custom' || pathManuallyEdited ? '#e8eaf6' : '#e8f4e8', padding: '10px 12px', borderRadius: '6px', border: `1px solid ${pathPreset === 'custom' || pathManuallyEdited ? '#5c6bc0' : '#4caf50'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="option-label" style={{ fontSize: '0.85em', color: pathPreset === 'custom' || pathManuallyEdited ? '#303f9f' : '#2e7d32', fontWeight: 'bold' }}>
                  📂 {t('exportModal.generatedPath')} {pathManuallyEdited && '✏️'}
                </label>
                {pathManuallyEdited && pathPreset !== 'custom' && (
                  <button
                    type="button"
                    onClick={() => { setPathManuallyEdited(false); setFullPath(generatePath()) }}
                    style={{ fontSize: '0.75em', padding: '2px 8px', border: '1px solid #999', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#666' }}
                  >
                    ↺ Reset
                  </button>
                )}
              </div>
              {/* 프리셋 선택 버튼 */}
              <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                {currentPresets.map(preset => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setPathPreset(preset.value)
                      setPathManuallyEdited(false)
                      if (preset.template) {
                        setFullPath(preset.template(username, projectNumber))
                      }
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.78em',
                      border: pathPreset === preset.value ? '2px solid #1976d2' : '1px solid #bbb',
                      borderRadius: '14px',
                      background: pathPreset === preset.value ? '#e3f2fd' : '#fff',
                      color: pathPreset === preset.value ? '#1565c0' : '#555',
                      cursor: 'pointer',
                      fontWeight: pathPreset === preset.value ? '600' : '400',
                      transition: 'all 0.15s'
                    }}
                  >
                    {preset.value === 'custom' ? (t('exportModal.pathPresetCustom') || preset.label) : preset.label}
                  </button>
                ))}
              </div>
              {/* 경로 입력 */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                <input
                  type="text"
                  value={fullPath}
                  onChange={(e) => { setFullPath(e.target.value); setPathManuallyEdited(true) }}
                  placeholder={pathPreset === 'custom' ? t('exportModal.customPathPlaceholder') : ''}
                  className="folder-input"
                  style={{ flex: 1, fontSize: '0.85em', wordBreak: 'break-all', color: '#1a1a1a', fontWeight: '500', background: '#fff', border: '1px solid #ccc' }}
                />
                <button
                  type="button"
                  data-tooltip-top={t('exportModal.copyPathTooltip')}
                  onClick={() => {
                    const parentPath = fullPath.split(/[/\\]/).slice(0, -1).join(selectedOS === 'mac' ? '/' : '\\')
                    navigator.clipboard.writeText(parentPath)
                    setPathCopied(true)
                    setTimeout(() => setPathCopied(false), 2000)
                  }}
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', fontSize: '0.9em', whiteSpace: 'nowrap' }}
                >
                  {pathCopied ? '✅' : '📋'}
                </button>
              </div>
            </div>
          )}

          {/* 경로 가이드 — 프리셋에 없는 경로 검색용 (custom일 때만 표시) */}
          {pathPreset === 'custom' && (
            <div className="export-option-section" style={{ background: '#f5f5f5', padding: '10px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.8em', color: '#666' }}>
              <p style={{ margin: '0 0 6px 0', fontSize: '0.9em', color: '#795548' }}>
                💡 {selectedOS === 'mac' ? t('exportModal.macPathSearch') : t('exportModal.winPathSearch')}
              </p>
              <code style={{ display: 'block', background: '#fff', padding: '6px 8px', borderRadius: '4px', fontSize: '0.9em', wordBreak: 'break-all', color: '#333', userSelect: 'all', cursor: 'text' }}>
                {selectedOS === 'mac' ? t('exportModal.macSearchCmd') : t('exportModal.winSearchCmd')}
              </code>
            </div>
          )}
          </>)}

          {/* Scale Mode 옵션 */}
          <div className="export-option-section">
            <label className="option-label">
              🔍 {t('exportModal.scaleMode')}
            </label>
            <select
              value={scaleMode}
              onChange={(e) => setScaleMode(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#1a1a1a', color: '#fff', fontSize: '0.9rem' }}
            >
              <option value="fill">📐 Fill - {t('exportModal.scaleFill')}</option>
              <option value="fit">📏 Fit - {t('exportModal.scaleFit')}</option>
              <option value="none">🖼️ None - {t('exportModal.scaleNone')}</option>
            </select>
            <p className="option-hint">
              {scaleMode === 'fill' && t('exportModal.scaleFillHint')}
              {scaleMode === 'fit' && t('exportModal.scaleFitHint')}
              {scaleMode === 'none' && t('exportModal.scaleNoneHint')}
            </p>
          </div>

          {/* Ken Burns 효과 옵션 */}
          <div className="export-option-section">
            <label className="checkbox-label" title={t('exportModal.kenBurnsTooltip')}>
              <input
                type="checkbox"
                checked={kenBurns}
                onChange={(e) => setKenBurns(e.target.checked)}
              />
              <span>🎬 {t('exportModal.kenBurns')}</span>
            </label>
            <p className="option-hint" style={{ marginLeft: '24px' }}>
              {t('exportModal.kenBurnsHint')}
            </p>
            {kenBurns && (
              <div style={{ marginLeft: '24px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={kenBurnsMode}
                    onChange={(e) => setKenBurnsMode(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: '4px' }}
                    title={t('exportModal.kenBurnsModeTooltip')}
                  >
                    <option value="random">🎲 {t('exportModal.kenBurnsModeRandom')}</option>
                    <option value="pattern">🎯 {t('exportModal.kenBurnsModePattern')}</option>
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={t('exportModal.kenBurnsCycleTooltip')}>
                    <span>{t('exportModal.kenBurnsCycle')}</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={kenBurnsCycle}
                      onChange={(e) => setKenBurnsCycle(e.target.value)}
                      style={{ width: '50px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                    <span>{t('exportModal.kenBurnsCycleUnit')}</span>
                  </div>
                </div>
                {/* 스케일 범위 입력 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} title={t('exportModal.kenBurnsScaleTooltip')}>
                  <span>🔍 {t('exportModal.kenBurnsScale')}</span>
                  <input
                    type="number"
                    min="100"
                    max="150"
                    value={kenBurnsScaleMin}
                    onChange={(e) => setKenBurnsScaleMin(e.target.value)}
                    style={{ width: '55px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center' }}
                  />
                  <span>~</span>
                  <input
                    type="number"
                    min="100"
                    max="150"
                    value={kenBurnsScaleMax}
                    onChange={(e) => setKenBurnsScaleMax(e.target.value)}
                    style={{ width: '55px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center' }}
                  />
                  <span>%</span>
                </div>
              </div>
            )}
          </div>

          {/* 자막 옵션 - 자막이 있을 때만 표시 */}
          {hasSubtitles && (
            <div className="export-option-section">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includeSubtitle}
                  onChange={(e) => setIncludeSubtitle(e.target.checked)}
                />
                <span>💬 {t('exportModal.includeSubtitle')}</span>
              </label>
              <p className="option-hint" style={{ marginLeft: '24px' }}>
                {t('exportModal.includeSubtitleHint')}
              </p>
            </div>
          )}

          {/* Info — CapCut import 가이드 (Premiere 는 카드의 저장 위치 안내로 충분) */}
          {format === 'capcut' && (
          <div className="export-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0 }}>📊 {t('exportModal.importGuide')}</h4>
              <button
                type="button"
                onClick={() => window.open('https://touchizen.github.io/guide/ko/autoflowcut/capcut-export.html', '_blank')}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.8em',
                  background: '#007AFF',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                📖 {t('exportModal.guideBtn')}
              </button>
            </div>
            <ul>
              <li>✅ {t('exportModal.importStep1')}</li>
              <li>✅ {t('exportModal.importStep2')}</li>
              <li style={{ fontSize: '0.85em', color: '#333', fontWeight: '500' }}>
                {selectedOS === 'mac' ? '🍎' : '🪟'} {t('exportModal.importStep3Path')}
              </li>
              <li>✅ {t('exportModal.importStep4')}</li>
            </ul>
            <p className="export-tip" style={{ marginTop: '10px', fontSize: '0.8em', color: '#666', background: '#f5f5f5', padding: '8px 10px', borderRadius: '4px' }}>
              💡 <strong>Tip:</strong> {t('exportModal.autoDownloadTip')}
            </p>
          </div>
          )}
        </div>

        <div className="export-modal-footer">
          <div className="export-actions">
            {/* 왼쪽: 구독 정보 및 업그레이드 버튼 */}
            <div className="export-actions-left">
              {/* 'loading' 윈도우엔 upgrade 버튼도 노출 금지 — 다른 사용자 권한 잔상 차단 */}
              {isAuthenticated && (subscription.status === 'trial' || subscription.status === 'expired') && (
              <button
                className="export-btn export-btn-upgrade"
                onClick={onUpgradeClick}
              >
                ⭐ {t('exportModal.upgradeBtn')}
              </button>
            )}
            </div>

            {/* 오른쪽: 취소/내보내기 버튼 */}
            <div className="export-actions-right">
              <button className="export-btn export-btn-cancel" onClick={handleClose}>
                {t('exportModal.cancel')}
              </button>
              <button
                className="export-btn export-btn-export"
                onClick={handleExport}
                disabled={loading || busy || ((format === 'premiere' || format === 'vrew') && !premiereWorkFolder)}
              >
                {loading ? `⏳ ${t('exportModal.exporting')}` : `📦 ${t('exportModal.export')}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
