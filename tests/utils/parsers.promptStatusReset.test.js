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

// updateScene 과 동일한 donePrompt 기반 done 복원 규칙을 벌크(PromptInput) 경로에도 적용.
// 실측 버그: done→편집(pending)→정확히 원래 프롬프트로 원복해도 done 으로 복원 안 되고 pending 고착.
// mergeField 가 "직전 값과 다르면 pending" 만 하고 donePrompt 와 비교하지 않아서 원복을 인지 못했다.
describe('mergeTextIntoScenes — 프롬프트 원복 시 Done 복원', () => {
  it('첫 편집 시 생성 기준(donePrompt=P0) 을 캡처한다 (원복 baseline 확보)', () => {
    const out = mergeTextIntoScenes([doneScene({ prompt: 'P0' })], 'P1', 3, { truncateToIncoming: true })
    expect(out[0].status).toBe('pending')
    expect(out[0].donePrompt).toBe('P0')
  })

  it('원복: donePrompt=P0 인 pending 씬을 다시 P0 로 되돌리면 done 복원', () => {
    const editedPending = doneScene({ prompt: 'P1', donePrompt: 'P0', status: 'pending' })
    const out = mergeTextIntoScenes([editedPending], 'P0', 3, { truncateToIncoming: true })
    expect(out[0].prompt).toBe('P0')
    expect(out[0].status).toBe('done')
  })

  it('legacy(donePrompt 없음) 도 P0→P1→P0 왕복이면 done 복원', () => {
    // 1차 편집: baseline 캡처 + pending
    const after1 = mergeTextIntoScenes([doneScene({ prompt: 'P0' })], 'P1', 3, { truncateToIncoming: true })
    expect(after1[0].status).toBe('pending')
    // 2차 원복: 캡처된 donePrompt 로 복원
    const after2 = mergeTextIntoScenes([after1[0]], 'P0', 3, { truncateToIncoming: true })
    expect(after2[0].status).toBe('done')
  })

  it('원복 복원 시 이전 세대의 error/errorKind 클리어 (updateScene 과 동일)', () => {
    const errored = doneScene({ prompt: 'P1', donePrompt: 'P0', status: 'error', error: 'boom', errorKind: 'gen' })
    const out = mergeTextIntoScenes([errored], 'P0', 3, { truncateToIncoming: true })
    expect(out[0].status).toBe('done')
    expect(out[0].error).toBe(null)
    expect(out[0].errorKind).toBe(null)
  })

  it('P0 와 다른 값(P2)으로 바꾸면 여전히 pending (복원 아님)', () => {
    const editedPending = doneScene({ prompt: 'P1', donePrompt: 'P0', status: 'pending' })
    const out = mergeTextIntoScenes([editedPending], 'P2', 3, { truncateToIncoming: true })
    expect(out[0].status).toBe('pending')
  })

  it('generating 씬은 벌크 편집으로 status 를 건드리지 않음 (updateScene 과 동일 가드)', () => {
    const gen = doneScene({ prompt: 'P0', donePrompt: 'P0', status: 'generating' })
    const out = mergeTextIntoScenes([gen], 'P1', 3, { truncateToIncoming: true })
    expect(out[0].status).toBe('generating')
  })
})
