/**
 * UnknownMentionTextNode — `@xxx` 토큰이 references 와 매칭 안 될 때 사용하는
 * TextNode 서브클래스. 시각적으로 빨간 wavy underline (.unknown-mention) 을 부여해
 * 사용자가 typo 임을 즉시 알 수 있게 한다.
 *
 * Phase A 의 highlight overlay 기능을 Lexical 노드로 복원한 것. chip 으로 만들면
 * "정상 매칭" 처럼 보이고, 일반 TextNode 면 typo 표시 자체가 사라지는데, 별도
 * 서브클래스로 createDOM 단계에서 className 만 추가해 양쪽 단점을 회피.
 */

import { TextNode } from 'lexical'

export class UnknownMentionTextNode extends TextNode {
  static getType() {
    return 'unknown-mention-text'
  }

  static clone(node) {
    return new UnknownMentionTextNode(node.__text, node.__key)
  }

  createDOM(config) {
    const dom = super.createDOM(config)
    dom.classList.add('unknown-mention')
    return dom
  }

  static importJSON(serializedNode) {
    const node = $createUnknownMentionTextNode(serializedNode.text)
    node.setFormat(serializedNode.format)
    node.setDetail(serializedNode.detail)
    node.setMode(serializedNode.mode)
    node.setStyle(serializedNode.style)
    return node
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      type: 'unknown-mention-text',
      version: 1,
    }
  }
}

export function $createUnknownMentionTextNode(text) {
  return new UnknownMentionTextNode(text)
}

export function $isUnknownMentionTextNode(node) {
  return node instanceof UnknownMentionTextNode
}
