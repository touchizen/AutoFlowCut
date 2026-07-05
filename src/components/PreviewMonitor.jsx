/**
 * PreviewMonitor — 상단 프리뷰 모니터 렌더. App.jsx 에서 분리.
 *
 * 표시 위치는 입력 프롬프트 왼쪽(.editor-row row-reverse) inline. 전체화면은 .main-panel
 * (container-type)이 position:fixed 의 containing block 이 돼 뷰포트 풀스크린이 안 되므로
 * document.body 로 portal 한다. 본문(monitorInner)은 inline/fullscreen 이 공유.
 *
 * 상태/효과는 useMonitor 훅이 소유 — 이 컴포넌트는 순수 렌더.
 */
import { createPortal } from 'react-dom'
import LiveGenerationGrid from './LiveGenerationGrid'
import PreviewPanel from './AudioTimeline/PreviewPanel'
import { buildGenerationItems, sortGenerationItems } from '../utils/generationItems'

export default function PreviewMonitor({
  monitorMode,
  monitorFullscreen,
  monitorWidth,
  monitorMs,
  monitorPlaying,
  monitorHiddenRoles,
  monitorVolume,
  monitorMuted,
  setMonitorVolume,
  toggleMonitorMuted,
  toggleMonitorFullscreen,
  onCloseOverlay,
  startMonitorResize,
  resetMonitorWidth,
  mode,
  anyRunning,
  runningGenMode,
  bottomPanelView,
  scenes,
  videoScenes,
  framePairs,
  settings,
  srtEntries,
  onSelectVideo,
  onSelectScene,
  t,
}) {
  if (monitorMode !== 'inline') return null

  // 전체화면 중엔 하단 타임라인이 가려져 재생/정지 트랜스포트를 모니터에 띄운다.
  //   이때 뮤트/볼륨도 상단이 아니라 재생 버튼 옆(트랜스포트)에 둔다. 그 외(inline)엔 상단 도구모음.
  const showTransport = monitorFullscreen && !anyRunning && bottomPanelView === 'timeline'

  // 뮤트 버튼 + 볼륨 슬라이더 — inline=상단 도구모음 / 전체화면=트랜스포트, 한 곳에만 렌더.
  const volumeControls = (
    <>
      <button
        className="content-monitor-tool content-monitor-mute"
        onClick={toggleMonitorMuted}
        title={monitorMuted ? t('monitor.unmute') : t('monitor.mute')}
      >{monitorMuted ? '🔇' : '🔊'}</button>
      <input
        className="content-monitor-volume"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={monitorMuted ? 0 : monitorVolume}
        onChange={(e) => setMonitorVolume(parseFloat(e.target.value))}
        title={t('monitor.volume')}
        aria-label={t('monitor.volume')}
      />
    </>
  )

  const inner = (
    <>
      <div className="content-monitor-tools">
        {!showTransport && volumeControls}
        <button
          className="content-monitor-tool"
          onClick={toggleMonitorFullscreen}
          title={monitorFullscreen ? t('common.close') : t('monitor.fullscreen')}
        >{monitorFullscreen ? '🗗' : '⛶'}</button>
        {mode === 'flow' && (
          <button
            className="content-monitor-tool"
            onClick={onCloseOverlay}
            title={t('common.close')}
          >✕</button>
        )}
      </div>
      {anyRunning ? (
        // 생성 중 — 라이브 자산 그리드(snapshot 된 runningGenMode 기준).
        <LiveGenerationGrid
          items={sortGenerationItems(buildGenerationItems(runningGenMode, { scenes, videoScenes, framePairs }))}
          aspectRatio={settings.aspectRatio}
          onItemSelect={(item) => item.kind === 'video' ? onSelectVideo(item.ref) : onSelectScene(item.ref)}
        />
      ) : (
        <PreviewPanel
          playheadMs={monitorMs}
          scenes={scenes}
          srtEntries={srtEntries}
          height="100%"
          isPlaying={monitorPlaying}
          hiddenRoles={monitorHiddenRoles}
          monitorVolume={monitorVolume}
          monitorMuted={monitorMuted}
        />
      )}
      {showTransport && (
        // 전체화면 중엔 하단 타임라인이 가려지므로 재생/정지 + 뮤트/볼륨을 모니터 트랜스포트에 둔다.
        // 'timeline' 뷰일 때만(=AudioTimeline 마운트돼 이벤트 수신 가능). 명령은 window CustomEvent.
        <div className="content-monitor-transport">
          <button
            className="content-monitor-tbtn"
            onClick={() => window.dispatchEvent(new CustomEvent('monitor-transport', { detail: { action: 'toggle' } }))}
            title={monitorPlaying ? t('audioTimeline.pauseLabel') : t('audioTimeline.playLabel')}
          >{monitorPlaying ? '⏸' : '▶'}</button>
          <button
            className="content-monitor-tbtn"
            onClick={() => window.dispatchEvent(new CustomEvent('monitor-transport', { detail: { action: 'stop' } }))}
            title={t('audioTimeline.stopLabel')}
          >⏹</button>
          {volumeControls}
        </div>
      )}
    </>
  )

  // 전체화면: body 로 portal (container-type 영향 회피, 뷰포트 전체 덮기).
  if (monitorFullscreen) {
    return createPortal(
      <aside className="content-monitor content-monitor--max">{inner}</aside>,
      document.body
    )
  }

  // inline: 리사이저 + 사이드 모니터.
  return (
    <>
      <div
        className="content-monitor-resizer"
        onMouseDown={startMonitorResize}
        onDoubleClick={resetMonitorWidth}
        title="드래그=폭 조절 · 더블클릭=기본(5:5)"
      />
      <aside className="content-monitor" style={{ width: monitorWidth ?? '50%' }}>
        {inner}
      </aside>
    </>
  )
}
