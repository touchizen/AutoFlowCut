# StoryView 폼/대본 영역 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Story 대본 스텝의 입력 폼(제목 full-width + 옵션 행, 모델/길이 선택)과 대본 표시·편집 영역(PromptInput 재사용, 줄 수+문자 수)을 개선한다.

**Architecture:** `buildScriptPrompt`에 길이 단위(min/chars/words) 지시를 넣고, `PromptInput`을 `disableMentions`/`showCharCount` prop으로 매개변수화(기본값은 기존 동작 불변), `StoryView` 폼을 제목 행/옵션 행으로 재구성하고 모델·길이 상태를 `options`로 전달하며, 대본 편집 영역을 PromptInput으로 교체한다.

**Tech Stack:** React, Lexical(PromptInput), Vitest + @testing-library/react.

## Global Constraints

- 모델: `Opus 4.8`=`claude-opus-4-8`(기본), `Sonnet 5`=`claude-sonnet-5`. `llmClaude` 기본은 이미 opus.
- 길이 단위 내부값: `min`/`chars`/`words`. 표시 라벨 ko `분`/`자`, en `min`/`words`. 단위 옵션은 `language==='en'`이면 min/words, 아니면 min/chars. 기본 값 `10`, 단위 `min`. 자동 환산 없음.
- PromptInput 신규 prop 기본값은 `false` — 기존 사용처(이미지 프롬프트 등) 동작·테스트 불변.
- 생성 중(`isRunning`)은 기존 스트리밍 div 유지(PromptInput은 완성/편집만).
- TDD(vitest). 테스트는 `tests/`가 `src/`·`electron/`을 미러링. 단일 실행 `npx vitest run <path>`.
- 브랜치 `feature/story-pipeline` 그대로.

---

### Task 1: buildScriptPrompt 길이 단위 지시

**Files:**
- Modify: `electron/api/llm/prompts.js` (buildScriptPrompt)
- Test: `tests/electron/api/llm/prompts.test.js`

**Interfaces:**
- Produces: `buildScriptPrompt(input, opts)` — `opts.lengthValue`(number|string), `opts.lengthUnit`('min'|'chars'|'words')로 길이 지시 생성. `opts.targetMinutes`는 더 이상 사용 안 함.

- [ ] **Step 1: 기존 테스트 수정 + 실패 테스트 추가**

