/**
 * useScenes — review R5 fix
 *
 * parseFromCSV 새 형식 재import 가 CSV 의 scene 번호 (stable key) 로 매칭.
 * 인덱스 기반은 reorder/insert 에 취약 (이미지가 엉뚱한 prompt 에 붙음).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R5 — parseFromCSV 새 형식 sceneNum 기반 merge', () => {
  it('CSV 에서 앞에 새 씬 삽입 시 기존 image 가 sceneNum 따라감', () => {
    const v1 = `scene,prompt,subtitle\n1,"A","sa"\n2,"B","sb"`
    const v2 = `scene,prompt,subtitle\n0,"NEW_AT_TOP","sn"\n1,"A","sa"\n2,"B","sb"`

    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(v1) })
    const idsV1 = result.current.scenes.map(s => s.id)
    act(() => {
      result.current.updateScene(idsV1[0], { image: 'img-A', mediaId: 'mid-A' })
      result.current.updateScene(idsV1[1], { image: 'img-B', mediaId: 'mid-B' })
    })

    // v2 로 재import — scene 0 이 앞에 삽입됨
    act(() => { result.current.parseFromCSV(v2) })
    expect(result.current.scenes).toHaveLength(3)

    // scene=1 (A) 은 여전히 img-A 가져야 함 (index 라면 NEW_AT_TOP 에 붙음)
    const sceneA = result.current.scenes.find(s => s.prompt === 'A')
    expect(sceneA).toBeTruthy()
    expect(sceneA.image).toBe('img-A')
    expect(sceneA.mediaId).toBe('mid-A')

    // scene=2 (B) 도 img-B
    const sceneB = result.current.scenes.find(s => s.prompt === 'B')
    expect(sceneB.image).toBe('img-B')

    // 새 scene=0 (NEW_AT_TOP) 은 image 없음
    const sceneNew = result.current.scenes.find(s => s.prompt === 'NEW_AT_TOP')
    expect(sceneNew.image).toBeNull()
  })

  it('CSV scene 번호 reorder 해도 stable key 매칭', () => {
    const v1 = `scene,prompt,subtitle\n1,"A","sa"\n2,"B","sb"\n3,"C","sc"`
    const v2 = `scene,prompt,subtitle\n3,"C","sc"\n1,"A","sa"\n2,"B","sb"` // 순서만 바뀜

    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(v1) })
    const idsV1 = result.current.scenes.map(s => s.id)
    act(() => {
      result.current.updateScene(idsV1[0], { image: 'imgA' })
      result.current.updateScene(idsV1[1], { image: 'imgB' })
      result.current.updateScene(idsV1[2], { image: 'imgC' })
    })

    act(() => { result.current.parseFromCSV(v2) })
    const byPrompt = new Map(result.current.scenes.map(s => [s.prompt, s]))
    expect(byPrompt.get('A').image).toBe('imgA')
    expect(byPrompt.get('B').image).toBe('imgB')
    expect(byPrompt.get('C').image).toBe('imgC')
  })

  it('첫 import 인 경우 (prev 비어있음) index 기반 그대로 동작', () => {
    const csv = `scene,prompt,subtitle\n1,"A","sa"\n2,"B","sb"`
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(csv) })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].prompt).toBe('A')
    expect(result.current.scenes[1].prompt).toBe('B')
  })
})
