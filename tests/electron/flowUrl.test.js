// @vitest-environment node
/**
 * flowUrl — Flow 의 두 가지 URL 배치를 한 곳에서 판정한다.
 *
 * Google 이 Flow 를 옮겼다(2026-09 실측):
 *   https://labs.google/fx/tools/flow            → https://flow.google.com/
 *   https://labs.google/fx/tools/flow/project/X  → https://flow.google.com/project/X
 *
 * 옛 배치만 인식하면 리다이렉트 후 착지한 페이지를 "대상 아님"으로 오판하고,
 * 폴링이 mode-entry 를 다시 돌려 무한히 재시도한다(사용자 제보 로그의 그 반복).
 */
import { describe, it, expect } from 'vitest'
import { flowBaseFromUrl, flowProjectUrl, onProjectComposerUrl } from '../../electron/flowUrl.js'

const ID = '134cf5b5-6a64-47b8-8709-6de4c6b0e44c'

describe('flowBaseFromUrl — 현재 URL 에서 프로젝트 URL 을 만들 base 추출', () => {
  it('새 도메인', () => {
    expect(flowBaseFromUrl(`https://flow.google.com/project/${ID}`)).toBe('https://flow.google.com')
    expect(flowBaseFromUrl('https://flow.google.com/')).toBe('https://flow.google.com')
  })

  it('옛 도메인 — 로케일 포함 base 를 보존한다', () => {
    expect(flowBaseFromUrl('https://labs.google/fx/tools/flow/')).toBe('https://labs.google/fx/tools/flow')
    expect(flowBaseFromUrl('https://labs.google/ko/fx/tools/flow/project/x'))
      .toBe('https://labs.google/ko/fx/tools/flow')
  })

  it('알 수 없는 URL 은 새 도메인으로 폴백한다 (옛 도메인은 어차피 리다이렉트된다)', () => {
    expect(flowBaseFromUrl('')).toBe('https://flow.google.com')
    expect(flowBaseFromUrl('https://example.com/x')).toBe('https://flow.google.com')
  })
})

describe('flowProjectUrl', () => {
  it('base 뒤에 /project/<id> 를 붙인다', () => {
    expect(flowProjectUrl('https://flow.google.com', ID)).toBe(`https://flow.google.com/project/${ID}`)
    expect(flowProjectUrl('https://labs.google/fx/tools/flow', ID))
      .toBe(`https://labs.google/fx/tools/flow/project/${ID}`)
  })
})

describe('onProjectComposerUrl — 대상 프로젝트의 컴포저인가', () => {
  it('새 도메인의 컴포저 경로를 인정한다 (이게 없어서 무한 반복이 났다)', () => {
    expect(onProjectComposerUrl(`https://flow.google.com/project/${ID}`, ID)).toBe(true)
    expect(onProjectComposerUrl(`https://flow.google.com/project/${ID}/`, ID)).toBe(true)
    expect(onProjectComposerUrl(`https://flow.google.com/project/${ID}/all-media`, ID)).toBe(true)
  })

  it('옛 도메인도 계속 인정한다', () => {
    expect(onProjectComposerUrl(`https://labs.google/fx/tools/flow/project/${ID}`, ID)).toBe(true)
    expect(onProjectComposerUrl(`https://labs.google/fx/tools/flow/project/${ID}/all-media`, ID)).toBe(true)
  })

  it('컴포저가 아닌 하위 라우트는 거부한다 — 거기에 프롬프트를 주입하면 안 된다', () => {
    expect(onProjectComposerUrl(`https://flow.google.com/project/${ID}/characters`, ID)).toBe(false)
    expect(onProjectComposerUrl(`https://flow.google.com/project/${ID}/edit/abc`, ID)).toBe(false)
    expect(onProjectComposerUrl(`https://labs.google/fx/tools/flow/project/${ID}/settings`, ID)).toBe(false)
  })

  it('다른 프로젝트·다른 오리진·쿼리 위장은 거부한다', () => {
    expect(onProjectComposerUrl(`https://flow.google.com/project/${ID}-suffix`, ID)).toBe(false)
    expect(onProjectComposerUrl(`https://evil.example/project/${ID}`, ID)).toBe(false)
    expect(onProjectComposerUrl(`https://flow.google.com/?next=/project/${ID}`, ID)).toBe(false)
    expect(onProjectComposerUrl(`https://flow.google.com/archive/project/${ID}`, ID)).toBe(false)
  })

  it('id 가 한 세그먼트가 아니면 거부한다 — 저장값 오염 방어', () => {
    expect(onProjectComposerUrl('https://flow.google.com/project/abc/characters', 'abc/characters')).toBe(false)
  })

  it('정규식 메타문자가 든 id 로도 던지지 않는다', () => {
    expect(() => onProjectComposerUrl('https://flow.google.com/project/x', '[')).not.toThrow()
    expect(onProjectComposerUrl('https://flow.google.com/project/x', '[')).toBe(false)
  })

  it('항상 boolean 이다', () => {
    expect(onProjectComposerUrl('', ID)).toBe(false)
    expect(onProjectComposerUrl(null, ID)).toBe(false)
    expect(onProjectComposerUrl(`https://flow.google.com/project/${ID}`, '')).toBe(false)
  })
})
