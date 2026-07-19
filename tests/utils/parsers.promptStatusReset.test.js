/**
 * mergeTextIntoScenes — 프롬프트 편집 시 Done 씬 status 재설정 (Issue #2, PromptInput 경로)
 *
 * PromptInput 직접 편집(및 .txt import)은 updateScene 이 아니라 mergeTextIntoScenes 로 흐른다.
 * 이미 생성 완료(이미지 보유)된 씬의 이미지 프롬프트가 바뀌면 재생성 대상이 되도록 pending 으로 되돌린다.
 */
import { describe, it, expect } from 'vitest'
import { mergeTextIntoScenes } from '../../src/utils/parsers'

const doneScene = (over = {}) => ({
  id: 's1', prompt: 'OLD', status: 'done', image: 'data:img', endTime: 3, duration: 3, ...over,
})

describe('mergeTextIntoScenes — 프롬프트 변경 시 Done 씬 pending', () => {
  it('PromptInput 편집(truncate): 이미지 프롬프트가 바뀌면 status pending', () => {
    const out = mergeTextIntoScenes([doneScene()], 'NEW', 3, { truncateToIncoming: true })
    expect(out[0].prompt).toBe('NEW')
    expect(out[0].status).toBe('pending')
  })

  it('프롬프트가 같으면 status 유지', () => {
    const out = mergeTextIntoScenes([doneScene()], 'OLD', 3, { truncateToIncoming: true })
    expect(out[0].status).toBe('done')
  })

  it('이미지 없는 씬은 프롬프트 바뀌어도 status 그대로', () => {
    const out = mergeTextIntoScenes([doneScene({ image: null, imagePath: null, status: 'pending' })], 'NEW', 3, { truncateToIncoming: true })
    expect(out[0].status).toBe('pending')
  })

  it('imagePath 만 있어도(폴더 모드) 프롬프트 변경 시 pending', () => {
    const out = mergeTextIntoScenes([doneScene({ image: null, imagePath: '/x.png' })], 'NEW', 3, { truncateToIncoming: true })
    expect(out[0].status).toBe('pending')
  })

  it('비디오 프롬프트 필드 편집은 이미지 status 를 건드리지 않음', () => {
    const out = mergeTextIntoScenes([doneScene()], 'NEW VID', 3, { truncateToIncoming: true, fieldName: 'videoT2VPrompt' })
    expect(out[0].status).toBe('done')
  })

  it('.txt import(non-truncate)도 동일하게 Done 씬 프롬프트 변경 시 pending', () => {
    const out = mergeTextIntoScenes([doneScene()], 'NEW', 3, {})
    expect(out[0].status).toBe('pending')
  })

  it('프롬프트를 전부 비워도(빈 입력) Done 씬은 pending 으로 리셋(리뷰 R2)', () => {
    const out = mergeTextIntoScenes([doneScene()], '', 3, { truncateToIncoming: true })
    expect(out[0].prompt).toBe('')
    expect(out[0].status).toBe('pending')
  })
})