`tests/electron/api/llm/prompts.test.js`의 첫 테스트(현재 `targetMinutes: 8` → `8분`)를 아래로 교체하고 단위 케이스를 추가:
```js
describe('buildScriptPrompt 길이 단위', () => {
  it('min 단위는 "약 N분"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 8, lengthUnit: 'min', language: 'ko', genre: 'yadam' })
    expect(p).toContain('약 8분')
    expect(p).toContain('제목: T')
  })
  it('chars 단위는 "약 N자"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 6000, lengthUnit: 'chars', language: 'ko' })
    expect(p).toContain('약 6000자')
  })
  it('words 단위는 "about N words"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 1500, lengthUnit: 'words', language: 'en' })
    expect(p).toContain('about 1500 words')
  })
  it('길이 미지정 시 기본 10분', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko' })
    expect(p).toContain('약 10분')
  })
})
```
(주의: 이 파일의 기존 `buildScriptPrompt` 관련 다른 테스트 — metaPrompt 슬롯/제목 채움 — 는 `targetMinutes`를 쓰지 않으면 그대로 두고, `targetMinutes`/`8분`을 검증하던 케이스만 위로 대체.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/prompts.test.js`
Expected: FAIL (아직 targetMinutes 기반, `약 8분` 미포함 / words 미포함).

- [ ] **Step 3: 구현**

`electron/api/llm/prompts.js`의 `buildScriptPrompt`에서 길이 문구 생성부를 교체:
```js
export function buildScriptPrompt(input, opts) {
  const meta = opts.metaPrompt ? `## CUSTOM INSTRUCTIONS\n${opts.metaPrompt}\n` : ''
  const n = opts.lengthValue || 10
  const unit = opts.lengthUnit || 'min'
  const lengthText =
    unit === 'chars' ? `약 ${n}자` :
    unit === 'words' ? `about ${n} words` :
    `약 ${n}분`
  return [
    meta,
    `당신은 유튜브 스토리 채널 작가다. 아래 제목으로 ${lengthText} 분량의 나레이션 대본을 ${opts.language === 'ko' ? '한국어' : '영어'}로 작성하라.`,
    opts.genre ? `장르: ${opts.genre}` : '',
    opts.tone ? `톤: ${opts.tone}` : '',
    `제목: ${input.title}`,
    `마크다운으로, 챕터 구분과 (대사가 있으면) 화자 표기를 포함하라.`,
  ].filter(Boolean).join('\n')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/prompts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/llm/prompts.js tests/electron/api/llm/prompts.test.js
git commit -m "feat(story): buildScriptPrompt 길이 단위(min/chars/words) 지시"
```

---

### Task 2: PromptInput 매개변수화 (disableMentions / showCharCount)

**Files:**
- Modify: `src/components/PromptInput.jsx`
- Test: `tests/components/PromptInput.storymode.test.jsx`

**Interfaces:**
- Consumes: 없음(자체 컴포넌트).
- Produces: `<PromptInput disableMentions showCharCount />` — `disableMentions=true`면 `@`가 chip/빨간줄이 되지 않고 plain text, `showCharCount=true`면 footer에 문자 수 표시. 두 prop 기본 `false`(기존 동작).

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/PromptInput.storymode.test.jsx`:
```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PromptInput from '../../src/components/PromptInput.jsx'
import { I18nProvider } from '../../src/hooks/useI18n'

function renderPI(props) {
  return render(<I18nProvider><PromptInput value={props.value ?? ''} onChange={() => {}} {...props} /></I18nProvider>)
}

describe('PromptInput story mode', () => {
  it('showCharCount=true면 문자 수를 표시한다', () => {
    renderPI({ value: '가나다', showCharCount: true })
    expect(screen.getByTestId('char-count')).toHaveTextContent('3')
  })
  it('showCharCount=false(기본)면 문자 수 미표시', () => {
    renderPI({ value: '가나다' })
    expect(screen.queryByTestId('char-count')).toBeNull()
  })
  it('disableMentions=true면 미해결 @가 빨간 unknown-mention 노드가 되지 않는다', () => {
    const { container } = renderPI({ value: '@ghost 이야기', disableMentions: true, references: [] })
    // UnknownMentionTextNode는 특정 클래스로 렌더된다 — disableMentions면 없어야 함
    expect(container.querySelector('.unknown-mention')).toBeNull()
  })
})
```
(주의: `UnknownMentionTextNode`가 실제로 부여하는 className을 `src/components/UnknownMentionTextNode.js`에서 확인해 위 셀렉터를 맞출 것. char-count는 신규 `data-testid="char-count"`.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/PromptInput.storymode.test.jsx`
Expected: FAIL (prop 미지원 / char-count 없음).

- [ ] **Step 3: 구현 — prop 추가 + 조건부 멘션/문자수**

`src/components/PromptInput.jsx`:
- 함수 시그니처에 `disableMentions = false, showCharCount = false` 추가.
- 멘션 플러그인 2개를 조건부 렌더:
```jsx
{!disableMentions && <MentionLiveTransformPlugin references={references} />}
```
```jsx
{!disableMentions && (
  <BeautifulMentionsPlugin
    items={mentionItems}
    triggers={['@']}
    menuComponent={MentionMenu}
    menuItemComponent={MentionMenuItem}
    allowSpaces={false}
    insertOnBlur={false}
    creatable={false}
    autoSpace={false}
    menuItemLimit={false}
    preTriggerChars={MENTION_PRE_TRIGGER_CHARS}
    punctuation={MENTION_PUNCTUATION}
  />
)}
```
- `SyncPlugin`에 `disableMentions` 전달하고, `$applyTextToRoot` 호출을 disableMentions면 plain 적용으로 분기. `SyncPlugin({ value, onChange, references, disableMentions })`로 prop 추가 후, 내부 `$applyTextToRoot(incoming, ...)` 호출을 `disableMentions ? $applyTextToRoot(incoming, []) : $applyTextToRoot(incoming, referencesRef.current)`처럼 references를 빈 배열로 넘겨도 unknown 노드가 생기므로 — **`$applyTextToRoot`에 plain 옵션이 필요**하다. `src/utils/promptLexicalAdapter.js`의 `$applyTextToRoot(text, references = [], { plain = false } = {})`로 확장하고, `buildNodesForLine`이 `plain`이면 UnknownMentionTextNode 대신 일반 TextNode로 처리하도록 분기(멘션 매칭 자체를 건너뛰고 라인을 단일 텍스트로). SyncPlugin은 `$applyTextToRoot(incoming, refs, { plain: disableMentions })` 호출.
- footer에 문자 수:
```jsx
<span className="line-count">{t('prompt.count', { count: lineCount })}</span>
{showCharCount && <span className="char-count" data-testid="char-count">{text.length}</span>}
```

- [ ] **Step 4: 통과 확인 + 기존 PromptInput 회귀**

Run: `npx vitest run tests/components/PromptInput.storymode.test.jsx tests/components/PromptInput.mention.test.jsx tests/components/PromptInput.glow.test.jsx`
Expected: PASS (신규 + 기존 멘션 동작 회귀 없음 — 기본값 false라 불변).

- [ ] **Step 5: Commit**

```bash
git add src/components/PromptInput.jsx src/utils/promptLexicalAdapter.js tests/components/PromptInput.storymode.test.jsx
git commit -m "feat: PromptInput disableMentions/showCharCount 매개변수화"
```

---

### Task 3: StoryView 폼 재구성 (레이아웃 + 모델 + 길이)

**Files:**
- Modify: `src/components/story/StoryView.jsx`, `src/components/story/StoryView.css`
- Test: `tests/components/story/StoryView.form.test.jsx`

**Interfaces:**
- Consumes: `pipeline.start('script', { input, options })`.
- Produces: `options`에 `{ genre, language, model, lengthValue, lengthUnit }` 포함.

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/story/StoryView.form.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

function makePipeline(start) {
  return { state: { steps: {} }, streamingText: '', start, abort: () => {}, scenes: [], openError: null }
}

describe('StoryView 폼 재구성', () => {
  it('모델 드롭다운 선택이 options.model로 전달된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'claude-sonnet-5' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ model: 'claude-sonnet-5' }),
    }))
  })
  it('길이 값+단위가 options.lengthValue/lengthUnit으로 전달된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('길이 값'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('길이 단위'), { target: { value: 'chars' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthValue: '6000', lengthUnit: 'chars' }),
    }))
  })
  it('기본 모델은 claude-opus-4-8, 기본 길이 10 min', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ model: 'claude-opus-4-8', lengthValue: '10', lengthUnit: 'min' }),
    }))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/story/StoryView.form.test.jsx`
Expected: FAIL (모델/길이 필드 없음).

- [ ] **Step 3: 구현 — state + 폼 재구성**

`src/components/story/StoryView.jsx`:
- state 추가(기존 length state 제거하고 lengthValue/lengthUnit/model로 교체):
```js
const [length, setLength] = useState('10')          // 값
const [lengthUnit, setLengthUnit] = useState('min') // 단위
const [model, setModel] = useState('claude-opus-4-8')
```
(기존 `const [length, setLength] = useState('')`가 있으면 초기값을 `'10'`으로.)
- 제목 폼(`story-title-form`) 블록을 아래로 교체:
```jsx
<div className="story-title-row">
  <input
    className="story-input story-title-input"
    placeholder={t('story.form.titlePlaceholder', '제목')}
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    disabled={isRunning}
  />
</div>
<div className="story-options-row">
  <select
    className="story-input"
    aria-label={t('story.form.genreLabel', '장르')}
    value={genre}
    onChange={(e) => setGenre(e.target.value)}
    disabled={isRunning}
  >
    <option value="">{t('story.form.genrePlaceholder', '장르')}</option>
    <option value="yadam">yadam (야담)</option>
    <option value="dark-history">dark-history</option>
    <option value="bespoke">bespoke</option>
  </select>
  <select
    className="story-input"
    aria-label={t('story.form.modelLabel', '모델')}
    value={model}
    onChange={(e) => setModel(e.target.value)}
    disabled={isRunning}
  >
    <option value="claude-opus-4-8">Opus 4.8</option>
    <option value="claude-sonnet-5">Sonnet 5</option>
  </select>
  <input
    className="story-input"
    placeholder={t('story.form.languagePlaceholder', '언어')}
    value={language}
    onChange={(e) => setLanguage(e.target.value)}
    disabled={isRunning}
  />
  <input
    className="story-input story-length-value"
    aria-label={t('story.form.lengthValueLabel', '길이 값')}
    placeholder={t('story.form.lengthPlaceholder', '길이')}
    value={length}
    onChange={(e) => setLength(e.target.value)}
    disabled={isRunning}
  />
  <select
    className="story-input story-length-unit"
    aria-label={t('story.form.lengthUnitLabel', '길이 단위')}
    value={lengthUnit}
    onChange={(e) => setLengthUnit(e.target.value)}
    disabled={isRunning}
  >
    <option value="min">{language === 'en' ? 'min' : '분'}</option>
    <option value={language === 'en' ? 'words' : 'chars'}>{language === 'en' ? 'words' : '자'}</option>
  </select>
</div>
```
- `handlePrimaryAction`의 script 분기 options를 교체:
```js
start('script', {
  input: { type: 'title', title },
  options: { genre: genre || undefined, language, model, lengthValue: length, lengthUnit },
})
```
- `handlePasteStart`도 model 포함:
```js
const handlePasteStart = () => {
  start('script', { pastedScript, options: { language, model } })
}
```

- [ ] **Step 4: CSS 추가**

`src/components/story/StoryView.css` — `.story-title-form` 규칙을 아래로 교체/추가:
```css
.story-title-row {
  display: flex;
}
.story-title-input {
  flex: 1 1 100%;
}
.story-options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.story-length-value { flex: 0 1 90px; }
.story-length-unit { flex: 0 1 90px; }
```

- [ ] **Step 5: 통과 확인 + StoryView 회귀**

Run: `npx vitest run tests/components/story/`
Expected: PASS (신규 폼 테스트 + 기존 장르 드롭다운 등 회귀). 기존 StoryView 테스트가 옛 length placeholder를 참조하면 새 라벨에 맞게 수정.

- [ ] **Step 6: Commit**

```bash
git add src/components/story/StoryView.jsx src/components/story/StoryView.css tests/components/story/StoryView.form.test.jsx
git commit -m "feat(story): 폼 재구성 — 제목 full-width + 모델/길이 옵션 행"
```

---

### Task 4: 대본 표시·편집 PromptInput 통합

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Test: `tests/components/story/StoryView.script.test.jsx`

**Interfaces:**
- Consumes: `PromptInput`(disableMentions/showCharCount), `pipeline.streamingText`, `isRunning`.

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/story/StoryView.script.test.jsx`:
```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

function pipelineWith(overrides) {
  return { state: { steps: {} }, streamingText: '', start: () => {}, abort: () => {}, scenes: [], openError: null, ...overrides }
}

describe('StoryView 대본 영역', () => {
  it('생성 중이 아니면 대본 편집을 PromptInput으로 렌더한다', () => {
    render(<StoryView pipeline={pipelineWith({ streamingText: '대본 본문' })} />)
    // PromptInput은 data-testid="prompt-textarea-wrap"를 렌더
    expect(screen.getByTestId('prompt-textarea-wrap')).toBeInTheDocument()
  })
  it('생성 중이면 스트리밍 div를 렌더한다(PromptInput 아님)', () => {
    const pipeline = pipelineWith({ state: { steps: { script: { status: 'running' } } }, streamingText: '생성중' })
    const { container } = render(<StoryView pipeline={pipeline} />)
    expect(container.querySelector('.story-script-stream')).toBeInTheDocument()
    expect(screen.queryByTestId('prompt-textarea-wrap')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/story/StoryView.script.test.jsx`
Expected: FAIL (아직 textarea, PromptInput 미사용).

- [ ] **Step 3: 구현 — textarea → PromptInput**

`src/components/story/StoryView.jsx`:
- 상단 import 추가: `import PromptInput from '../PromptInput'`
- 대본 영역 분기(현재 `isRunning ? story-script-stream : story-script-textarea`)에서 `!isRunning` 쪽 `<textarea className="story-script-textarea" .../>`를 교체:
```jsx
{isRunning ? (
  <div className="story-script-stream" aria-live="polite">{streamingText}</div>
) : (
  <div className="story-script-editor">
    <PromptInput
      value={scriptDraft || streamingText}
      onChange={setScriptDraft}
      references={[]}
      disableMentions
      showCharCount
      placeholder={t('story.form.scriptPlaceholder', '대본이 여기에 표시됩니다')}
    />
  </div>
)}
```

- [ ] **Step 4: CSS — 편집 영역 높이**

`src/components/story/StoryView.css`에 추가:
```css
.story-script-editor {
  flex: 1;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 5: 통과 확인 + 회귀**

Run: `npx vitest run tests/components/story/`
Expected: PASS. 기존 StoryView 테스트가 `story-script-textarea`를 참조하면 새 구조에 맞게 수정.

- [ ] **Step 6: Commit**

```bash
git add src/components/story/StoryView.jsx src/components/story/StoryView.css tests/components/story/StoryView.script.test.jsx
git commit -m "feat(story): 대본 편집 영역을 PromptInput으로(줄 수+문자 수)"
```

---

## Self-Review (작성자 확인)

- **Spec 커버리지**: 레이아웃(T3 CSS) / 모델 드롭다운(T3) / 길이 값+단위(T3 + prompts T1) / PromptInput 재사용·매개변수화(T2, T4). 스펙 §1~4 전부 매핑.
- **타입 일관성**: `options.model`/`lengthValue`/`lengthUnit`가 T3(전달)·T1(소비 buildScriptPrompt)에서 동일. `disableMentions`/`showCharCount`가 T2(정의)·T4(사용) 동일.
- **비목표 준수**: Codex 엔진·칸 통합·자동 환산 없음.
- **회귀 주의**: PromptInput prop 기본 false(기존 불변), 기존 StoryView/prompts 테스트 중 옛 length placeholder·targetMinutes 참조분은 각 태스크 Step에서 수정 명시.
