/**
 * PromptInput Component — Lexical 기반 멘션 chip 에디터.
 *
 * Phase B: `@` 를 입력하면 references 가 드롭다운으로 뜨고, 선택 시 인라인
 * thumbnail chip 으로 삽입된다 (Google Flow 동급). chip 은 backspace 1회로
 * 통째 삭제, 텍스트 흐름과 함께 wrap, 한국어 IME 안전.
 *
 * 외부 인터페이스 (value/onChange/references/disabled/placeholder/seed*) 는
 * 기존 textarea 버전과 동일 — App.jsx 변경 없이 drop-in.
 *
 * 내부:
 *  - LexicalComposer + RichTextPlugin + HistoryPlugin
 *  - BeautifulMentionsPlugin (커스텀 menu item + chip 컴포넌트)
 *  - SyncPlugin: external value ↔ editor state 양방향 sync
 *  - PasteNormalizationPlugin: 탭 → 줄바꿈 변환 유지
 *  - EditablePlugin: disabled 토글
 *
 * 데이터 모델: paragraph = 씬 1개, BeautifulMentionNode = `@name` 토큰.
 * 직렬화 시 paragraph 는 `\n` 으로, mention 은 `@value` 로.
 */

import { useEffect, useMemo, useRef, useState, forwardRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  PASTE_COMMAND,
  COMMAND_PRIORITY_NORMAL,
  TextNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import {
  BeautifulMentionsPlugin,
  createBeautifulMentionNode,
  $isBeautifulMentionNode,
} from 'lexical-beautiful-mentions'

import { useI18n } from '../hooks/useI18n'
import {
  $applyTextToRoot,
  $editorStateToText,
  buildNodesForLine,
  buildRefLookup,
  MENTION_RE,
} from '../utils/promptLexicalAdapter'
import { MentionRefsContext } from './MentionRefsContext'
import MentionChip from './MentionChip'
import MentionMenuItem from './MentionMenuItem'
import { UnknownMentionTextNode } from './UnknownMentionTextNode'

// Mention chip 노드 클래스 — 모듈 로드 시 1회만 생성 (한 번 등록한 노드를 새 인스턴스로
// 갈아끼우면 Lexical 이 "duplicate node" 에러 냄).
const MentionNodes = createBeautifulMentionNode(MentionChip)

const baseEditorConfig = {
  namespace: 'PromptInput',
  // chip 노드 + 미해결 @xxx 의 빨간 wavy underline 용 텍스트 노드.
  nodes: [...MentionNodes, UnknownMentionTextNode],
  editorState: null, // 비어 있는 상태로 시작, SyncPlugin 이 채움
  onError(err) {
    // 개발 중 사일런트 swallow 방지 — production 도 console.error 만, 사용자에겐 노출 안 함.
    console.error('[PromptInput] Lexical error:', err)
  },
  theme: {
    paragraph: 'prompt-paragraph',
    beautifulMentions: {
      // mention chip 의 기본 className. focused 와 별개로 항상 부여됨.
      '@': 'mention-chip-base',
      '@Focused': 'mention-chip-base-focused',
    },
  },
}

// mentionParser.js 의 regex 경계 클래스와 정렬 — 이메일 등 mid-word @ 는 제외하되
// `.,!?;:()[]{}'"\``  뒤에서는 mention 메뉴 트리거. 공백은 라이브러리가 항상 허용.
//
// 주의: 라이브러리는 이 값을 `(^|\\s|${preTriggerChars})` 형태로 그대로 alternation
// 에 박는다 ([BeautifulMentionsPlugin.js:51]). 따라서 "한 글자 매칭" 의 정규식 단편
// 이어야 한다. 이전 시도(`\\.,!\\?;:...`) 는 문자 시퀀스로 해석돼서 (^|\\s|`.,!?;:...`)
// 가 되어 사실상 매칭 안 됨 — 사용자가 `,@alice` 친 순간 메뉴 안 떴다.
// 해결: 진짜 char class 로 감싸기. `[`, `]` 만 escape, 나머지는 char class 내에서 literal.
const MENTION_PRE_TRIGGER_CHARS = `[.,!?;:()\\[\\]{}'"\`]`
// 기본 punctuation 에서 `_` 만 제외 — 이름에 `_` 가 들어가는 ref 가 끊기는 것 방지
// (`@main_hero` → `@main` 으로 짤리던 버그). 다른 termination 문자는 기본값 유지.
const MENTION_PUNCTUATION = `\\.,\\*\\?\\$\\|#{}\\(\\)\\^\\[\\]\\\\/!%'"~=<>:;`

// ── 커스텀 menu wrapper — 기본 `ul` 에 클래스만 부여. portal 위치는 라이브러리가 담당.
const MentionMenu = forwardRef(function MentionMenu({ loading, ...rest }, ref) {
  return <ul ref={ref} className="mention-menu" {...rest} />
})

// ── SyncPlugin: 외부 value ↔ editor state 양방향 sync.
//   round-trip 무한루프 방지: 최근 직렬화/적용한 텍스트를 ref 로 기억하고 동일하면 skip.
//   references 는 ref 로 캡쳐 — 사용자 타이핑 중 references 가 갱신돼도 editor reset 안 되도록.
function SyncPlugin({ value, onChange, references }) {
  const [editor] = useLexicalComposerContext()
  const lastTextRef = useRef('')
  const referencesRef = useRef(references)
  useEffect(() => {
    referencesRef.current = references
  }, [references])

  // 외부 value → editor (initial + 외부 변경 시)
  useEffect(() => {
    const incoming = value || ''
    if (incoming === lastTextRef.current) return
    editor.update(() => $applyTextToRoot(incoming, referencesRef.current))
    lastTextRef.current = incoming
  }, [editor, value])

  // references 변경 → 현재 텍스트의 @멘션을 chip 으로 재해석.
  // 케이스: 프로젝트 전환 시 scenes 가 references 보다 먼저 (또는 같이) 도착하지만
  //   references 가 비어 있어 첫 적용 때 chip 매칭 못 함 → references 가 뒤늦게
  //   채워져도 value 가 같으면 위 effect 가 안 돌아 chip 이 영원히 안 생기는 버그.
  //
  // 가드:
  //   - 텍스트에 `@` 없으면 skip
  //   - editor 가 포커스 중이면 즉시 skip 하지 않고 pending 플래그를 세움 →
  //     blur 시점에 재시도. (focus 중 chip 재구성하면 cursor 가 튐, blur 무한 대기는
  //     사용자가 입력창에 머무는 동안 chip 복원 안 되는 회귀 버그.)
  const pendingRehydrateRef = useRef(false)
  useEffect(() => {
    const currentText = lastTextRef.current
    if (!currentText.includes('@')) return
    const rootEl = editor.getRootElement?.()
    const focused = rootEl && document.activeElement === rootEl
    if (focused) {
      pendingRehydrateRef.current = true
      return
    }
    editor.update(() => $applyTextToRoot(currentText, references))
    pendingRehydrateRef.current = false
  }, [editor, references])

  // blur 시점 rehydrate — 위 effect 가 focus 중이라 미뤘던 재해석을 처리.
  // references 는 ref 로 항상 최신 — 위에서 referencesRef.current 가 갱신됨.
  useEffect(() => {
    const rootEl = editor.getRootElement?.()
    if (!rootEl) return
    const handler = () => {
      if (!pendingRehydrateRef.current) return
      const currentText = lastTextRef.current
      if (!currentText.includes('@')) {
        pendingRehydrateRef.current = false
        return
      }
      editor.update(() => $applyTextToRoot(currentText, referencesRef.current))
      pendingRehydrateRef.current = false
    }
    rootEl.addEventListener('blur', handler)
    return () => rootEl.removeEventListener('blur', handler)
  }, [editor])

  // editor → 외부 onChange (사용자 타이핑 등)
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const text = $editorStateToText(editorState)
      if (text === lastTextRef.current) return
      lastTextRef.current = text
      onChange?.(text)
    })
  }, [editor, onChange])

  return null
}

