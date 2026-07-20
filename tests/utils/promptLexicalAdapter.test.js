/**
 * promptLexicalAdapter — text ↔ Lexical editor state 양방향 라운드트립 단위 테스트.
 *
 * createEditor 로 헤드리스 editor 인스턴스를 만들어 검증 (UI 없이 노드 트리만).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createEditor, $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import {
  BeautifulMentionNode,
  $createBeautifulMentionNode,
  $isBeautifulMentionNode,
} from 'lexical-beautiful-mentions'
import {
  $applyTextToRoot,
  $editorStateToText,
} from '../../src/utils/promptLexicalAdapter'
import { UnknownMentionTextNode } from '../../src/components/UnknownMentionTextNode'

// jsdom matchMedia 폴리필 (setup.js 가 적용되긴 하지만 명시)
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  }
})

const REFS = [
  { id: 1, name: 'Alice', type: 'character' },
  { id: 2, name: 'Bob', type: 'character' },
  { id: 3, name: 'forest', type: 'scene' },
]

function makeEditor() {
  return createEditor({
    namespace: 'test',
    nodes: [BeautifulMentionNode, UnknownMentionTextNode],
    onError: (e) => {
      throw e
    },
  })
}

function applyAndRead(text, refs = REFS) {
  const editor = makeEditor()
  editor.update(() => $applyTextToRoot(text, refs), { discrete: true })
  return $editorStateToText(editor.getEditorState())
}

// 노드 레벨 검사 — 한글 ref 는 대소문자가 없어 roundtrip 텍스트로 칩 여부를 구분 못 함.
// 칩(BeautifulMentionNode) 개수와 비-칩 텍스트를 직접 읽어 분리 동작을 확정.
function applyAndCount(text, refs = REFS) {
  const editor = makeEditor()
  editor.update(() => $applyTextToRoot(text, refs), { discrete: true })
  let chips = 0
  const texts = []
  editor.getEditorState().read(() => {
    $getRoot().getChildren().forEach((p) => {
      ;(p.getChildren?.() || []).forEach((n) => {
        if ($isBeautifulMentionNode(n)) chips++
        else texts.push(n.getTextContent?.() || '')
      })
    })
  })
  return { chips, text: texts.join('') }
}

function applyAndReadChildren(text, refs = REFS) {
  const editor = makeEditor()
  editor.update(() => $applyTextToRoot(text, refs), { discrete: true })
  return editor.getEditorState().read(() => (
    $getRoot().getFirstChild().getChildren().map((node) => ({
      type: node instanceof UnknownMentionTextNode
        ? 'unknown'
        : $isBeautifulMentionNode(node) ? 'chip' : 'text',
      text: node.getTextContent(),
      value: $isBeautifulMentionNode(node) ? node.getValue() : null,
    }))
  ))
}

function serializeMentionValues(values) {
  const editor = makeEditor()
  editor.update(() => {
    const paragraph = $createParagraphNode()
    $getRoot().append(paragraph)
    values.forEach((value, index) => {
      if (index > 0) paragraph.append($createTextNode(' '))
      paragraph.append($createBeautifulMentionNode('@', value))
    })
  }, { discrete: true })
  return $editorStateToText(editor.getEditorState())
}

describe('promptLexicalAdapter — roundtrip', () => {
  it('preserves plain text without mentions', () => {
    expect(applyAndRead('A wizard walks')).toBe('A wizard walks')
  })

  it('preserves multi-line paragraphs (line = scene)', () => {
    expect(applyAndRead('line one\nline two\nline three')).toBe(
      'line one\nline two\nline three'
    )
  })

  it('converts known @name to mention node and back to @Name (canonical case)', () => {
    // 입력 @alice (소문자) → 매칭 → chip 저장 ref.name='Alice' → 출력 @Alice.
    expect(applyAndRead('A wizard @alice walks')).toBe('A wizard @Alice walks')
  })

  it('keeps unknown @xxx as plain text but normalizes known to canonical case', () => {
    expect(applyAndRead('@ghost @alice')).toBe('@ghost @Alice')
  })

  it('handles empty text gracefully', () => {
    expect(applyAndRead('')).toBe('')
  })

  it('preserves mention surrounded by punctuation', () => {
    expect(applyAndRead('(@alice)!')).toBe('(@Alice)!')
  })

  it('preserves trailing newline', () => {
    expect(applyAndRead('line\n')).toBe('line\n')
  })

  it('does not match email-style @ (mid-word)', () => {
    expect(applyAndRead('user@example.com')).toBe('user@example.com')
  })

  it('matches Hangul names', () => {
    const refs = [{ id: 1, name: '캐릭터1', type: 'character' }]
    expect(applyAndRead('이야기 @캐릭터1 등장', refs)).toBe('이야기 @캐릭터1 등장')
  })

  it('round-trips a resolved braced space-name as one canonical chip', () => {
    const refs = [{ id: 4, name: '도둑 우두머리', type: 'character' }]
    expect(applyAndRead('@{도둑 우두머리}A young man', refs)).toBe(
      '@{도둑 우두머리}A young man'
    )
    expect(applyAndReadChildren('@{도둑 우두머리}', refs)).toEqual([
      { type: 'chip', text: '@도둑 우두머리', value: '도둑 우두머리' },
    ])
  })

  it('round-trips two adjacent braced chips without degrading the second to text', () => {
    const refs = [
      { id: 4, name: 'Alpha One', type: 'character' },
      { id: 5, name: 'Beta Two', type: 'character' },
    ]
    const prompt = '@{Alpha One}@{Beta Two}'

    expect(applyAndRead(prompt, refs)).toBe(prompt)
    expect(applyAndReadChildren(prompt, refs)).toEqual([
      { type: 'chip', text: '@Alpha One', value: 'Alpha One' },
      { type: 'chip', text: '@Beta Two', value: 'Beta Two' },
    ])
  })

  it('round-trips an unresolved braced space-name verbatim as UnknownMentionTextNode', () => {
    expect(applyAndRead('@{도둑 우두머리} 등장')).toBe('@{도둑 우두머리} 등장')
    expect(applyAndReadChildren('@{도둑 우두머리}', REFS)).toEqual([
      { type: 'unknown', text: '@{도둑 우두머리}', value: null },
    ])
  })

  it('does not apply Korean particle prefix resolution inside braces', () => {
    const refs = [{ id: 5, name: '철수', type: 'character' }]
    expect(applyAndReadChildren('@{철수가}', refs)).toEqual([
      { type: 'unknown', text: '@{철수가}', value: null },
    ])
  })

  it('serializes chip values with braces only when plain form is unsafe', () => {
    expect(serializeMentionValues(['Alice', '도둑 우두머리', 'Mina-style'])).toBe(
      '@Alice @{도둑 우두머리} @Mina-style'
    )
  })

  it('degrades brace-containing or multiline chip values to plain prose without an @ sigil', () => {
    expect(serializeMentionValues(['brace{name'])).toBe('brace{name')
    expect(serializeMentionValues(['line\nname'])).toBe('line\nname')
  })
})

describe('promptLexicalAdapter — 멘션 뒤 한글 조사 자동 분리 (영문 ref)', () => {
  // 영문 ref: roundtrip 의 canonical case 변환(queen→Queen)으로 칩 분리 확정.
  it('영문 멘션 + 공백없는 한글 조사 → 칩 + 조사 텍스트 분리', () => {
    const refs = [{ id: 1, name: 'Queen', type: 'character' }]
    expect(applyAndRead('@queen이 방에 들어간다', refs)).toBe('@Queen이 방에 들어간다')
  })

  it('영문 조합어는 분리 안 함 (king ref 있어도 @kingdom 보존 — 끝이 영문)', () => {
    const refs = [{ id: 1, name: 'King', type: 'character' }]
    expect(applyAndRead('@kingdom 왕국', refs)).toBe('@kingdom 왕국')
  })

  it('공백으로 띄운 기존 케이스는 그대로 (회귀)', () => {
    const refs = [{ id: 1, name: 'Queen', type: 'character' }]
    expect(applyAndRead('@queen 이 방', refs)).toBe('@Queen 이 방')
  })
})

describe('promptLexicalAdapter — 한글 ref 안전성 (노드 레벨)', () => {
  it('한글 멘션 + 조사 → 칩 + 조사 텍스트 분리', () => {
    const refs = [{ id: 1, name: '철수', type: 'character' }]
    const { chips, text } = applyAndCount('@철수가 간다', refs)
    expect(chips).toBe(1)
    expect(text).toBe('가 간다')
  })

  it('한글 ref 단독은 그대로 칩 (ref 에 있으면 안 뗌)', () => {
    const refs = [{ id: 1, name: '철수', type: 'character' }]
    const { chips, text } = applyAndCount('@철수', refs)
    expect(chips).toBe(1)
    expect(text).toBe('')
  })

  it('ref 에 매칭 안 되면 분리 안 함 (현행 unknown 유지, 칩 0)', () => {
    const refs = [{ id: 1, name: '철수', type: 'character' }]
    const { chips } = applyAndCount('@영희가 간다', refs)  // 영희 ref 없음
    expect(chips).toBe(0)
  })

  it('longest-first: 더 긴 ref 우선 (수/수민 공존 시 @수민이 → 수민)', () => {
    const refs = [
      { id: 1, name: '수', type: 'character' },
      { id: 2, name: '수민', type: 'character' },
    ]
    const { chips, text } = applyAndCount('@수민이 온다', refs)
    expect(chips).toBe(1)
    expect(text).toBe('이 온다')
  })
})
