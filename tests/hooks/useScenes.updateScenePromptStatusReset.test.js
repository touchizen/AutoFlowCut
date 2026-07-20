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

  it('완료 프롬프트에서 벗어났다가 정확히 되돌리면 done 으로 복원', () => {
    const { result } = renderHook(() => useScenes())
    seedDone(result, { donePrompt: 'OLD' })

    act(() => { result.current.updateScene('s1', { prompt: 'NEW' }) })
    expect(result.current.scenes[0].status).toBe('pending')

    act(() => { result.current.updateScene('s1', { prompt: 'OLD' }) })
    expect(result.current.scenes[0].status).toBe('done')
  })

  it('legacy done 씬은 첫 편집 때 기존 prompt 를 baseline 으로 캡처하고 되돌리면 done 복원', () => {
    const { result } = renderHook(() => useScenes())
    seedDone(result)

    act(() => { result.current.updateScene('s1', { prompt: 'NEW' }) })
    expect(result.current.scenes[0]).toMatchObject({
      prompt: 'NEW',
      donePrompt: 'OLD',
      status: 'pending',
    })

    act(() => { result.current.updateScene('s1', { prompt: 'OLD' }) })
    expect(result.current.scenes[0].status).toBe('done')
  })

  it('baseline 없는 legacy pending 씬은 되돌림처럼 보여도 done 으로 오복원하지 않음', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 's1', prompt: 'EDITED', status: 'pending', image: 'data:img' },
      ])
    })

    act(() => { result.current.updateScene('s1', { prompt: 'ORIGINAL' }) })
    expect(result.current.scenes[0].status).toBe('pending')
    expect(result.current.scenes[0]).not.toHaveProperty('donePrompt')
  })

  it('재생성 완료가 donePrompt 를 새 prompt 로 갱신해 옛 prompt 를 done 으로 복원하지 않음', () => {
    const { result } = renderHook(() => useScenes())
    seedDone(result, { prompt: 'P1', donePrompt: 'P1' })

    act(() => { result.current.updateScene('s1', { prompt: 'P2' }) })
    act(() => { result.current.updateScene('s1', { status: 'done', donePrompt: 'P2' }) })
    expect(result.current.scenes[0]).toMatchObject({ prompt: 'P2', donePrompt: 'P2', status: 'done' })

    act(() => { result.current.updateScene('s1', { prompt: 'P1' }) })
    expect(result.current.scenes[0].status).toBe('pending')

    act(() => { result.current.updateScene('s1', { prompt: 'P2' }) })
    expect(result.current.scenes[0].status).toBe('done')
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

  it('이미지가 filePath 에만 있어도(썸네일 렌더 기준=hasImageData) 프롬프트 변경 pending + 원복 done', () => {
    // 실측 버그: image/imagePath 는 null 이고 filePath/data 로만 이미지가 있는 씬은 썸네일은 뜨는데
    // 좁은 가드(image||imagePath)가 "이미지 없음"으로 봐서 pending 전환도 원복 복원도 스킵됐다.
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 's1', prompt: 'P0', status: 'done', donePrompt: 'P0', image: null, imagePath: null, filePath: '/x.jpg' },
      ])
    })
    act(() => { result.current.updateScene('s1', { prompt: 'P1' }) })
    expect(result.current.scenes[0].status).toBe('pending')
    act(() => { result.current.updateScene('s1', { prompt: 'P0' }) })
    expect(result.current.scenes[0].status).toBe('done')
  })

  it('이미지가 data(base64) 에만 있어도 프롬프트 변경 pending', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 's1', prompt: 'OLD', status: 'done', image: null, imagePath: null, data: 'data:image/png;base64,XXX' },
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

  it('순수 생성실패(error, 이미지는 옛 done 그대로) 씬을 baseline 으로 되돌리면 done 복원 + 잔여 error 클리어', () => {
    // 재생성이 아예 실패하면 이미지는 여전히 donePrompt 산물이다 — 되돌림은 정당한 done 복귀이고,
    // 이때 옛 에러 메시지가 남아 있으면 done 인데 에러 배지가 뜨는 모순 상태가 된다.
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{
        id: 's1', prompt: 'P2', status: 'error', error: 'Quota exceeded', errorKind: 'quota',
        image: 'data:img', donePrompt: 'P1',
      }])
    })
    act(() => { result.current.updateScene('s1', { prompt: 'P1' }) })
    expect(result.current.scenes[0]).toMatchObject({ status: 'done', error: null, errorKind: null })
  })

  it('저장 실패(error, 새 이미지 + donePrompt:null 클리어됨) 씬은 되돌려도 done 으로 오복원하지 않음', () => {
    // 폴더 저장 실패 패치는 NEW 이미지를 메모리에 남기고 donePrompt 를 null 로 클리어한다 —
    // 이 상태에서 옛 프롬프트로 되돌려도 화면 이미지는 새 프롬프트 산물이므로 done 이 되면 안 된다.
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{
        id: 's1', prompt: 'P2', status: 'error', error: 'Image save failed: Disk full',
        image: 'data:new-img', donePrompt: null,
      }])
    })
    act(() => { result.current.updateScene('s1', { prompt: 'P1' }) })
    expect(result.current.scenes[0].status).toBe('pending')
  })
})
