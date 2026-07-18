/**
 * useScenes — 프롬프트 변경 시 Done 씬 status 재설정 (Issue #2)
 *
 * 이미 생성 완료('done', 이미지 보유)된 씬의 프롬프트를 바꾸면 재생성 대상이 되도록
 * status 를 'pending' 으로 되돌린다. 단:
 *  - 프롬프트가 실제로 바뀐 경우만
 *  - 씬이 이미지(image/imagePath)를 가진 경우만(= Done)
 *  - updates 가 자체 status 를 실으면(생성 코드 경로) 그 값을 존중(덮어쓰지 않음)
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

function seedDone(result, extra = {}) {
  act(() => {
    result.current.setScenes([
      { id: 's1', prompt: 'OLD', status: 'done', image: 'data:img', ...extra },
    ])
  })
}

describe('updateScene — 프롬프트 변경 시 Done 씬 pending 리셋', () => {
  it('Done 씬 프롬프트가 바뀌면 status 가 pending 으로 리셋', () => {
    const { result } = renderHook(() => useScenes())
    seedDone(result)
    act(() => { result.current.updateScene('s1', { prompt: 'NEW' }) })
    expect(result.current.scenes[0].prompt).toBe('NEW')
    expect(result.current.scenes[0].status).toBe('pending')
  })

  it('imagePath(폴더 모드, image=null) 만 있어도 프롬프트 변경 시 pending', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 's1', prompt: 'OLD', status: 'done', image: null, imagePath: '/x.png' },
      ])
    })
    act(() => { result.current.updateScene('s1', { prompt: 'NEW' }) })
    expect(result.current.scenes[0].status).toBe('pending')
  })

  it('프롬프트가 같은 값이면 status 유지(불필요한 리셋 없음)', () => {
    const { result } = renderHook(() => useScenes())
    seedDone(result)
    act(() => { result.current.updateScene('s1', { prompt: 'OLD' }) }) // 동일
    expect(result.current.scenes[0].status).toBe('done')
  })

  it('이미지 없는 씬(아직 생성 안 됨)은 프롬프트 바꿔도 status 그대로', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 's1', prompt: 'OLD', status: 'pending', image: null, imagePath: null },
      ])
    })
    act(() => { result.current.updateScene('s1', { prompt: 'NEW' }) })
    expect(result.current.scenes[0].status).toBe('pending')
  })

  it('updates 가 명시적 status 를 실으면(생성 경로) 그 값을 존중 — pending 으로 덮어쓰지 않음', () => {
    const { result } = renderHook(() => useScenes())
    seedDone(result)
    act(() => { result.current.updateScene('s1', { prompt: 'NEW', status: 'generating' }) })
    expect(result.current.scenes[0].status).toBe('generating')
  })

  it('모달 Save(editData 통째 = 변경 안 된 status 포함)여도 프롬프트가 바뀌면 pending 리셋', () => {
    // SceneDetailModal 은 editData={...scene} 를 통째로 넘겨 status:'done' 이 포함된다.
    // 이때도 프롬프트가 실제로 바뀌었으면(=status 는 그대로) 재생성 대상이 되어야 한다.
    const { result } = renderHook(() => useScenes())
    seedDone(result)
    act(() => { result.current.updateScene('s1', { prompt: 'NEW', status: 'done', image: 'data:img' }) })
    expect(result.current.scenes[0].status).toBe('pending')
  })

  it('error 씬을 모달에서 프롬프트 편집(status:error 포함)해도 pending 리셋', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 's1', prompt: 'OLD', status: 'error', image: 'data:img' }])
    })
    act(() => { result.current.updateScene('s1', { prompt: 'NEW', status: 'error' }) })
    expect(result.current.scenes[0].status).toBe('pending')
  })

  it('프롬프트 키가 없는 patch(예: seed 만)는 status 를 건드리지 않음', () => {
    const { result } = renderHook(() => useScenes())
    seedDone(result)
    act(() => { result.current.updateScene('s1', { seed: 42 }) })
    expect(result.current.scenes[0].status).toBe('done')
  })

  it('생성 중(generating)인 씬은 프롬프트를 편집해도 pending 으로 뒤집지 않음(진행 중 write 보호)', () => {
    // 재생성 진행 중 인라인 프롬프트 편집이 status 를 pending 으로 뒤집으면, finalize 가 옛 프롬프트로
    // 만든 이미지를 done 으로 덮어 UI 가 거짓말한다. 진행 중엔 리셋을 보류한다.
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 's1', prompt: 'OLD', status: 'generating', image: 'data:img' }])
    })
    act(() => { result.current.updateScene('s1', { prompt: 'NEW' }) })
    expect(result.current.scenes[0].status).toBe('generating')
  })
})
