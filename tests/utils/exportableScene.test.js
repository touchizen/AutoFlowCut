import { describe, expect, it } from 'vitest'
import { isExportableScene } from '../../src/utils/exportableScene.js'

describe('isExportableScene', () => {
  it('생성이 끝나고 이미지가 있는 씬은 export 가능하다', () => {
    expect(isExportableScene({ status: 'done', image: 'base64-image' })).toBe(true)
  })

  it('이미지가 남아 있어도 pending 씬은 export하지 않는다', () => {
    expect(isExportableScene({ status: 'pending', image: 'base64-image' })).toBe(false)
  })

  it('완료 상태여도 export할 미디어가 없으면 export하지 않는다', () => {
    expect(isExportableScene({ status: 'done' })).toBe(false)
  })
})
