/**
 * MentionLiveTransformPlugin 등가 동작의 headless 검증.
 *
 * 회귀 가드: Lexical 의 registerNodeTransform 은 정확한 klass 매칭이라 subclass
 * 발화 안 함 — TextNode 만 등록하면 UnknownMentionTextNode 가 ghost ↔ hero 처럼
 * 고쳐졌을 때 cleanup 이 안 돈다. 양쪽 klass 에 같은 transform 등록 필요.
 *
 * 이 테스트는 PromptInput.jsx 의 transform 함수와 동일한 로직을 headless editor
 * 에서 돌려 검증한다 (UI 마운트 없이).
 */

import { describe, it, expect } from 'vitest'
import {
  createEditor,
  TextNode,
  $createTextNode,
  $createParagraphNode,
  $getRoot,
} from 'lexical'
import {
  BeautifulMentionNode,
  $isBeautifulMentionNode,
} from 'lexical-beautiful-mentions'
import {
  UnknownMentionTextNode,
  $createUnknownMentionTextNode,
} from '../../src/components/UnknownMentionTextNode'
// 핵심: production 과 같은 transform factory 를 import — drift 방지.
import {
  createMentionTransformFn,
  registerMentionLiveTransforms,
} from '../../src/components/mentionLiveTransform'

function makeEditor(refs) {
  const editor = createEditor({
    namespace: 'test',
    nodes: [BeautifulMentionNode, UnknownMentionTextNode],
    onError: (e) => {
      throw e
    },
  })
  registerMentionLiveTransforms(editor, () => refs)
  return editor
}

function readParagraphChildren(editor) {
  return editor.getEditorState().read(() => {
    const para = $getRoot().getFirstChild()
    return para.getChildren().map((n) => ({
      type:
        n instanceof UnknownMentionTextNode
          ? 'unknown'
          : $isBeautifulMentionNode(n)
          ? 'chip'
          : 'text',
      content: $isBeautifulMentionNode(n)
        ? `${n.getTrigger()}${n.getValue()}`
        : n.getTextContent(),
    }))
  })
}

const REFS = [
  { id: 1, name: 'hero', type: 'character' },
  { id: 2, name: 'alice', type: 'character' },
]

describe('Mention live transform — Korean particle split', () => {
  it('plain TextNode `@queen이` becomes Queen chip plus particle text', () => {
    const editor = makeEditor([{ id: 1, name: 'Queen', type: 'character' }])
    editor.update(
      () => {
        const para = $createParagraphNode()
        para.append($createTextNode('@queen이 방에 들어간다'))
        $getRoot().append(para)
      },
      { discrete: true }
    )

    expect(readParagraphChildren(editor)).toEqual([
      { type: 'chip', content: '@Queen' },
      { type: 'text', content: '이 방에 들어간다' },
    ])
  })

  it('plain TextNode with Hangul mention name becomes chip plus particle text', () => {
    const editor = makeEditor([{ id: 1, name: '철수', type: 'character' }])
    editor.update(
      () => {
        const para = $createParagraphNode()
        para.append($createTextNode('@철수가 간다'))
        $getRoot().append(para)
      },
      { discrete: true }
    )

    expect(readParagraphChildren(editor)).toEqual([
      { type: 'chip', content: '@철수' },
      { type: 'text', content: '가 간다' },
    ])
  })
})

