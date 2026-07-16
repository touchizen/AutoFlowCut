import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// FAB 로봇 얼굴은 계속 움직여야 한다. 이 SVG 는 <img src> 로 로드되므로 바깥 CSS 가 못 닿는다
// → 애니메이션이 파일 안에 있어야만 실제로 돈다. 누가 자산을 갈아끼우며 조용히 지우면 여기서 잡는다.
describe('Robot FAB asset', () => {
  const svg = readFileSync('src/assets/Robot.svg', 'utf8')

  it('SVG 안에 얼굴 애니메이션(깜빡임/시선/안테나)이 들어있다', () => {
    expect(svg).toContain('@keyframes robot-blink')
    expect(svg).toContain('@keyframes robot-look')
    expect(svg).toContain('@keyframes robot-pulse')
    // 애니메이션 대상이 실제로 클래스로 물려 있어야 한다(키프레임만 있고 미적용이면 안 돈다).
    expect(svg).toMatch(/class="eyes"/)
    expect(svg).toMatch(/class="eye"/)
    expect(svg).toMatch(/class="antenna"/)
  })

  it('prefers-reduced-motion 을 존중한다', () => {
    expect(svg).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/)
  })
})