// ── MentionLiveTransformPlugin: 사용자가 editor 안에서 직접 `@ghost` 같은
//   미해결 mention 을 타이핑할 때 UnknownMentionTextNode 로 갈아끼워 빨간 wavy
//   underline 이 즉시 보이게. $applyTextToRoot 는 initial / project load 시점에만
//   호출되므로 그것만으로는 live typing typo 가 plain text 로 남는 회귀가 있었다.
//
// 중요: Lexical 의 registerNodeTransform 은 정확한 klass 에만 발화하고 subclass
//   에는 발화하지 않는다 ([Lexical.dev.mjs:12599] getRegisteredNode(klass)).
//   그래서 TextNode 만 등록하면 UnknownMentionTextNode 가 ghost ↔ hero 처럼
//   고쳐졌을 때 정리 로직이 안 돌아 .unknown-mention 클래스가 남는다.
//   동일 transform 을 UnknownMentionTextNode 에도 별도 등록 — 양쪽 다 cleanup.
//
// 가드:
//   - 커서가 현재 노드 안의 `@xxx` 토큰 위에 있으면 transform skip — 사용자가 그
//     멘션을 타이핑 중일 가능성. 커서가 그 영역을 벗어나면 (스페이스, 클릭, 등)
//     다음 update 에서 transform 발화 → 변환.
//   - replacement 결과가 현재 노드와 동일 유형/텍스트면 skip — infinite loop 방지.
function MentionLiveTransformPlugin({ references }) {
  const [editor] = useLexicalComposerContext()
  const refsRef = useRef(references)
  useEffect(() => {
    refsRef.current = references
  }, [references])

  useEffect(() => {
    const transformFn = (node) => {
      // BeautifulMentionNode 는 TextNode 가 아니라 DecoratorNode 라 여기 안 들어옴.
      // UnknownMentionTextNode 는 별도 등록(아래) 으로 같은 함수가 호출됨.
      const text = node.getTextContent()

      // 1) `@` 자체가 없으면 정리만 (UnknownMentionTextNode 였는데 사용자가 `@` 지운 경우).
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
        for (const m of text.matchAll(MENTION_RE)) {
          const lead = m[1] || ''
          const mStart = m.index + lead.length
          const mEnd = mStart + 1 + m[2].length
          if (cursorOffset >= mStart && cursorOffset <= mEnd) return
        }
      }

      // 3) 적절한 node 들로 재구성. 결과가 현재 노드와 동일 형태면 skip.
      const newNodes = buildNodesForLine(text, buildRefLookup(refsRef.current))
      if (newNodes.length === 1) {
        const single = newNodes[0]
        const sameKind =
          single instanceof UnknownMentionTextNode ===
          node instanceof UnknownMentionTextNode
        const sameMention = $isBeautifulMentionNode(single)
        // 단일 결과가 chip 이면 항상 다른 형태 — 교체.
        if (!sameMention && sameKind && single.getTextContent() === text) return
      }

      // 4) 교체 — original 앞에 새 노드들 insert 후 original remove.
      for (const newNode of newNodes) {
        node.insertBefore(newNode)
      }
      node.remove()
    }

    // 양쪽 klass 에 등록 — Lexical 의 transform 은 정확한 klass 매칭이라 subclass
    // 발화 안 함. UnknownMentionTextNode 에도 등록해야 @ghost → @hero 같은 cleanup
    // 이 정상 동작.
    const unregisterText = editor.registerNodeTransform(TextNode, transformFn)
    const unregisterUnknown = editor.registerNodeTransform(
      UnknownMentionTextNode,
      transformFn
    )
    return () => {
      unregisterText()
      unregisterUnknown()
    }
  }, [editor])

  return null
}

