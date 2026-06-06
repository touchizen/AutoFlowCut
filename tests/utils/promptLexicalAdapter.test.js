/**
 * promptLexicalAdapter — text ↔ Lexical editor state 양방향 라운드트립 단위 테스트.
 *
 * createEditor 로 헤드리스 editor 인스턴스를 만들어 검증 (UI 없이 노드 트리만).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createEditor } from 'lexical'
import { BeautifulMentionNode } from 'lexical-beautiful-mentions'
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
})
