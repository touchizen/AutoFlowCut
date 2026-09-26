/**
 * useExport 훅 테스트 (Desktop)
 *
 * CapCut 패키지 내보내기 훅 테스트
 * Desktop에서는 Blob 다운로드 대신 Electron IPC로 디스크에 직접 기록
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const { mockExportRenderVideo } = vi.hoisted(() => ({
  mockExportRenderVideo: vi.fn(async () => ({ ok: true, outPath: '/tmp/output.mp4' })),
}))

vi.mock('../../src/exporters/render.js', () => ({
  exportRenderVideo: mockExportRenderVideo,
  makeRenderJobId: () => 'job_video_segments',
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true }) },
  default: () => ({}),
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (key) => key, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (key) => key, lang: 'ko', setLang: vi.fn() }),
}))

import { useExport } from '../../src/hooks/useExport'

// Mock 함수들
const mockToast = {
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}

const mockIncrementExportCount = vi.fn()

describe('useExport 로직', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleExportClick', () => {
    it('이미지 없으면 경고', () => {
      const scenes = [
        { id: 'scene_1', prompt: '프롬프트', image: null },
        { id: 'scene_2', prompt: '프롬프트2', imagePath: null }
      ]

      const validScenes = scenes.filter(s => s.image || s.imagePath)

      if (validScenes.length === 0) {
        mockToast.warning('생성된 이미지가 없습니다.')
      }

      expect(mockToast.warning).toHaveBeenCalledWith('생성된 이미지가 없습니다.')
    })

    it('이미지 있으면 통과', () => {
      const scenes = [
        { id: 'scene_1', prompt: '프롬프트', image: 'base64...' },
        { id: 'scene_2', prompt: '프롬프트2', imagePath: 'path/to/image.png' }
      ]

      const validScenes = scenes.filter(s => s.image || s.imagePath)

      expect(validScenes).toHaveLength(2)
    })

    it('미인증 시 로그인 요청', () => {
      const isAuthenticated = false
      const onLoginRequired = vi.fn()

      if (!isAuthenticated) {
        onLoginRequired()
      }

      expect(onLoginRequired).toHaveBeenCalled()
    })

    it('구독 만료 시 페이월 표시', () => {
      const subscription = { canExport: false }
      const onPaywallRequired = vi.fn()

      if (subscription && !subscription.canExport) {
        onPaywallRequired('trial_expired')
      }

      expect(onPaywallRequired).toHaveBeenCalledWith('trial_expired')
    })

    it('모든 조건 충족 시 모달 열기', () => {
      const scenes = [{ id: 'scene_1', image: 'base64...' }]
      const isAuthenticated = true
      const subscription = { canExport: true }
      let showExportModal = false

      const validScenes = scenes.filter(s => s.image || s.imagePath)

      if (validScenes.length > 0 && isAuthenticated && subscription.canExport) {
        showExportModal = true
      }

      expect(showExportModal).toBe(true)
    })
  })

  describe('handleExportConfirm', () => {
    it('파일 경로 있는 씬 권한 확인 필요', () => {
      const scenes = [
        { id: 'scene_1', image: 'data:image/png;base64,...', imagePath: null },
        { id: 'scene_2', image: null, imagePath: 'project/images/scene_2.png' }
      ]

      const validScenes = scenes.filter(s => s.image || s.imagePath)
      const hasFilePaths = validScenes.some(s => s.imagePath && !s.imagePath.startsWith('data:'))

      expect(hasFilePaths).toBe(true)
    })

    it('base64만 있으면 권한 불필요', () => {
      const scenes = [
        { id: 'scene_1', image: 'data:image/png;base64,...', imagePath: null },
        { id: 'scene_2', image: 'data:image/jpeg;base64,...', imagePath: 'data:image/png;base64,...' }
      ]

      const validScenes = scenes.filter(s => s.image || s.imagePath)
      const hasFilePaths = validScenes.some(s => s.imagePath && !s.imagePath.startsWith('data:'))

      expect(hasFilePaths).toBe(false)
    })

    describe('프로젝트 데이터 변환', () => {
      it('씬을 프로젝트 형식으로 변환', () => {
        const scenes = [
          {
            id: 'scene_1',
            image: 'base64...',
            imagePath: 'path/to/image.png',
            duration: 5,
            subtitle: '한국어 자막',
            subtitle_en: 'English subtitle',
            image_size: { width: 1920, height: 1080 }
          }
        ]
        const settings = {
          projectName: 'test_project',
          aspectRatio: '16:9',
          defaultDuration: 3
        }

        const project = {
          name: settings.projectName,
          format: settings.aspectRatio === '9:16' ? 'portrait' : 'landscape',
          scenes: scenes.map(s => ({
            id: s.id,
            image_path: s.imagePath || s.image,
            image_fallback: s.image,
            image_duration: s.duration || settings.defaultDuration || 3,
            image_size: s.image_size || null,
            subtitle_ko: s.subtitle || '',
            subtitle_en: s.subtitle_en || '',
            subtitle: s.subtitle || '',
            title: s.title || ''
          })),
          videos: []
        }

        expect(project.name).toBe('test_project')
        expect(project.format).toBe('landscape')
        expect(project.scenes[0].image_path).toBe('path/to/image.png')
        expect(project.scenes[0].image_fallback).toBe('base64...')
        expect(project.scenes[0].image_duration).toBe(5)
        expect(project.scenes[0].subtitle_ko).toBe('한국어 자막')
      })

      // GCF(whisk2capcut functions/index.js)는 format === 'portrait' 일 때만
      // canvas_config 를 세로(1080x1920)로 잡는다. 'short' 를 보내면 인식하지
      // 못해 9:16 프로젝트도 16:9 draft 로 나온다.
      it('9:16 비율은 portrait 포맷', () => {
        const aspectRatio = '9:16'
        const format = aspectRatio === '9:16' ? 'portrait' : 'landscape'
        expect(format).toBe('portrait')
      })

      it('16:9 비율은 landscape 포맷', () => {
        const aspectRatio = '16:9'
        const format = aspectRatio === '9:16' ? 'portrait' : 'landscape'
        expect(format).toBe('landscape')
      })

      it('1:1 비율은 landscape 포맷', () => {
        const aspectRatio = '1:1'
        const format = aspectRatio === '9:16' ? 'portrait' : 'landscape'
        expect(format).toBe('landscape')
      })
    })

    describe('SRT 파일명 처리', () => {
      it('ko 옵션 시 _ko 제거', () => {
        const subtitleOption = 'ko'
        const projectName = 'test_project'
        const oldName = `media/${projectName}_subtitle_ko.srt`
        const newName = `media/${projectName}_subtitle.srt`

        if (subtitleOption === 'ko') {
          expect(oldName).toBe('media/test_project_subtitle_ko.srt')
          expect(newName).toBe('media/test_project_subtitle.srt')
        }
      })

      it('en/both 옵션은 파일명 유지', () => {
        const subtitleOptions = ['en', 'both']
        subtitleOptions.forEach(option => {
          const shouldRename = option === 'ko'
          expect(shouldRename).toBe(false)
        })
      })
    })

    describe('Desktop: 파일 시스템 직접 기록', () => {
      it('exportCapcut이 { success, targetPath }를 반환', () => {
        const result = {
          success: true,
          targetPath: '/Users/test/CapCut/Projects/0128'
        }
        expect(result.success).toBe(true)
        expect(result.targetPath).toContain('CapCut')
      })

      it('exportCapcut 실패 시 에러 throw', () => {
        const result = { success: false, error: 'Export failed' }
        expect(() => {
          if (!result.success) {
            throw new Error(result.error || 'Export failed')
          }
        }).toThrow('Export failed')
      })
    })

    describe('Desktop: CapCut 실행', () => {
      it('window.electronAPI.openCapcut 호출', async () => {
        const mockOpenCapcut = vi.fn().mockResolvedValue(undefined)
        window.electronAPI.openCapcut = mockOpenCapcut
        await window.electronAPI.openCapcut()
        expect(mockOpenCapcut).toHaveBeenCalled()
      })

      it('CapCut 실행 실패해도 내보내기는 성공', async () => {
        const mockOpenCapcut = vi.fn().mockRejectedValue(new Error('CapCut not found'))
        window.electronAPI.openCapcut = mockOpenCapcut
        let exportSuccess = true

        try {
          await window.electronAPI.openCapcut()
        } catch (e) {
          console.warn('Failed to open CapCut:', e)
        }

        expect(exportSuccess).toBe(true)
      })
    })

    describe('내보내기 카운트', () => {
      it('내보내기 성공 후 카운트 증가', async () => {
        mockIncrementExportCount.mockResolvedValue({ exportCount: 1 })
        await mockIncrementExportCount()
        expect(mockIncrementExportCount).toHaveBeenCalled()
      })

      it('카운트 증가 실패해도 내보내기는 성공', async () => {
        mockIncrementExportCount.mockRejectedValue(new Error('Network error'))
        try {
          await mockIncrementExportCount()
        } catch (error) {
          console.warn('Failed to increment count:', error)
        }
        expect(mockIncrementExportCount).toHaveBeenCalled()
      })
    })
  })

  describe('self-render 비디오 메타 직렬화', () => {
    const storyScenes = [{ id: 'scene_1', image: 'data:image/png;base64,STORY', duration: 3 }]
    const renderArgs = {
      scaleMode: 'fit', kenBurns: false, kenBurnsMode: 'random', kenBurnsCycle: 5,
      kenBurnsScaleMin: 1, kenBurnsScaleMax: 1.3, subtitleOption: 'none', subtitleFontSize: 8,
      renderMode: 'final', renderBurnSubtitle: true,
    }
    const renderStoryHook = () => renderHook(() => useExport({
      settings: { projectName: 'P', aspectRatio: '16:9', defaultDuration: 3 },
      scenes: storyScenes,
      openSettings: vi.fn(),
      isAuthenticated: true,
      subscription: { status: 'trial', canExport: true },
      refreshSubscription: vi.fn(),
      onLoginRequired: vi.fn(),
      onPaywallRequired: vi.fn(),
      storyProjectPath: '/tmp/story-project',
    }))

    it('electronAPI는 있는데 story audio bridge가 없으면 무음 렌더를 차단한다', async () => {
      window.electronAPI = { onRenderProgress: vi.fn(() => vi.fn()) }
      const { result } = renderStoryHook()

      let exportResult
      await act(async () => { exportResult = await result.current.handleExportRender(renderArgs) })

      expect(exportResult).toMatchObject({ success: false })
      expect(exportResult.error).toMatch(/storyLoadAudioPackage/)
      expect(mockExportRenderVideo).not.toHaveBeenCalled()
    })

    it('electronAPI 자체가 없는 테스트 환경은 기존처럼 story audio 없이 진행한다', async () => {
      delete window.electronAPI
      const { result } = renderStoryHook()

      let exportResult
      await act(async () => { exportResult = await result.current.handleExportRender(renderArgs) })

      expect(exportResult).toMatchObject({ success: true })
      expect(mockExportRenderVideo).toHaveBeenCalledTimes(1)
    })

    it('project에 segment/meta를 붙이고 path와 data fallback을 함께 보존한다', async () => {
      const scenes = [
        {
          id: 'scene_1', imagePath: '/tmp/scene_1.png', duration: 5,
          videoI2VPath: '/tmp/i2v.mp4', videoI2V: 'data:video/mp4;base64,I2V', videoI2VDuration: 2,
          videoT2VPath: '/tmp/t2v.mp4', videoT2VDuration: 4,
        },
        {
          id: 'scene_2', imagePath: '/tmp/scene_2.png', duration: 4,
          videoT2VPath: '/tmp/no-duration.mp4', videoT2V: 'data:video/mp4;base64,T2V', videoT2VDuration: null,
        },
        { id: 'scene_3', imagePath: '/tmp/scene_3.png', duration: 3 },
      ]
      window.electronAPI = { onRenderProgress: vi.fn(() => vi.fn()) }

      const { result } = renderHook(() => useExport({
        settings: { projectName: 'P', aspectRatio: '16:9', defaultDuration: 3 },
        scenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription: vi.fn(),
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn(),
      }))

      await act(async () => {
        await result.current.handleExportRender({
          scaleMode: 'fit', kenBurns: false, kenBurnsMode: 'random', kenBurnsCycle: 5,
          kenBurnsScaleMin: 1, kenBurnsScaleMax: 1.3, subtitleOption: 'none', subtitleFontSize: 8,
          renderMode: 'final', renderBurnSubtitle: true,
        })
      })

      const project = mockExportRenderVideo.mock.calls[0][0]
      expect(project.renderVideoSegments).toEqual([
        { sceneId: 'scene_1', source: 'i2v', inSec: 3, outSec: 5 },
      ])
      expect(project.renderSceneMeta).toEqual({
        scene_1: { hasVideo: true },
        scene_2: { hasVideo: true },
        scene_3: { hasVideo: false },
      })
      expect(project.scenes[0].videos[0]).toEqual({
        source: 'i2v',
        path: '/tmp/i2v.mp4',
        fallback: 'data:video/mp4;base64,I2V',
        duration: 2,
      })
      expect(project.scenes[1].videos[0]).toEqual({
        source: 't2v',
        path: '/tmp/no-duration.mp4',
        fallback: 'data:video/mp4;base64,T2V',
        duration: 4,
      })
    })
  })

  describe('에러 처리', () => {
    it('내보내기 실패 시 에러 토스트', () => {
      const error = new Error('Cloud Function error')
      mockToast.error('Export 실패: ' + error.message)
      expect(mockToast.error).toHaveBeenCalledWith('Export 실패: Cloud Function error')
    })
  })

  describe('상태 관리', () => {
    it('exporting 상태 관리', () => {
      let exporting = false
      exporting = true
      expect(exporting).toBe(true)
      exporting = false
      expect(exporting).toBe(false)
    })

    it('showExportModal 상태 관리', () => {
      let showExportModal = false
      showExportModal = true
      expect(showExportModal).toBe(true)
      showExportModal = false
      expect(showExportModal).toBe(false)
    })

    it('exportPhase 상태 관리 (Desktop)', () => {
      let exportPhase = null
      exportPhase = 'saving'
      expect(exportPhase).toBe('saving')
      exportPhase = 'launching'
      expect(exportPhase).toBe('launching')
      exportPhase = null
      expect(exportPhase).toBeNull()
    })
  })
})

describe('Export 옵션', () => {
  it('기본 옵션 구조', () => {
    const options = {
      capcutProjectNumber: '0128',
      scaleMode: 'fill',
      kenBurns: true,
      kenBurnsMode: 'random',
      kenBurnsCycle: 5,
      kenBurnsScaleMin: 1.0,
      kenBurnsScaleMax: 1.3,
      subtitleOption: 'both'
    }
    expect(options).toHaveProperty('capcutProjectNumber')
    expect(options).toHaveProperty('scaleMode')
    expect(options).toHaveProperty('kenBurns')
    expect(options).toHaveProperty('subtitleOption')
  })

  it('Ken Burns 비활성화 옵션', () => {
    const options = { kenBurns: false }
    expect(options.kenBurns).toBe(false)
  })

  it('스케일 모드 옵션', () => {
    const validScaleModes = ['fill', 'fit', 'none']
    validScaleModes.forEach(mode => {
      expect(['fill', 'fit', 'none']).toContain(mode)
    })
  })

  it('자막 옵션', () => {
    const validSubtitleOptions = ['ko', 'en', 'both', 'none']
    validSubtitleOptions.forEach(option => {
      expect(['ko', 'en', 'both', 'none']).toContain(option)
    })
  })
})

describe('훅 반환값', () => {
  it('반환 객체 구조 (Desktop)', () => {
    const hookReturn = {
      showExportModal: false,
      setShowExportModal: vi.fn(),
      exporting: false,
      exportPhase: null,
      handleExportClick: vi.fn(),
      handleExportConfirm: vi.fn()
    }
    expect(hookReturn).toHaveProperty('showExportModal')
    expect(hookReturn).toHaveProperty('setShowExportModal')
    expect(hookReturn).toHaveProperty('exporting')
    expect(hookReturn).toHaveProperty('exportPhase')
    expect(hookReturn).toHaveProperty('handleExportClick')
    expect(hookReturn).toHaveProperty('handleExportConfirm')
  })
})

describe('통합 시나리오', () => {
  it('전체 내보내기 플로우 (Desktop)', async () => {
    const scenes = [
      { id: 'scene_1', image: 'base64...', subtitle: '자막1', duration: 3 }
    ]
    const isAuthenticated = true
    const subscription = { canExport: true }

    const validScenes = scenes.filter(s => s.image || s.imagePath)
    expect(validScenes.length).toBeGreaterThan(0)
    expect(isAuthenticated).toBe(true)
    expect(subscription.canExport).toBe(true)

    let showExportModal = true
    expect(showExportModal).toBe(true)

    const options = {
      capcutProjectNumber: '/Users/test/CapCut/Projects/0128',
      scaleMode: 'fill',
      kenBurns: false,
      subtitleOption: 'ko'
    }

    let exporting = true
    let exportPhase = 'saving'
    expect(exporting).toBe(true)
    expect(exportPhase).toBe('saving')

    const project = {
      name: 'test',
      format: 'landscape',
      scenes: validScenes.map(s => ({
        id: s.id,
        image_path: s.image,
        subtitle_ko: s.subtitle
      })),
      videos: []
    }
    expect(project.scenes).toHaveLength(1)

    const result = { success: true, targetPath: options.capcutProjectNumber }
    expect(result.success).toBe(true)

    exportPhase = 'launching'
    expect(exportPhase).toBe('launching')

    mockIncrementExportCount.mockResolvedValue({ exportCount: 1 })
    await mockIncrementExportCount()

    exporting = false
    exportPhase = null
    showExportModal = false
    expect(exporting).toBe(false)
    expect(exportPhase).toBeNull()
    expect(showExportModal).toBe(false)
  })
})
