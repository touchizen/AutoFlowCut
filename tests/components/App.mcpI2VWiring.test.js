// 2026-10-30 I2V — App 배선(소스 핀). MCP set-frame-pairs(executeJavaScript 로 동기 처리) 직후 start-scene-batch {mode:'i2v'} 가 오면
//   그 사이 React 재렌더가 없을 수 있다 → handleStart 의 클로저 framePairs·ftvPromptSource 는 옛 값(선택 0 이면 멈추고, 옛 선택이면 **다른 행이 과금**된다).
//   그래서 I2V 시작은 동기 갱신되는 ref(framePairsRef·ftvPromptSourceRef)를 읽고, useMcpServer 에는 ref 판독기와 setter 를 넘긴다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const startImpl = app.slice(app.indexOf('const handleStartImpl = async'), app.indexOf('const handleStart = async'))
const i2vCase = startImpl.slice(startImpl.indexOf("case 'frame-to-video': {"), startImpl.indexOf('default:'))
const mcpCall = app.slice(app.indexOf('useMcpServer({'), app.indexOf('})', app.indexOf('useMcpServer({')))

describe('App — MCP I2V 배선', () => {
  it('ftvPromptSource 는 ref 를 동기로 갱신하는 setter 로 바꾼다(framePairs 와 같은 꼴)', () => {
    expect(app).toMatch(/const ftvPromptSourceRef = useRef\(/)
    expect(app).toMatch(/const setFtvPromptSource = useCallback\(\(next\) => \{\s*ftvPromptSourceRef\.current = next/)
  })
  it('useMcpServer 에 getFramePairs(ref 판독기)·setFramePairs·setFtvPromptSource·isStartInFlight 를 넘긴다', () => {
    expect(mcpCall).toMatch(/getFramePairs: \(\) => framePairsRef\.current/)
    expect(mcpCall).toMatch(/\bsetFramePairs\b/)
    expect(mcpCall).toMatch(/\bsetFtvPromptSource\b/)
    // Codex 리뷰 H2: 시작 준비(인증·폴더 확인 await) 중에도 set-frame-pairs 를 거절한다 — 실행 중 미러는 그 구간에 아직 false 다
    // Codex 2차 H2: videoAutomation.start 를 기다리지 않으므로 시작 latch 가 풀린 뒤에도 자동화의 토큰·준비 구간이 남는다 — I2V 배치 latch 가 끝까지 쥔다
    expect(mcpCall).toMatch(/isStartInFlight: \(\) => startInFlightRef\.current \|\| i2vBatchPendingRef\.current/)
    expect(mcpCall).toMatch(/getFtvPromptSource: \(\) => ftvPromptSourceRef\.current/)
  })
  it('I2V 케이스: videoAutomation.start 전에 i2vBatchPendingRef 를 켜고 finally 에서 끈다 · 시작 씬의 imagePath 를 실어 보낸다(Codex 2차 H1)', () => {
    expect(i2vCase).toMatch(/i2vBatchPendingRef\.current = true[\s\S]*videoAutomation\.start\(/)
    expect(i2vCase).toMatch(/\.finally\(\(\) => \{\s*i2vBatchPendingRef\.current = false/)
    expect(i2vCase).toMatch(/_startImagePath: startIsGallery \? null : \(startScene\?\.imagePath \|\| null\)/)
  })
  it('I2V 시작은 handleStartImpl 첫머리(await 전)에 행·프롬프트 출처를 ref 에서 붙잡고 그 사본으로 검증·실행한다(Codex 리뷰 H2)', () => {
    const head = startImpl.slice(0, startImpl.indexOf('await '))
    expect(head).toMatch(/const framePairsAtStart = framePairsRef\.current/)
    expect(head).toMatch(/const ftvPromptSourceAtStart = ftvPromptSourceRef\.current/)
    const check = startImpl.slice(startImpl.indexOf("if (startTab === 'frame-to-video') {"), startImpl.indexOf('// 폴더 설정 확인'))
    expect(check).toMatch(/framePairsAtStart\.filter\(p => p\.selected !== false\)/)
    expect(i2vCase).toMatch(/const selectedFramePairs = framePairsAtStart\.filter\(p => p\.selected !== false\)/)
    expect(i2vCase).toMatch(/getFramePairEffectivePrompt\(p, ftvPromptSourceAtStart, videoScenes, scenes\)/)
    expect(i2vCase).not.toMatch(/\bframePairs\.filter\(/)
  })
})
