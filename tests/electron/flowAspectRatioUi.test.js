// @vitest-environment node
//
// Flow 설정 패널의 화면비 탭 id 접미사 매핑. CDP 사용 금지라 이 DOM 클릭이 화면비를 정하는
// 유일한 수단이고, 두 값이 뒤바뀌면 세로 숏츠가 통째로 가로로 생성된다 — 그런데 이 매핑에는
// 테스트가 없어 반대로 바꿔도 전 스위트가 초록이었다.
import { describe, it, expect } from 'vitest'
import { aspectRatioTabSuffix } from '../../electron/flow-aspect-ratio-ui.js'

describe('aspectRatioTabSuffix', () => {
  it('9:16 은 세로(PORTRAIT) 탭', () => {
    expect(aspectRatioTabSuffix('9:16')).toBe('-trigger-PORTRAIT')
  })

  it('16:9 는 가로(LANDSCAPE) 탭', () => {
    expect(aspectRatioTabSuffix('16:9')).toBe('-trigger-LANDSCAPE')
  })

  it('세로 접미사는 3:4 탭(-trigger-PORTRAIT_3_4)과 구별된다', () => {
    // 호출부는 endsWith 로 찾는다 — 접미사가 3:4 탭 id 의 접미사이기도 하면 잘못 잡는다.
    expect('some-id-trigger-PORTRAIT_3_4'.endsWith(aspectRatioTabSuffix('9:16'))).toBe(false)
    expect('some-id-trigger-PORTRAIT'.endsWith(aspectRatioTabSuffix('9:16'))).toBe(true)
  })

  it('지원하지 않는 값/빈 값은 null — 호출부가 화면비 단계를 건너뛴다', () => {
    for (const v of ['4:3', '1:1', '', null, undefined]) {
      expect(aspectRatioTabSuffix(v)).toBeNull()
    }
  })
})
