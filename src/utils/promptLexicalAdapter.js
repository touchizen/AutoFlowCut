/**
 * promptLexicalAdapter — text(`\n` 줄 구분) ↔ Lexical editor state 양방향 변환.
 *
 * 우리 데이터 모델은 줄 = 씬 1개 (textarea 시절부터의 규약). Lexical 은 paragraph
 * tree 라서 paragraph ↔ 줄 매핑이 필요. `@name` 토큰은 BeautifulMentionNode 로
 * 변환 (단, references[]에 매칭되는 이름만 — 모르는 @xxx 는 plain text 로 두어
 * 사용자가 typo 임을 알 수 있게).
 *
 * 모든 `$` 함수는 editor.update() / editorState.read() 안에서만 호출해야 한다.
 */

import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from 'lexical'
import {
  $createBeautifulMentionNode,
  $isBeautifulMentionNode,
} from 'lexical-beautiful-mentions'
import { $createUnknownMentionTextNode } from '../components/UnknownMentionTextNode'
import { MENTION_RE } from './mentionParser'

// MENTION_RE 는 mentionParser 의 단일 source 를 re-export — 컴포넌트/테스트가 어댑터
// 경로로 import 해도 호환 (정의는 mentionParser 한 곳).
export { MENTION_RE }

/**
 * references 배열 → lowercase name lookup Map. transform / apply 양쪽에서 공유.
 */
export function buildRefLookup(references = []) {
  const map = new Map()
  for (const r of references || []) {
    if (r?.name) map.set(String(r.name).toLowerCase(), r)
  }
  return map
}

/**
 * editorState 를 `\n` 으로 합쳐진 plain text 로 직렬화.
 * paragraph = 줄, mention = `@value`, text = 그대로.
 *
 * @param {import('lexical').EditorState} editorState
 * @returns {string}
 */
export function $editorStateToText(editorState) {
  return editorState.read(() => {
    const root = $getRoot()
    const lines = root.getChildren().map((paragraph) => {
      const children = paragraph.getChildren ? paragraph.getChildren() : []
      return children
        .map((node) => {
          if ($isBeautifulMentionNode(node)) {
            return `${node.getTrigger()}${node.getValue()}`
          }
          return node.getTextContent ? node.getTextContent() : ''
        })
        .join('')
    })
    return lines.join('\n')
  })
}

const HANGUL_CHAR_RE = /[가-힣]/

/**
 * 멘션 이름을 references 와 매칭. 전체 이름 우선, 없으면 끝 글자가 한글(조사 후보)인 동안
 * 한 글자씩 떼며 가장 긴 ref 접두사를 탐색(longest-first). 영문으로 끝나면 떼지 않아
 * `@kingdom`(king ref) 같은 조합어는 보존. 한국어 조사가 공백 없이 붙은 멘션
 * (`@queen이`, `@철수가`)을 칩 + 조사 텍스트로 분리하기 위함.
 *
 * 안전장치: 전체 토큰이 ref 에 있으면 절대 안 뗀다(한글 이름 보존) — 떼기는 매칭
 * 실패 시 fallback 이며, 매칭되는 접두사가 없으면 null(현행 unknown 처리 유지).
 *
 * @param {string} name - MENTION_RE 가 잡은 멘션 이름(조사 포함 가능)
 * @param {Map<string, object>} refByLowerName
 * @returns {{ ref: object, matched: string } | null}
 */
export function resolveMentionPrefix(name, refByLowerName) {
  let cur = name
  while (cur.length > 0) {
    const ref = refByLowerName.get(cur.toLowerCase())
    if (ref) return { ref, matched: cur }
    // 끝이 한글일 때만 더 떼기 — 영문 조합어는 경계가 공백/구두점이어야 자연스러움.
    if (!HANGUL_CHAR_RE.test(cur[cur.length - 1])) break
    cur = cur.slice(0, -1)
  }
  return null
}

/**
 * 한 줄의 plain text 를 nodes 배열로 변환. `@name` 토큰 중 references 에
 * 매칭되는 것만 BeautifulMentionNode 로, 매칭 안 되는 것은 UnknownMentionTextNode
 * 로, 나머지는 일반 TextNode 로. 멘션 뒤 한글 조사는 resolveMentionPrefix 가 분리.
 *
 * 노출 — node transform (live typing 시 동기화) 에서도 동일 로직 사용.
 *
 * @param {string} line
 * @param {Map<string, object>} refByLowerName - lowercase name → ref object
 * @returns {Array<import('lexical').LexicalNode>}
 */
export function buildNodesForLine(line, refByLowerName) {
  const nodes = []
  let lastIdx = 0
  let m
  // matchAll 대신 exec — index 정확히 추적 (sticky 효과 회피용)
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(line)) !== null) {
    const lead = m[1] || ''
    const name = m[2]
    const mentionStart = m.index + lead.length
    if (mentionStart > lastIdx) {
      nodes.push($createTextNode(line.slice(lastIdx, mentionStart)))
    }
    // 전체 이름 우선, 없으면 끝 한글(조사) 떼며 ref 접두사 매칭 (@queen이 → queen 칩 + "이").
    const resolved = resolveMentionPrefix(name, refByLowerName)
    if (resolved) {
      nodes.push($createBeautifulMentionNode('@', resolved.ref.name, refDataPayload(resolved.ref)))
      // 매칭된 접두사까지만 소비 — 나머지(조사 등)는 다음 텍스트 슬라이스로 자연히 흘러간다.
      lastIdx = mentionStart + 1 + resolved.matched.length
    } else {
      // 매칭 안 되는 @xxx 는 빨간 wavy underline 이 들어가는 텍스트 노드로.
      // 일반 TextNode 로 두면 typo 가 plain text 와 구분 안 됨 (Phase A overlay 회귀 방지).
      nodes.push($createUnknownMentionTextNode(`@${name}`))
      lastIdx = mentionStart + 1 + name.length
    }
  }
  if (lastIdx < line.length) {
    nodes.push($createTextNode(line.slice(lastIdx)))
  }
  return nodes
}

/**
 * BeautifulMentionNode 의 data payload — primitive 값만 허용 (string/number/bool/null).
 * 객체나 함수는 직렬화 불가. 우리는 ref 의 id/type 정도만 넘긴다.
 * 썸네일 src 는 chip 컴포넌트가 외부 references prop 으로 조회하므로 여기서 안 넘김.
 */
function refDataPayload(ref) {
  return {
    refId: ref?.id != null ? Number(ref.id) : null,
    refType: ref?.type || null,
  }
}

/**
 * 전체 텍스트(`\n` 구분) 를 editor 의 root 에 적용. editor.update() 안에서 호출.
 *
 * @param {string} text
 * @param {Array} references
 */
export function $applyTextToRoot(text, references = []) {
  const refByLowerName = new Map()
  for (const r of references || []) {
    if (r?.name) refByLowerName.set(String(r.name).toLowerCase(), r)
  }
  const root = $getRoot()
  root.clear()
  const lines = (text || '').split('\n')
  // 빈 텍스트도 최소 한 paragraph 는 두어야 contenteditable 이 비어 있지 않게.
  if (lines.length === 0) lines.push('')
  for (const line of lines) {
    const para = $createParagraphNode()
    const nodes = buildNodesForLine(line, refByLowerName)
    for (const n of nodes) para.append(n)
    root.append(para)
  }
}