describe('Mention live transform — subclass cleanup', () => {
  it('UnknownMentionTextNode `@ghost` stays as-is on update if still unknown', () => {
    const editor = makeEditor(REFS)
    editor.update(
      () => {
        const para = $createParagraphNode()
        para.append($createUnknownMentionTextNode('@ghost'))
        $getRoot().append(para)
      },
      { discrete: true }
    )
    expect(readParagraphChildren(editor)).toEqual([{ type: 'unknown', content: '@ghost' }])
  })

  it('UnknownMentionTextNode `@ghost` → text edited to `@hero` (known) → becomes chip', () => {
    const editor = makeEditor(REFS)
    editor.update(
      () => {
        const para = $createParagraphNode()
        para.append($createUnknownMentionTextNode('@ghost'))
        $getRoot().append(para)
      },
      { discrete: true }
    )
    // 사용자가 노드 내용을 `@hero` 로 고침 (replace 시뮬레이션)
    editor.update(
      () => {
        const node = $getRoot().getFirstChild().getFirstChild()
        node.setTextContent('@hero')
      },
      { discrete: true }
    )
    const children = readParagraphChildren(editor)
    expect(children).toEqual([{ type: 'chip', content: '@hero' }])
  })

  it('UnknownMentionTextNode `@ghost` → `@` 제거 → plain TextNode 로 정리', () => {
    const editor = makeEditor(REFS)
    editor.update(
      () => {
        const para = $createParagraphNode()
        para.append($createUnknownMentionTextNode('@ghost'))
        $getRoot().append(para)
      },
      { discrete: true }
    )
    editor.update(
      () => {
        const node = $getRoot().getFirstChild().getFirstChild()
        node.setTextContent('ghost')
      },
      { discrete: true }
    )
    expect(readParagraphChildren(editor)).toEqual([{ type: 'text', content: 'ghost' }])
  })

  it('plain TextNode `@ghost` (unknown) gets converted to UnknownMentionTextNode', () => {
    const editor = makeEditor(REFS)
    editor.update(
      () => {
        const para = $createParagraphNode()
        para.append($createTextNode('@ghost'))
        $getRoot().append(para)
      },
      { discrete: true }
    )
    const children = readParagraphChildren(editor)
    expect(children).toEqual([{ type: 'unknown', content: '@ghost' }])
  })
})

describe('Mention live transform — braced cursor guard', () => {
  it('keeps a resolved braced token as text while the cursor is near its closing brace', () => {
    const editor = makeEditor([{ id: 3, name: '도둑 우두머리', type: 'character' }])
    editor.update(
      () => {
        const para = $createParagraphNode()
        const node = $createTextNode('@{도둑 우두머리}')
        para.append(node)
        $getRoot().append(para)
        node.select(9, 9)
      },
      { discrete: true }
    )

    expect(readParagraphChildren(editor)).toEqual([
      { type: 'text', content: '@{도둑 우두머리}' },
    ])
  })

  it('treats an unclosed braced token under the cursor as typing in progress', () => {
    const editor = makeEditor(REFS)
    editor.update(
      () => {
        const para = $createParagraphNode()
        const node = $createUnknownMentionTextNode('@{도둑 우두')
        para.append(node)
        $getRoot().append(para)
        node.select(node.getTextContentSize(), node.getTextContentSize())
      },
      { discrete: true }
    )

    expect(readParagraphChildren(editor)).toEqual([
      { type: 'unknown', content: '@{도둑 우두' },
    ])
  })
})

describe('Lexical transform behavior — regression guard', () => {
  // 회귀 lock: TextNode 만 등록하면 subclass(UnknownMentionTextNode) 에 발화 안 됨.
  // PromptInput 이 양쪽 등록을 빠뜨리면 cleanup 회귀가 다시 들어와도 이 테스트가 잡는다.
  it('registerNodeTransform(TextNode) 만으로는 UnknownMentionTextNode 변경에 발화하지 않음', () => {
    const editor = createEditor({
      namespace: 'test',
      nodes: [BeautifulMentionNode, UnknownMentionTextNode],
      onError: (e) => {
        throw e
      },
    })
    // 의도적으로 한쪽만 등록 — production 의 registerMentionLiveTransforms 가 양쪽 모두
    // 등록한다는 invariant 를 깨면 어떻게 되는지 시각화.
    const transformFn = createMentionTransformFn(() => REFS)
    editor.registerNodeTransform(TextNode, transformFn)

    editor.update(
      () => {
        const para = $createParagraphNode()
        para.append($createUnknownMentionTextNode('@ghost'))
        $getRoot().append(para)
      },
      { discrete: true }
    )
    // 그 다음 @ 제거 — TextNode subclass 라 transform 이 안 돌아 cleanup 누락 기대
    editor.update(
      () => {
        const node = $getRoot().getFirstChild().getFirstChild()
        node.setTextContent('ghost')
      },
      { discrete: true }
    )
    const children = readParagraphChildren(editor)
    // 회귀 시그널 — UnknownMentionTextNode 가 그대로 남음 (cleanup 안 됨)
    expect(children).toEqual([{ type: 'unknown', content: 'ghost' }])
  })
})
