/**
 * mentionLiveTransform — Lexical node transform 함수의 단일 source.
 *
 * PromptInput 의 MentionLiveTransformPlugin 과 회귀 테스트가 같이 import 해서 사용한다.
 * 분리 이전엔 테스트가 transform 로직을 복사해서 갖고 있었는데, production 만 바뀌면
 * 테스트가 옛 로직을 검증해서 회귀를 놓칠 위험이 있었다.
 *
 * Lexical 의 registerNodeTransform 은 정확한 klass 매칭이라 subclass 발화 안 한다 —
 * 그래서 TextNode + UnknownMentionTextNode 양쪽에 같은 함수를 등록해야 cleanup 이
 * 양방향 모두 동작 (회귀 lock: tests/components/mentionTransform.test.js).
 */

import {
  TextNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import { $isBeautifulMentionNode } from 'lexical-beautiful-mentions'
import { UnknownMentionTextNode } from './UnknownMentionTextNode'
import { buildNodesForLine, buildRefLookup } from '../utils/promptLexicalAdapter'
import { iterateMentions, MENTION_LEAD_CHAR_RE } from '../utils/mentionParser'

/**
 * Node transform 함수 생성기.
 *
 * @param {() => Array} getRefs - 현재 references 를 반환하는 게터 (ref 갱신을 capture)
 * @returns {(node: import('lexical').LexicalNode) => void}
 */
export function createMentionTransformFn(getRefs) {
  return (node) => {
    // BeautifulMentionNode 는 DecoratorNode 라 여기 안 들어옴.
    // UnknownMentionTextNode 는 별도 등록(registerMentionLiveTransforms) 으로 같은 함수가 호출됨.
    const text = node.getTextContent()

    // 1) `@` 자체가 없으면 정리만 (UnknownMentionTextNode 였는데 `@` 지워진 경우).
    if (!text.includes('@')) {
      if (node instanceof UnknownMentionTextNode) {
        const plain = $createTextNode(text)
        node.replace(plain)
      }
      return
    }

    // 2) 커서가 이 노드 안의 `@xxx` 영역에 있으면 skip — 타이핑 중.
    const selection = $getSelection()
    if (
      $isRangeSelection(selection) &&
      selection.isCollapsed() &&
      selection.anchor.key === node.getKey()
    ) {
      const cursorOffset = selection.anchor.offset
      for (const { index: mStart, tokenLength } of iterateMentions(text)) {
        const mEnd = mStart + tokenLength
        if (cursorOffset >= mStart && cursorOffset <= mEnd) return
      }
      // 아직 `}`를 입력하지 않은 brace mention도 현재 cursor가 그 안에 있으면 변환을 미룬다.
      const beforeCursor = text.slice(0, cursorOffset)
      const openIndex = beforeCursor.lastIndexOf('@{')
      const openHasValidLead = openIndex === 0 || MENTION_LEAD_CHAR_RE.test(text[openIndex - 1])
      const unclosedTail = openIndex >= 0 ? beforeCursor.slice(openIndex + 2) : ''
      if (
        openIndex >= 0 && openHasValidLead &&
        !unclosedTail.includes('}') && !unclosedTail.includes('\n')
      ) return
    }

    // 3) 적절한 node 들로 재구성. 결과가 현재 노드와 동일 형태면 skip (idempotent).
    const newNodes = buildNodesForLine(text, buildRefLookup(getRefs()))
    if (newNodes.length === 1) {
      const single = newNodes[0]
      const sameKind =
        single instanceof UnknownMentionTextNode ===
        node instanceof UnknownMentionTextNode
      const isChip = $isBeautifulMentionNode(single)
      // 단일 결과가 chip 이면 항상 다른 형태 — 교체.
      if (!isChip && sameKind && single.getTextContent() === text) return
    }

    // 4) 교체 — original 앞에 새 노드들 insert 후 original remove.
    for (const newNode of newNodes) {
      node.insertBefore(newNode)
    }
    node.remove()
  }
}

/**
 * TextNode 와 UnknownMentionTextNode 양쪽에 transform 등록 + 두 unsubscribe 묶음 반환.
 * Lexical 의 registerNodeTransform 은 정확한 klass 매칭이라 subclass 안 잡음 — 양쪽 필수.
 *
 * @param {import('lexical').LexicalEditor} editor
 * @param {() => Array} getRefs
 * @returns {() => void} 양쪽 cleanup 호출
 */
export function registerMentionLiveTransforms(editor, getRefs) {
  const transformFn = createMentionTransformFn(getRefs)
  const unregisterText = editor.registerNodeTransform(TextNode, transformFn)
  const unregisterUnknown = editor.registerNodeTransform(
    UnknownMentionTextNode,
    transformFn
  )
  return () => {
    unregisterText()
    unregisterUnknown()
  }
}
