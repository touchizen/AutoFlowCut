// @vitest-environment node
// 실제 view 전환 보존 효과는 ChatPanel.test.jsx가 검증한다. 이 guard는 App의 실제 mount 지점이
// generate/story 조건부 body 안으로 이동해 그 효과가 무효화되는 배선 mutant를 잡는다.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('App agent surface 배치', () => {
  it('ChatPanel을 activeView 분기보다 앞선 전역 sibling으로 정확히 한 번 mount한다', () => {
    const source = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
    const appRoot = source.indexOf("className={`${computeAppClass(mode)}${isAgentDocked ? ' agent-docked' : ''}`}")
    const panel = source.indexOf('<ChatPanel', appRoot)
    const generateBranch = source.indexOf("{activeView === 'generate' && (", appRoot)
    const storyBranch = source.indexOf("{activeView === 'story' && (", appRoot)

    expect(source).toContain("import ChatPanel from './components/agent/ChatPanel'")
    expect(appRoot).toBeGreaterThan(-1)
    expect(panel).toBeGreaterThan(appRoot)
    expect(panel).toBeLessThan(generateBranch)
    expect(panel).toBeLessThan(storyBranch)
    const approval = source.lastIndexOf('<ApprovalDialog', panel)
    expect(source.slice(approval, panel)).toMatch(/<ApprovalDialog\s*\/>\s*$/)
    expect(source.match(/<ChatPanel\b/g)).toHaveLength(1)
    expect(source).toContain('const [agentPanelOpen, setAgentPanelOpen] = useState(false)')
    const panelProps = source.slice(panel, source.indexOf('/>', panel))
    expect(panelProps).toContain('open={agentPanelOpen}')
    expect(panelProps).toContain('onOpen={() => setAgentPanelOpen(true)}')
    expect(panelProps).toContain('onDismiss={() => setAgentPanelOpen(false)}')
    expect(panelProps).toContain('appMode={mode}')
    expect(panelProps).toContain('agentPanelMode={settings.agentPanelMode}')
    expect(panelProps).toContain("onAgentPanelModeChange={(nextMode) => updateSetting('agentPanelMode', nextMode)}")
  })

  it('API docked panel이 열려 있을 때만 App container에 reserve class와 width를 건다', () => {
    const source = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')

    expect(source).toContain("import { effectiveAgentPanelMode } from './components/agent/agentPanelLayout'")
    expect(source).toMatch(
      /const isAgentDocked = agentPanelOpen\s*&& effectiveAgentPanelMode\(mode, settings\.agentPanelMode\) === 'docked'/,
    )
    expect(source).toContain(
      "className={`${computeAppClass(mode)}${isAgentDocked ? ' agent-docked' : ''}`}",
    )
    expect(source).toContain("style={{ '--agent-dock-w': '400px' }}")
  })

  it('App은 useVideoAutomation의 admission/status/event/cleanup source를 ChatPanel에 주입한다', () => {
    const source = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
    const panel = source.slice(source.indexOf('<ChatPanel'), source.indexOf('/>', source.indexOf('<ChatPanel')))

    expect(panel).toContain('videoAdmissionSources={videoAdmissionSources}')
    expect(source).toContain('videoAutomation.admitVideoBatch')
    expect(source).toContain('videoAutomation.getVideoStatus')
    expect(source).toContain('videoAutomation.subscribeVideoStatus')
    expect(source).toContain('videoAutomation.abortAndClearVideoOperations')
  })

  it('agent path는 resolved rendererSceneId updater를 쓰고 legacy vscene 변환 두 곳은 characterization으로 고정한다', () => {
    const source = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
    expect(source).toContain("from './agent/videoAdmission'")
    expect(source).toContain('scenesHook.updateScene(rendererSceneId, agentVideoScenePatch(newStatus, result))')
    expect(source).toContain('approvedSceneCount: items.length')
    expect(source.match(/const sceneId = id\.replace\('vscene_', 'scene_'\)/g)).toHaveLength(2)
  })
})
