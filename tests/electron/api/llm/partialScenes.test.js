import { describe, it, expect, vi } from 'vitest'
import { createPartialScenesParser } from '../../../../electron/api/llm/partialScenes.js'

describe('createPartialScenesParser', () => {
  it('토큰 중간에서 chunk가 갈려도 닫힌 scenes 원소를 순서대로 emit한다', () => {
    const onItem = vi.fn()
    const parser = createPartialScenesParser({ onItem })

    parser.push('{"sce')
    parser.push('nes":[{"sceneNo":1,"imagePro')
    parser.push('mpt":"IMG-1","videoPrompt":"VID-1"},{"sceneNo":2')
    expect(onItem).toHaveBeenCalledTimes(1)
    parser.push(',"imagePrompt":"IMG-2","videoPrompt":"VID-2"}]}')

    expect(onItem.mock.calls).toEqual([
      [{ sceneNo: 1, imagePrompt: 'IMG-1', videoPrompt: 'VID-1' }, 0],
      [{ sceneNo: 2, imagePrompt: 'IMG-2', videoPrompt: 'VID-2' }, 1],
    ])
  })

  it('문자열 안의 escaped quote와 중괄호·대괄호·쉼표를 구조 문자로 취급하지 않는다', () => {
    const items = []
    const parser = createPartialScenesParser({ onItem: (item) => items.push(item) })

    parser.push('{"scenes":[{"sceneNo":1,"imagePrompt":"say \\"hi\\" {now}, [ok]","videoPrompt":"pan, then tilt"},')
    parser.push('{"sceneNo":2,"imagePrompt":"next","videoPrompt":"done"}]}')

    expect(items).toEqual([
      { sceneNo: 1, imagePrompt: 'say "hi" {now}, [ok]', videoPrompt: 'pan, then tilt' },
      { sceneNo: 2, imagePrompt: 'next', videoPrompt: 'done' },
    ])
  })

  it('key/colon/array와 원소 사이의 공백을 허용한다', () => {
    const onItem = vi.fn()
    const parser = createPartialScenesParser({ onItem })

    parser.push(' { \n  "scenes" \t : \n [ \n {"sceneNo":1} \n , \t {"sceneNo":2} \n ] } ')

    expect(onItem.mock.calls).toEqual([
      [{ sceneNo: 1 }, 0],
      [{ sceneNo: 2 }, 1],
    ])
  })

  it('모든 원소가 한 chunk에 오거나 원소별 chunk로 와도 각각 한 번만 emit한다', () => {
    const allAtOnce = vi.fn()
    createPartialScenesParser({ onItem: allAtOnce }).push('{"scenes":[{"n":1},{"n":2},{"n":3}]}')
    expect(allAtOnce.mock.calls).toEqual([
      [{ n: 1 }, 0], [{ n: 2 }, 1], [{ n: 3 }, 2],
    ])

    const oneAtATime = vi.fn()
    const parser = createPartialScenesParser({ onItem: oneAtATime })
    parser.push('{"scenes":[')
    parser.push('{"n":1},')
    parser.push('{"n":2},')
    parser.push('{"n":3}')
    parser.push(']}')
    parser.push(' trailing text that must not re-emit')
    expect(oneAtATime.mock.calls).toEqual([
      [{ n: 1 }, 0], [{ n: 2 }, 1], [{ n: 3 }, 2],
    ])
  })

  it('닫힌 malformed 원소와 닫히지 않은 tail은 fail-silent로 건너뛴다', () => {
    const onItem = vi.fn()
    const parser = createPartialScenesParser({ onItem })

    expect(() => parser.push('{"scenes":[{"sceneNo":1},{"sceneNo":}, {"sceneNo":3}, {"sceneNo":4')).not.toThrow()

    expect(onItem.mock.calls).toEqual([
      [{ sceneNo: 1 }, 0],
      [{ sceneNo: 3 }, 2],
    ])
  })

  it('top-level 문자열 값 속 가짜 key는 무시하고 지정한 arrayKey를 찾는다', () => {
    const onItem = vi.fn()
    const parser = createPartialScenesParser({ arrayKey: 'items', onItem })

    parser.push('{"note":"fake \\"items\\":[{bad}] text","scenes":[{"wrong":true}],"items":[{"ok":1}]}')

    expect(onItem).toHaveBeenCalledOnce()
    expect(onItem).toHaveBeenCalledWith({ ok: 1 }, 0)
  })
})
