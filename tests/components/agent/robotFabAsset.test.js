import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// FAB 로봇은 계속 움직이고(2D 얼굴) 원근 공간에서 돌아야(3D) 한다.
// SVG 는 <img src> 로 로드되므로 바깥 CSS 가 내부에 못 닿는다 → 내부 애니메이션/명암은 SVG 안에,
// 3D 회전은 바깥 CSS 가 <img> 요소 자체에. 둘 중 하나라도 조용히 사라지면 여기서 잡는다.
describe('Robot FAB asset', () => {
  const svg = readFileSync('src/assets/Robot.svg', 'utf8')
  const css = readFileSync('src/components/agent/ChatPanel.css', 'utf8')

  it('SVG 안에 얼굴 애니메이션(깜빡임/시선/안테나)이 들어있다', () => {
    expect(svg).toContain('@keyframes robot-blink')
    expect(svg).toContain('@keyframes robot-look')
    expect(svg).toContain('@keyframes robot-pulse')
    // 애니메이션 대상이 실제로 클래스로 물려 있어야 한다(키프레임만 있고 미적용이면 안 돈다).
    expect(svg).toMatch(/class="eyes"/)
    expect(svg).toMatch(/class="eye"/)
    expect(svg).toMatch(/class="antenna"/)
  })

  it('SVG 명암 그라디언트로 볼륨을 만든다(평면 단색이면 3D 회전이 종이처럼 보인다)', () => {
    for (const id of ['shell', 'screen', 'glass', 'eye', 'bulb']) {
      expect(svg, `gradient #${id} 정의`).toMatch(new RegExp(`id="${id}"`))
      expect(svg, `gradient #${id} 사용`).toContain(`url(#${id})`)
    }
  })

  it('FAB CSS가 <img>를 원근 공간에서 회전시킨다', () => {
    // perspective 는 부모에 없으면 rotateY 가 납작하게 보인다.
    expect(css).toMatch(/\.agent-chat-fab\s*\{[^}]*perspective:/)
    expect(css).toContain('@keyframes robot-turn')
    expect(css).toMatch(/\.agent-chat-fab img\s*\{[^}]*animation:\s*robot-turn/)
    expect(css).toMatch(/@keyframes robot-turn[\s\S]*rotateY/)
  })

  it('prefers-reduced-motion 을 SVG와 FAB CSS 양쪽에서 존중한다', () => {
    expect(svg).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.agent-chat-fab img[\s\S]*animation: none/)
  })
})
