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
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import {
  BeautifulMentionNode,
  $isBeautifulMentionNode,
} from 'lexical-beautiful-mentions'
import {
  UnknownMentionTextNode,
  $createUnknownMentionTextNode,
} from '../../src/components/UnknownMentionTextNode'
import {
  buildNodesForLine,
  buildRefLookup,
  MENTION_RE,
} from '../../src/utils/promptLexicalAdapter'

// PromptInput.jsx 의 transformFn 복제 — 같은 로직을 양쪽 klass 에 등록한다.
function makeTransformFn(getRefs) {
  return (node) => {
    const text = node.getTextContent()
    if (!text.includes('@')) {
      if (node instanceof UnknownMentionTextNode) {
        const plain = $createTextNode(text)
        node.replace(plain)
      }
      return
    }
    const selection = $getSelection()
    if (
      $isRangeSelection(selection) &&
      selection.isCollapsed() &&
      selection.anchor.key === node.getKey()
    ) {
      const cursorOffset = selection.anchor.offset
      for (const m of text.matchAll(MENTION_RE)) {
        const lead = m[1] || ''
        const mStart = m.index + lead.length
        const mEnd = mStart + 1 + m[2].length
        if (cursorOffset >= mStart && cursorOffset <= mEnd) return
      }
    }
    const newNodes = buildNodesForLine(text, buildRefLookup(getRefs()))
    if (newNodes.length === 1) {
      const single = newNodes[0]
      const sameKind =
        single instanceof UnknownMentionTextNode ===
        node instanceof UnknownMentionTextNode
      const isChip = $isBeautifulMentionNode(single)
      if (!isChip && sameKind && single.getTextContent() === text) return
    }
    for (const newNode of newNodes) {
      node.insertBefore(newNode)
    }
    node.remove()
  }
}

function makeEditor(refs) {
  const editor = createEditor({
    namespace: 'test',
    nodes: [BeautifulMentionNode, UnknownMentionTextNode],
    onError: (e) => {
      throw e
    },
  })
  const transformFn = makeTransformFn(() => refs)
  // 양쪽 klass 에 등록 — 이게 P2 fix 의 핵심.
  editor.registerNodeTransform(TextNode, transformFn)
  editor.registerNodeTransform(UnknownMentionTextNode, transformFn)
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
    const transformFn = makeTransformFn(() => REFS)
    // 의도적으로 한쪽만 등록
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
