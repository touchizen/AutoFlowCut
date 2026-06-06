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

// mentionParser 와 동일 regex — 단어 경계 + 이메일 제외 + Hangul.
const MENTION_RE = /(^|[\s.,!?;:()\[\]{}'"`])@([A-Za-z0-9_\-가-힣]+)/g

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

/**
 * 한 줄의 plain text 를 nodes 배열로 변환. `@name` 토큰 중 references 에
 * 매칭되는 것만 BeautifulMentionNode 로, 나머지는 TextNode 로.
 *
 * @param {string} line
 * @param {Map<string, object>} refByLowerName - lowercase name → ref object
 * @returns {Array<import('lexical').LexicalNode>}
 */
function buildNodesForLine(line, refByLowerName) {
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
    const ref = refByLowerName.get(name.toLowerCase())
    if (ref) {
      nodes.push($createBeautifulMentionNode('@', ref.name, refDataPayload(ref)))
    } else {
      // 매칭 안 되는 @xxx 는 plain text 로 — 사용자가 typo 인지 보이도록.
      nodes.push($createTextNode(`@${name}`))
    }
    lastIdx = mentionStart + 1 + name.length
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
