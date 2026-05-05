/**
 * AudioPanel loading state tests.
 *
 * Two scenarios covered:
 *  1. loading=true && !audioPackage  → spinner empty state (initial import)
 *  2. loading=true && audioPackage    → overlay spinner over content (refresh)
 *  3. loading=false && audioPackage   → no overlay (steady state)
 *
 * useDeferredValue isStale path is harder to deterministically trigger in jsdom
 * (depends on React's internal scheduling), so we cover only the explicit
 * loading-prop branch here. Manual QA covers the project-switch case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import AudioPanel from '../../src/components/AudioPanel'
import { I18nProvider } from '../../src/hooks/useI18n'

const render = (ui, options) => rtlRender(<I18nProvider>{ui}</I18nProvider>, options)

const audioPackage = {
  folderPath: '/audio',
  media: { video: { path: '/audio/n.mp3', filename: 'n.mp3', durationMs: 60000 } },
  voices: [],
  sfx: [],
}

beforeEach(() => {
  global.window.electronAPI = {
    readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
  }
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

describe('AudioPanel loading state', () => {
  it('loading + 데이터 없음 → spinner가 있는 empty state', () => {
    const { container } = render(
      <AudioPanel audioPackage={null} loading={true} scenes={[]} srtEntries={[]} />
    )
    // spinner element 표시
    const spinner = container.querySelector('.audio-spinner')
    expect(spinner).toBeInTheDocument()
    // 가져오는 중 안내 (Loading audio package... / 오디오 패키지를 가져오는 중...)
    expect(screen.getByText(/Loading audio|가져오는 중/i)).toBeInTheDocument()
    // importFirst empty state는 안 보여야 함
    expect(screen.queryByText(/Import audio|먼저 가져오세요/i)).not.toBeInTheDocument()
  })

  it('loading=false + 데이터 없음 → 일반 empty state (spinner 없음)', () => {
    const { container } = render(
      <AudioPanel audioPackage={null} loading={false} scenes={[]} srtEntries={[]} />
    )
    expect(container.querySelector('.audio-spinner')).toBeNull()
    expect(screen.getByText(/Import audio|먼저 가져오세요/i)).toBeInTheDocument()
  })

  it('loading + 데이터 있음 → overlay spinner가 컨텐츠 위에 표시', () => {
    const { container } = render(
      <AudioPanel
        audioPackage={audioPackage}
        loading={true}
        scenes={[]}
        srtEntries={[]}
      />
    )
    // overlay element 존재
    const overlay = container.querySelector('.audio-panel-loading-overlay')
    expect(overlay).toBeInTheDocument()
    // overlay 내부에 spinner도 있음
    expect(overlay.querySelector('.audio-spinner')).toBeInTheDocument()
    // role/aria 검증 (스크린리더 친화)
    expect(overlay).toHaveAttribute('role', 'status')
    expect(overlay).toHaveAttribute('aria-live', 'polite')
    // 일반 컨텐츠도 함께 마운트되어 있음 (overlay는 위에 떠있을 뿐)
    expect(screen.getByText(/Audio Timeline/i)).toBeInTheDocument()
  })

  it('loading=false + 데이터 있음 → overlay 없음 (steady state)', () => {
    const { container } = render(
      <AudioPanel
        audioPackage={audioPackage}
        loading={false}
        scenes={[]}
        srtEntries={[]}
      />
    )
    expect(container.querySelector('.audio-panel-loading-overlay')).toBeNull()
  })

  it('loading prop 미지정 → 기본값 false로 동작', () => {
    const { container } = render(
      <AudioPanel audioPackage={audioPackage} scenes={[]} srtEntries={[]} />
    )
    expect(container.querySelector('.audio-panel-loading-overlay')).toBeNull()
  })

  // Regression (Issue A): loading 중에도 AudioTimeline이 마운트된 채로 남아 있어
  // 키보드 단축키로 deferred 데이터에 의도치 않은 재생/정지 트리거 가능했음
  describe('loading 중 hotkey/버튼 차단', () => {
    it('loading=true → Space 키 눌러도 readFileAbsolute(재생 시작) 호출 안 됨', () => {
      render(
        <AudioPanel
          audioPackage={audioPackage}
          loading={true}
          scenes={[]}
          srtEntries={[]}
          onRefresh={() => {}}
        />
      )
      // input/textarea 외부에서 Space → 평소엔 togglePlay 트리거됨
      // disabled prop이 잘 전달되면 readFileAbsolute는 호출되지 말아야 함
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      expect(global.window.electronAPI.readFileAbsolute).not.toHaveBeenCalled()
    })

    it('loading=true → 재생 버튼 disabled 속성', () => {
      const { container } = render(
        <AudioPanel
          audioPackage={audioPackage}
          loading={true}
          scenes={[]}
          srtEntries={[]}
          onRefresh={() => {}}
        />
      )
      const playBtn = container.querySelector('.atl-play-btn')
      expect(playBtn).toBeInTheDocument()
      expect(playBtn).toBeDisabled()
      const stopBtn = container.querySelector('.atl-stop-btn')
      expect(stopBtn).toBeDisabled()
    })

    it('loading=true → refresh 버튼 disabled + 클릭해도 onRefresh 호출 안 됨', () => {
      const onRefresh = vi.fn()
      const { container } = render(
        <AudioPanel
          audioPackage={audioPackage}
          loading={true}
          scenes={[]}
          srtEntries={[]}
          onRefresh={onRefresh}
        />
      )
      const refreshBtn = container.querySelector('.sub-tab-refresh-btn')
      expect(refreshBtn).toBeInTheDocument()
      expect(refreshBtn).toBeDisabled()
      expect(refreshBtn).toHaveAttribute('aria-busy', 'true')
      // 강제로 클릭해도 onRefresh 안 불려야 함 (disabled가 click 막아주지만 가드 이중 검증)
      refreshBtn.click()
      expect(onRefresh).not.toHaveBeenCalled()
    })

    it('loading=false → refresh 버튼 정상 동작', () => {
      const onRefresh = vi.fn()
      const { container } = render(
        <AudioPanel
          audioPackage={audioPackage}
          loading={false}
          scenes={[]}
          srtEntries={[]}
          onRefresh={onRefresh}
        />
      )
      const refreshBtn = container.querySelector('.sub-tab-refresh-btn')
      expect(refreshBtn).not.toBeDisabled()
      refreshBtn.click()
      expect(onRefresh).toHaveBeenCalledTimes(1)
    })
  })
})