// ── PasteNormalizationPlugin: textarea 시절 정책 유지 — 탭/CR 을 줄바꿈으로.
function PasteNormalizationPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const raw = event.clipboardData?.getData('text')
        if (!raw) return false
        const normalized = raw.replace(/\r\n?/g, '\n').replace(/\t+/g, '\n')
        if (normalized === raw) return false // 변환 없으면 기본 paste 그대로
        event.preventDefault()
        const lines = normalized.split('\n')
        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          lines.forEach((line, i) => {
            if (i > 0) selection.insertParagraph()
            if (line) selection.insertText(line)
          })
        })
        return true
      },
      COMMAND_PRIORITY_NORMAL
    )
  }, [editor])
  return null
}

// ── EditablePlugin: disabled prop 토글
function EditablePlugin({ editable }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.setEditable(editable)
  }, [editor, editable])
  return null
}

export default function PromptInput({
  value,
  onChange,
  disabled,
  placeholder,
  references = [],
  seedNo = null,
  seedLocked = false,
  onSeedChange,
  onSeedLockToggle,
  onSeedRandom,
}) {
  const { t } = useI18n()

  // 라인 카운트용 로컬 state — onChange 텍스트를 그대로 보관해 footer 의 줄 수 표시.
  const [text, setText] = useState(value || '')
  useEffect(() => {
    setText(value || '')
  }, [value])

  // intro gloss — textarea 버전과 동일 동작 (2.6s 뒤 해제).
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setIntro(false), 2600)
    return () => clearTimeout(id)
  }, [])

  // BeautifulMentionsPlugin items: references 를 `@` 트리거에 매핑.
  // 각 item 은 primitive data 만 허용 — refId/refType 만 넘기고, 썸네일은 chip 이
  // context 로 lookup.
  const mentionItems = useMemo(
    () => ({
      '@': (references || [])
        .filter((r) => r?.name)
        .map((r) => ({
          value: r.name,
          refId: r.id != null ? Number(r.id) : null,
          refType: r.type || null,
        })),
    }),
    [references]
  )

  // chip 컴포넌트에 references 전달용 context value (메모이즈).
  const refsContextValue = useMemo(() => ({ references }), [references])

  // SyncPlugin onChange — 외부 onChange + 내부 line-count state 갱신.
  const handleChange = (newText) => {
    setText(newText)
    onChange?.(newText)
  }

  // seed UI (기존 그대로)
  const handleSeedInputChange = (e) => {
    const raw = e.target.value
    if (raw === '') return onSeedChange?.(null)
    const digits = raw.replace(/[^\d]/g, '')
    if (digits === '') return onSeedChange?.(null)
    const num = parseInt(digits, 10)
    if (Number.isFinite(num)) onSeedChange?.(num)
  }

  const showSeedUI = typeof onSeedChange === 'function'
  const lineCount = text.split('\n').filter((l) => l.trim()).length

  return (
    <MentionRefsContext.Provider value={refsContextValue}>
      <div className="prompt-input-container">
        <div
          className={`prompt-textarea-wrap ${intro ? 'intro' : ''} ${disabled ? 'disabled' : ''}`}
          data-testid="prompt-textarea-wrap"
        >
          <LexicalComposer initialConfig={{ ...baseEditorConfig, editable: !disabled }}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="prompt-textarea"
                  data-testid="prompt-textarea"
                  aria-placeholder={placeholder || t('prompt.placeholder')}
                />
              }
              placeholder={
                <div className="prompt-placeholder">
                  {placeholder || t('prompt.placeholder')}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <PasteNormalizationPlugin />
            <EditablePlugin editable={!disabled} />
            <MentionLiveTransformPlugin references={references} />
            <SyncPlugin value={value} onChange={handleChange} references={references} />
            <BeautifulMentionsPlugin
              items={mentionItems}
              triggers={['@']}
              menuComponent={MentionMenu}
              menuItemComponent={MentionMenuItem}
              allowSpaces={false}
              insertOnBlur={false}
              creatable={false}
              autoSpace={false}
              // false = 전체 노출 (메뉴 컨테이너에서 자체 스크롤). 기본 5 는 ref 6+ 일 때 회귀.
              menuItemLimit={false}
              // mentionParser regex 의 boundary 클래스와 정렬 — `.,@alice` 같은 케이스도 트리거.
              preTriggerChars={MENTION_PRE_TRIGGER_CHARS}
              // 기본값에서 `_` 만 제외 — `@main_hero` 가 `@main` 으로 짤리는 버그 회피.
              punctuation={MENTION_PUNCTUATION}
            />
          </LexicalComposer>
        </div>

        <div className="prompt-input-footer">
          <span className="line-count">{t('prompt.count', { count: lineCount })}</span>

          {showSeedUI && (
            <div className="seed-control" title={t('prompt.seedTitle') || 'Seed (locked = reuse same image)'}>
              <span className="seed-label">Seed</span>
              <input
                type="text"
                inputMode="numeric"
                className="seed-input"
                value={seedNo ?? ''}
                onChange={handleSeedInputChange}
                placeholder={t('prompt.seedRandom') || 'random'}
                disabled={disabled}
                maxLength={12}
              />
              <button
                type="button"
                className="seed-btn seed-dice"
                onClick={() => onSeedRandom?.()}
                disabled={disabled}
                title={t('prompt.seedDice') || 'New random seed + lock'}
              >
                🎲
              </button>
              <button
                type="button"
                className={`seed-btn seed-lock ${seedLocked ? 'locked' : ''}`}
                onClick={() => onSeedLockToggle?.()}
                disabled={disabled}
                title={
                  seedLocked
                    ? t('prompt.seedUnlock') || 'Unlock (use random each time)'
                    : t('prompt.seedLock') || 'Lock (reuse this seed)'
                }
              >
                {seedLocked ? '🔒' : '🔓'}
              </button>
            </div>
          )}

          <span className="hint">💡 {t('prompt.tip')}</span>
        </div>
      </div>
    </MentionRefsContext.Provider>
  )
}
