# ChatGPT 자동화 스파이크 — Phase 2 (주입·제출·이미지 저장) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans 로 task 단위 실행. 스텝은 `- [ ]` 체크박스.

**Goal:** dev 단축키 `Cmd+Alt+Shift+G` 1회로 chatgpt.com 컴포저에 프롬프트를 주입→제출→**제출 후 새로 생긴** 생성 이미지를 폴링→`userData/spike-chatgpt/generated-<ts>.<ext>` 로 저장한다.

**Architecture:** Phase 1 인프라(dev 게이트·idempotent 뷰·표시/포커스·저장 헬퍼·globalShortcut) 위에 병렬 신규 모듈 3개를 얹는다. 페이지 쪽은 **상태를 읽고 쓰기만 하는 단계 함수 6종**(self-contained define+call, 단일 eval), **판정 로직(상관·수락)은 전부 main 쪽 순수 함수**에 둔다(파서 이중화 방지). main의 `runGenerateStateMachine`이 단일 120s deadline·1.5s cadence로 inject(A→B)·submit(click→Enter)·poll(2연속 같은 새 id)을 오케스트레이션한다.

**Tech Stack:** Electron 36.x (`WebContentsView`, `executeJavaScript`, `sendInputEvent`, `session.fetch`), Node fs/path, vitest(jsdom).

**스펙:** `docs/superpowers/specs/2026-07-29-chatgpt-automation-phase2-design.md` (v4, findings-0). 이 플랜은 스펙 §1~§6의 동작 요구를 커버하되, 아래 "설계 정제" 4건에서 스펙을 **의도적으로 벗어난다** — D1/D4는 API 형태, **D3는 §3-F의 제출 판정식과 §3-F 106행의 수락 규칙을 실제로 바꾸는 동작 편차**(둘 다 더 보수적인 fail-closed 방향)다. 스파이크 성공 기준(§1: 주입 → 제출 확인 → 제출 후 새 이미지 → 저장)은 그대로다.

---

## Global Constraints (스펙에서 verbatim — 모든 task에 암묵 적용)

- **플랫폼: macOS(darwin) dev 전용.** 실행 `AUTOFLOWCUT_SPIKE=1 npm run dev`. 단축키 `Cmd+Alt+Shift+G`.
- **dev 게이트(단일 권위, Phase 1 기존):** `isSpikeEnabled = (!!env.VITE_DEV_SERVER_URL || !app.isPackaged) && env.AUTOFLOWCUT_SPIKE === '1'`. G도 이 게이트 안에서만 등록.
- **CDP 절대 금지.** `executeJavaScript` / `sendInputEvent` 만. `webContents.debugger` 미사용. Phase 2엔 `capturePage`도 불필요(이미지가 인증 https라).
- **기존 Flow·API·`useGenerationEngine` 무변경.** Phase 2는 **신규 파일 3개 + `electron/ipc/spike-chatgpt.js` 확장**만. **`electron/main.js` 변경 없음**(기존 deps `app/executeInView/fs/log/getMainWindow/state/makeView/disposeView` 로 충분).
- **확정 셀렉터(Phase 1 실 DOM):** 컴포저 `#prompt-textarea`, 전송 `#composer-submit-button`(컴포저 비면 DOM에서 사라짐), 이미지 소스 `https://chatgpt.com/backend-api/estuary/content?id=…&sig=…`.
- **CDN 판정:** `CDN_RE = /^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/`. 비교 키 = `id` 쿼리 파라미터(서명 URL 전체 아님). **fail-closed**: estuary인데 `id` 없으면 후보 제외.
- **저장:** `spikeDir(app) = app.getPath('userData')/spike-chatgpt/`. **쓰기 전 `mkdirSync(dir,{recursive:true})` 필수.**
- **타이밍:** 단일 total deadline **120000ms**, 폴링 cadence **1500ms**, 연속 eval reject **3회**면 재프로브 → 안정 실패면 `stage:'context'` 조기 실패.
- **콘솔 prefix:** 페이지 로그 `[autoflowcut CGPT GEN]`(main.js console-forward 필터가 `[autoflowcut CGPT` 로 잡음), main 로그 `[spike]`.
- **게이트:** 전체 스위트 그린(`npm run test:run`) + `tests/electron/api/genai.test.js` **무수정**.
- **커밋:** 이 레포는 **git worktree**라 구현 서브에이전트는 commit 불가. **각 task의 커밋 스텝은 구현자가 스킵**하고, 변경 파일 목록만 보고한다. 커밋은 오케스트레이터(메인 루프)가 한다.

---

## 스펙 대비 설계 정제 4건 (구현자는 그대로 따를 것 — 리뷰 대상)

**D1. 상관 판정을 페이지에서 main으로 이동(파서 단일화).**
스펙 §3-B는 `__cg_baseline__` 이 `{ids}`를, `__cg_poll__(baselineIds)` 가 이미 골라진 이미지를 반환한다고 썼다. 그런데 스펙 §5는 **`pickNewCdnImage(baselineIds, imgs)` 를 순수 헬퍼로 단위 테스트**하라고 요구한다 — 이 둘을 동시에 만족하려면 같은 상관 규칙(CDN_RE·idOf·완료판정)이 **페이지 문자열과 main 헬퍼에 두 벌** 존재하게 되고, 테스트는 main 사본만 검증한다(제품은 페이지 사본을 탄다).
→ **이 플랜은 페이지 함수를 "DOM 직렬화만" 하도록 좁힌다.** `__cg_baseline__()` / `__cg_poll__()` 은 둘 다 `{ imgs: [{src, complete, w, h}] }`(문서의 **모든** `img`)만 반환하고, `CDN_RE` 매칭·`idOf`·baseline 비교·완료 판정은 **main의 `baselineIdsOf` / `pickNewCdnImage`** 한 곳에서만 한다. 함수 이름·수(6종)·수락 규칙(새 id + estuary + 로드완료 + 2연속 같은 id)은 스펙 그대로. **개수 상한(slice)을 두지 않는 것이 중요하다** — baseline 에서 잘린 estuary 이미지가 나중에 창 안으로 들어오면 "새 id"로 오인돼 stale 수락이 된다(§3-C fail-closed 취지 위반).

**D2. 하드코딩 프롬프트를 ASCII 영문으로.**
스펙 §3-E 예시는 한국어("간단한 빨간 사과 한 개, 흰 배경")지만, fallback B는 `sendInputEvent({type:'char', keyCode: ch})` 로 한 글자씩 친다 — 비-ASCII(한글) char 이벤트는 IME 경유라 신뢰할 수 없다(Flow 전례도 `@`·`\r` 같은 ASCII만 trusted 입력으로 씀). 프롬프트 내용은 스파이크 성공 판정과 무관하므로 **`SPIKE_PROMPT = 'a single red apple on a white background'`** 로 고정해 A/B 두 경로 모두 실행 가능하게 한다. (이미지 식별은 alt가 아니라 estuary id라서 UI 언어와 무관.)

**D3. 제출 판정을 `composerCleared` 단독으로 좁히고, 수락에 제출 확인을 요구한다.**
스펙 §3-F는 `submitted = composerCleared || !submitPresent`, `notSubmitted = stillHasPrompt && submitPresent` 이고, 성공 수락(§3-F 106행)은 `p && lastPollId === p.id` 뿐이다. 여기엔 두 구멍이 있다:
- 주입 직후 React 렌더 지연으로 **submit 버튼이 아직 없는데 프롬프트는 남아 있는** 상태가 실재한다. 스펙 식은 이걸 `submitted`(`!submitPresent`)로 읽어 `submittedAck` 를 세우고, `notSubmitted` 도 거짓이라 Enter fallback 도 못 가서 **120s를 폴링만 하다 끝난다.** `!submitPresent` 는 "버튼이 사라짐"과 "버튼이 아직 안 생김"을 구분하지 못한다.
- 제출이 확인되지 않았는데 새 estuary id가 2연속 안정되면(직전 대화의 늦은 렌더 등) 우리 프롬프트의 결과가 아닌 이미지를 저장한다.

→ 세 가지를 바꾼다(전부 fail-closed 방향):
```
submitted    = composerCleared === true          // "비워짐"만 제출 신호로 인정
notSubmitted = stillHasPrompt === true           // 프롬프트가 남아 있으면 제출 안 된 것(버튼 유무 무관)
수락         = (2연속 같은 새 id) && submittedAck  // 제출이 확인된 뒤에만 수락
```
중복 제출 위험은 늘지 않는다 — ChatGPT는 제출 시 컴포저를 비우므로 `stillHasPrompt` 가 참이면 제출은 발생하지 않았다. 나머지 상태(컴포저에 다른 텍스트, 컴포저 부재 등)는 `submitted` 도 `notSubmitted` 도 아닌 **불확정**으로 두고 계속 폴링한다.

**D4. `__cg_clickSubmit__` 은 클릭 전 핸들로 `clicked` 를 보고한다.**
스펙 §3-B는 `document.querySelector(submit)?.click(); return { clicked: !!document.querySelector(submit) }` (클릭 **후** 재조회)다 — 클릭이 성공해 버튼이 동기적으로 사라지면 `clicked:false` 로 보고하는 역전이 생긴다. `{ clicked: !!b }`(클릭 대상 존재 여부)로 바꾼다. 상태기계는 `clicked` 를 제어에 쓰지 않고 체크포인트 로그로만 남긴다.

---

## 알려진 한계(스파이크 범위 밖)

- `document.images` 는 현재 마운트된 light-DOM 노드만 본다. baseline 시점에 가상화로 빠져 있던 estuary 이미지가 나중에 마운트되면 새 이미지처럼 보일 수 있으며, 이 스파이크에서는 **빈 새 채팅에서 시작**하는 전제만으로 완화한다.
- 실행 중 SPA 대화 전환은 감지하지 않는다. 정상 실행에서도 새 채팅 URL이 `/c/<id>`로 바뀌므로 단순 URL 변경 abort는 쓸 수 없다. 실행 중에는 채팅을 건드리지 않아야 하며, FIX 5의 baseline/poll `href` 로그로 사후 진단한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `electron/spike-chatgpt-automate.js` (신규) | `SELECTORS`/`CDN_RE`/`SPIKE_PROMPT`, 순수 헬퍼 `norm`·`idOf`·`baselineIdsOf`·`pickNewCdnImage`, 페이지 문자열 `PAGE_FNS`+`callPage()`, 입력 헬퍼 `clearComposerAndType`·`pressEnter`, 상태기계 `runGenerateStateMachine` |
| `electron/spike-chatgpt-image.js` (신규) | `extFromContentType`, `saveImage(app, view, src, fs, deps)` |
| `electron/spike-chatgpt-authprobe.js` (신규) | `AUTH_PROBE` 페이지 문자열, `isLoggedIn(probe)`, `whenLoaded(view, opts)`, `ensureLoggedIn(view, deps)` |
| `electron/ipc/spike-chatgpt.js` (수정) | `Cmd+Alt+Shift+G` 핸들러 추가(L/D/T/F 무변경) |
| `tests/electron/spike-chatgpt-automate.test.js` (신규) | 순수 헬퍼 + 페이지 문자열 계약 + **jsdom 실행 eval-boundary 계약** |
| `tests/electron/spike-chatgpt-statemachine.test.js` (신규) | 상태기계 통합(happy/A→B/Enter/중복방지/부분프레임/deadline/context) |
| `tests/electron/spike-chatgpt-image.test.js` (신규) | ext 매핑·mkdir-before-write·fetch !ok |
| `tests/electron/spike-chatgpt-authprobe.test.js` (신규) | `isLoggedIn` DOM fixture·재시도·`whenLoaded` |
| `tests/electron/ipc/spike-chatgpt.test.js` (수정) | G 게이트/성공/실패 경로 (기존 L/D/T/F 케이스 무수정) |

`spike-chatgpt-automate.js` 가 커 보이지만 "한 번의 생성 시도"라는 단일 책임이고 상태기계가 자기 헬퍼를 바로 옆에서 쓰므로 함께 둔다(Phase 1 `spike-chatgpt-view.js` 와 같은 결).

---

### Task 1: 상관 순수 헬퍼 (`norm` / `idOf` / `CDN_RE` / `baselineIdsOf` / `pickNewCdnImage`)

**Files:**
- Create: `electron/spike-chatgpt-automate.js`
- Test: `tests/electron/spike-chatgpt-automate.test.js`

**Interfaces:**
- Produces:
  - `SELECTORS = { composer: '#prompt-textarea', submit: '#composer-submit-button' }`
  - `CDN_RE: RegExp`
  - `norm(s: string) → string` — ZWSP/ZWNJ/ZWJ/BOM 제거, nbsp→space, trim. **자기완결**(외부 식별자 참조 금지 — 페이지 문자열에 `toString()` 으로 이식된다).
  - `idOf(src: string) → string|null` — `id` 쿼리 파라미터, 없거나 파싱 실패면 `null`. **자기완결**.
  - `baselineIdsOf(imgs: Array<{src}>) → string[]` — CDN_RE 매치 + id 있는 것들의 id.
  - `pickNewCdnImage(baselineIds: string[], imgs: Array<{src,complete,w,h}>) → {src,id,w,h}|null` — 뒤(최신)부터 첫 매치.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-chatgpt-automate.test.js
import { describe, it, expect } from 'vitest'
import { norm, idOf, CDN_RE, baselineIdsOf, pickNewCdnImage, SELECTORS } from '../../electron/spike-chatgpt-automate.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content'
const img = (src, over = {}) => ({ src, complete: true, w: 1024, h: 1024, ...over })

describe('norm', () => {
  it('strips ZWSP/ZWNJ/ZWJ/BOM and converts nbsp, then trims', () => {
    expect(norm('\u200B a\u00A0b \uFEFF')).toBe('a b')
    expect(norm('\u200C\u200D')).toBe('')
  })
  it('treats null/undefined as empty string', () => {
    expect(norm(null)).toBe('')
    expect(norm(undefined)).toBe('')
  })
  it('does not collapse inner whitespace (exact prompt comparison)', () => {
    expect(norm('a  b')).toBe('a  b')
  })
})

describe('idOf', () => {
  it('extracts the id query param', () => {
    expect(idOf(`${CDN}?id=file_0001&sig=abc`)).toBe('file_0001')
  })
  it('fail-closed: estuary url without id → null', () => {
    expect(idOf(`${CDN}?sig=abc`)).toBe(null)
  })
  it('unparseable src → null', () => {
    expect(idOf('not a url')).toBe(null)
    expect(idOf('')).toBe(null)
  })
})

describe('CDN_RE', () => {
  it('matches estuary content only', () => {
    expect(CDN_RE.test(`${CDN}?id=a`)).toBe(true)
    expect(CDN_RE.test('https://chatgpt.com/backend-api/files/x?id=a')).toBe(false)
    expect(CDN_RE.test('https://evil.com/backend-api/estuary/content?id=a')).toBe(false)
    expect(CDN_RE.test('http://chatgpt.com/backend-api/estuary/content?id=a')).toBe(false)
    expect(CDN_RE.test('blob:https://chatgpt.com/abc')).toBe(false)
  })
})

describe('baselineIdsOf', () => {
  it('keeps only estuary ids, drops non-cdn and id-less', () => {
    expect(baselineIdsOf([
      img(`${CDN}?id=old1&sig=1`),
      img('blob:https://chatgpt.com/x'),
      img(`${CDN}?sig=noid`),
      img('https://chatgpt.com/backend-api/files/f?id=other'),
    ])).toEqual(['old1'])
  })
})

describe('pickNewCdnImage', () => {
  it('(a) stale baseline id → null', () => {
    expect(pickNewCdnImage(['old1'], [img(`${CDN}?id=old1&sig=1`)])).toBe(null)
  })
  it('(b) transient blob/data src → null', () => {
    expect(pickNewCdnImage([], [img('blob:https://chatgpt.com/x'), img('data:image/png;base64,AAA')])).toBe(null)
  })
  it('(c) wrong backend-api path (not estuary) → null', () => {
    expect(pickNewCdnImage([], [img('https://chatgpt.com/backend-api/files/f?id=new1')])).toBe(null)
  })
  it('(d) same id with a new sig → null', () => {
    expect(pickNewCdnImage(['old1'], [img(`${CDN}?id=old1&sig=REFRESHED`)])).toBe(null)
  })
  it('(e) new id but not finished loading → null', () => {
    expect(pickNewCdnImage([], [img(`${CDN}?id=new1`, { complete: false })])).toBe(null)
    expect(pickNewCdnImage([], [img(`${CDN}?id=new1`, { w: 0 })])).toBe(null)
  })
  it('(f) new id, loaded → returns it with id', () => {
    expect(pickNewCdnImage(['old1'], [
      img(`${CDN}?id=old1&sig=1`),
      img(`${CDN}?id=new1&sig=2`),
    ])).toEqual({ src: `${CDN}?id=new1&sig=2`, id: 'new1', w: 1024, h: 1024 })
  })
  it('(g) fail-closed: estuary without id is never a candidate', () => {
    expect(pickNewCdnImage([], [img(`${CDN}?sig=nosuchid`)])).toBe(null)
  })
  it('prefers the most recent (last) new image', () => {
    const r = pickNewCdnImage([], [img(`${CDN}?id=n1`), img(`${CDN}?id=n2`)])
    expect(r.id).toBe('n2')
  })
  it('tolerates missing/garbage input', () => {
    expect(pickNewCdnImage(undefined, undefined)).toBe(null)
    expect(pickNewCdnImage([], [null, {}, { src: 123 }])).toBe(null)
  })
})

describe('SELECTORS', () => {
  it('are the Phase-1 confirmed ids', () => {
    expect(SELECTORS).toEqual({ composer: '#prompt-textarea', submit: '#composer-submit-button' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-automate.test.js`
Expected: FAIL — 모듈 `electron/spike-chatgpt-automate.js` 없음.

- [ ] **Step 3: 최소 구현**

```js
// electron/spike-chatgpt-automate.js
// ChatGPT 생성 자동화(스파이크). 페이지 쪽은 DOM 직렬화/입력만 하고, "새 이미지 판정"은
// 전부 이 파일의 main 측 순수 함수 한 곳에서 한다(페이지/메인 이중 파서 방지 — 플랜 D1).

export const SELECTORS = { composer: '#prompt-textarea', submit: '#composer-submit-button' }

// Phase 1 실측: 완성 이미지 src = https://chatgpt.com/backend-api/estuary/content?id=…&sig=…
// /backend-api/ 만 보면 attachment/avatar 까지 승인해 오탐.
export const CDN_RE = /^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/

// ⚠️ norm 은 PAGE_FNS 에 toString() 으로 이식된다 → 외부 식별자 참조 금지(자기완결).
// idOf 는 이식하지 않는다(main 전용, 플랜 D1) — 다만 같은 자기완결 규칙을 지켜 둔다.
export function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')   // ZWSP/ZWNJ/ZWJ/BOM
    .replace(/\u00A0/g, ' ')                        // nbsp → space
    .trim()
}

// estuary URL 인데 id 가 없으면 null → 후보에서 제외(fail-closed).
// 서명(sig) 갱신으로 URL 전체가 바뀌므로 신원은 id 로만 판정한다.
export function idOf(src) {
  try {
    return new URL(String(src)).searchParams.get('id') || null
  } catch {
    return null
  }
}

export function baselineIdsOf(imgs) {
  const out = []
  for (const im of Array.isArray(imgs) ? imgs : []) {
    const src = typeof im?.src === 'string' ? im.src : ''
    if (!CDN_RE.test(src)) continue
    const id = idOf(src)
    if (id) out.push(id)
  }
  return out
}

// 수락 = estuary/content + baseline 에 없던 새 id + 로드 완료. 최신(뒤)부터 첫 매치.
export function pickNewCdnImage(baselineIds, imgs) {
  const base = new Set(Array.isArray(baselineIds) ? baselineIds : [])
  const list = Array.isArray(imgs) ? imgs : []
  for (let i = list.length - 1; i >= 0; i--) {
    const im = list[i]
    const src = typeof im?.src === 'string' ? im.src : ''
    if (!CDN_RE.test(src)) continue
    const id = idOf(src)
    if (!id || base.has(id)) continue
    if (im.complete !== true) continue
    if (!(Number(im.w) > 0)) continue
    return { src, id, w: im.w, h: im.h }
  }
  return null
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-automate.test.js`
Expected: PASS (모든 케이스).

- [ ] **Step 5: 커밋 — 구현자는 스킵**

worktree라 서브에이전트는 commit 불가. `git status --short` 결과만 보고한다. (오케스트레이터 커밋 메시지: `spike(chatgpt): image correlation helpers (estuary id, fail-closed)`)

---

### Task 2: 페이지 단계 함수 6종 + `callPage` + eval-boundary 계약

**Files:**
- Modify: `electron/spike-chatgpt-automate.js` (Task 1 파일에 append)
- Test: `tests/electron/spike-chatgpt-automate.test.js` (append)

**Interfaces:**
- Consumes: Task 1의 `norm`, `SELECTORS`. (**`idOf` 는 페이지로 이식하지 않는다** — id 판정은 main 단독, 플랜 D1.)
- Produces:
  - `PAGE_FNS: string` — `window.__cg_baseline__/__cg_inject__/__cg_verify__/__cg_clickSubmit__/__cg_submitAck__/__cg_poll__` 6종을 idempotent 정의하는 IIFE 문자열.
  - `callPage(fnName: string, ...args) → string` — `PAGE_FNS` + 개행 + **마지막 줄에 호출식**(`window.<fn>(<json args>)`). 인자는 `JSON.stringify` 직렬화.
  - 페이지 함수 반환 계약:
    - `__cg_baseline__()` → `{ imgs: [{src, complete, w, h}] }`
    - `__cg_inject__(prompt)` → `{ textMatches: boolean, submitPresent: boolean }`
    - `__cg_verify__(prompt)` → `{ textMatches, submitPresent }` (주입하지 않음)
    - `__cg_clickSubmit__()` → `{ clicked: boolean }`
    - `__cg_submitAck__(prompt)` → `{ composerCleared, submitPresent, stillHasPrompt }`
    - `__cg_poll__()` → `{ imgs: [{src, complete, w, h}] }`

- [ ] **Step 1: 실패 테스트 작성 (문자열 계약 + jsdom 실제 실행)**

```js
// tests/electron/spike-chatgpt-automate.test.js 에 append
import { PAGE_FNS, callPage } from '../../electron/spike-chatgpt-automate.js'

describe('PAGE_FNS string contract', () => {
  it('defines exactly the six spec functions — no more, no less', () => {
    const defined = [...PAGE_FNS.matchAll(/window\.(__cg_\w+__)\s*=/g)].map((m) => m[1])
    expect(defined.sort()).toEqual(
      ['__cg_baseline__', '__cg_clickSubmit__', '__cg_inject__', '__cg_poll__', '__cg_submitAck__', '__cg_verify__'],
    )   // 일곱 번째 stale 함수가 남아도 실패해야 한다
  })
  it('carries the confirmed selectors and the log prefix', () => {
    expect(PAGE_FNS).toContain('#prompt-textarea')
    expect(PAGE_FNS).toContain('#composer-submit-button')
    expect(PAGE_FNS).toContain('[autoflowcut CGPT GEN]')
  })
  it('contains no Node/CDP tokens', () => {
    for (const bad of ['require(', 'process.', 'webContents', 'Debugger.', 'ipcRenderer', 'module.exports']) {
      expect(PAGE_FNS).not.toContain(bad)
    }
  })
})

describe('callPage', () => {
  it('is self-contained: definitions first, call on the last line', () => {
    const s = callPage('__cg_inject__', 'hi "there"')
    expect(s.startsWith(PAGE_FNS)).toBe(true)
    expect(s.trim().split('\n').pop()).toBe('window.__cg_inject__("hi \\"there\\"")')
  })
  it('serializes args as JSON (prompt cannot break out)', () => {
    expect(callPage('__cg_submitAck__', 'a\n");alert(1)//')).toContain(JSON.stringify('a\n");alert(1)//'))
  })
  it('no-arg call', () => {
    expect(callPage('__cg_poll__').trim().split('\n').pop()).toBe('window.__cg_poll__()')
  })
})

// ── eval-boundary: 페이지 함수 문자열을 jsdom 에서 실제로 실행해 "반환 키"를 고정한다.
//    (통합 테스트는 eval 을 mock 하므로 실제 shape 를 못 잡는다 — v3 submitGone 버그 재발 방지)
describe('page functions executed in jsdom', () => {
  const PROMPT = 'a single red apple on a white background'
  const CDNU = 'https://chatgpt.com/backend-api/estuary/content'

  function setup({ composerText = '', hasSubmit = true, images = [] } = {}) {
    document.body.innerHTML = ''
    delete window.__cg_v1
    const c = document.createElement('div')
    c.id = 'prompt-textarea'
    c.setAttribute('contenteditable', 'true')
    c.textContent = composerText
    document.body.appendChild(c)
    if (hasSubmit) {
      const b = document.createElement('button')
      b.id = 'composer-submit-button'
      document.body.appendChild(b)
    }
    for (const im of images) {
      const el = document.createElement('img')
      el.setAttribute('src', im.src)
      Object.defineProperty(el, 'src', { value: im.src, configurable: true })
      Object.defineProperty(el, 'complete', { value: im.complete !== false, configurable: true })
      Object.defineProperty(el, 'naturalWidth', { value: im.w ?? 1024, configurable: true })
      Object.defineProperty(el, 'naturalHeight', { value: im.h ?? 1024, configurable: true })
      el.scrollIntoView = () => {}
      document.body.appendChild(el)
    }
    // jsdom 에 execCommand 가 없다 — ProseMirror 대역으로 텍스트를 실제로 바꾸는 스텁.
    document.execCommand = (cmd, _ui, value) => {
      if (cmd === 'selectAll') return true
      if (cmd === 'delete') { c.textContent = ''; return true }
      if (cmd === 'insertText') { c.textContent += String(value); return true }
      return false
    }
    // eslint-disable-next-line no-new-func
    new Function(PAGE_FNS)()
    return c
  }

  it('__cg_inject__ clears then inserts, and reports textMatches', () => {
    const c = setup({ composerText: 'stale text' })
    const r = window.__cg_inject__(PROMPT)
    expect(r).toEqual({ textMatches: true, submitPresent: true })
    expect(c.textContent).toBe(PROMPT)
  })

  it('__cg_inject__ reports textMatches:false when execCommand does nothing', () => {
    setup({ composerText: '' })
    document.execCommand = () => false
    const r = window.__cg_inject__(PROMPT)
    expect(r.textMatches).toBe(false)
  })

  it('__cg_verify__ does not modify the composer', () => {
    const c = setup({ composerText: PROMPT })
    const r = window.__cg_verify__(PROMPT)
    expect(r).toEqual({ textMatches: true, submitPresent: true })
    expect(c.textContent).toBe(PROMPT)   // 재-inject(clear) 로 지워지면 안 됨
  })

  it('__cg_verify__ normalizes nbsp/ZWSP before comparing', () => {
    setup({ composerText: '\u200Ba single\u00A0red apple on a white background' })
    expect(window.__cg_verify__('a single red apple on a white background').textMatches).toBe(true)
  })

  it('__cg_submitAck__ returns exactly the three keys the state machine reads', () => {
    setup({ composerText: PROMPT })
    const ack = window.__cg_submitAck__(PROMPT)
    expect(Object.keys(ack).sort()).toEqual(['composerCleared', 'stillHasPrompt', 'submitPresent'])
    expect(ack).toEqual({ composerCleared: false, submitPresent: true, stillHasPrompt: true })
    expect('submitGone' in ack).toBe(false)   // v3 옛 키가 다시 들어오면 실패
  })

  it('__cg_submitAck__ after a real submit: cleared composer, submit button gone', () => {
    setup({ composerText: '', hasSubmit: false })
    expect(window.__cg_submitAck__(PROMPT)).toEqual({ composerCleared: true, submitPresent: false, stillHasPrompt: false })
  })

  it('__cg_clickSubmit__ clicks the button and reports it', () => {
    setup({ composerText: PROMPT })
    let clicked = 0
    document.querySelector('#composer-submit-button').addEventListener('click', () => { clicked++ })
    expect(window.__cg_clickSubmit__()).toEqual({ clicked: true })
    expect(clicked).toBe(1)
  })

  it('__cg_clickSubmit__ reports clicked:false when the button is absent', () => {
    setup({ composerText: '', hasSubmit: false })
    expect(window.__cg_clickSubmit__()).toEqual({ clicked: false })
  })

  it('__cg_baseline__ / __cg_poll__ serialize raw images (no filtering in page)', () => {
    setup({ images: [{ src: `${CDNU}?id=a&sig=1` }, { src: 'blob:https://chatgpt.com/x', complete: false, w: 0, h: 0 }] })
    const b = window.__cg_baseline__()
    expect(b.imgs).toHaveLength(2)                      // 필터도 개수 상한도 없다(D1)
    expect(b.imgs[0]).toEqual({ src: `${CDNU}?id=a&sig=1`, complete: true, w: 1024, h: 1024 })
    expect(b.imgs[1]).toEqual({ src: 'blob:https://chatgpt.com/x', complete: false, w: 0, h: 0 })
    expect(window.__cg_poll__().imgs).toHaveLength(2)
  })

  it('serializes every image — no slice cap (stale-acceptance guard)', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ src: `${CDNU}?id=i${i}&sig=1` }))
    setup({ images: many })
    expect(window.__cg_baseline__().imgs).toHaveLength(45)
    expect(window.__cg_baseline__().imgs[0].src).toContain('id=i0')   // 앞쪽이 잘리면 안 된다
  })

  it('missing composer never throws (returns falsy state)', () => {
    setup({})
    document.querySelector('#prompt-textarea').remove()
    expect(window.__cg_inject__(PROMPT).textMatches).toBe(false)
    expect(window.__cg_verify__(PROMPT).textMatches).toBe(false)
    expect(window.__cg_submitAck__(PROMPT)).toEqual({ composerCleared: false, submitPresent: true, stillHasPrompt: false })
  })

  it('with neither composer nor submit button, every flag is falsy (unknown, never "submitted")', () => {
    setup({ hasSubmit: false })
    document.querySelector('#prompt-textarea').remove()
    expect(window.__cg_submitAck__(PROMPT)).toEqual({ composerCleared: false, submitPresent: false, stillHasPrompt: false })
  })

  it('definition block is idempotent (re-eval keeps existing fns)', () => {
    setup({})
    const first = window.__cg_poll__
    // eslint-disable-next-line no-new-func
    new Function(PAGE_FNS)()
    expect(window.__cg_poll__).toBe(first)
  })

  it('main-side helpers agree with the images the page emits', () => {
    setup({ images: [{ src: `${CDNU}?id=old&sig=1` }, { src: `${CDNU}?id=new&sig=2` }] })
    const imgs = window.__cg_poll__().imgs
    expect(baselineIdsOf(imgs)).toEqual(['old', 'new'])
    expect(pickNewCdnImage(['old'], imgs).id).toBe('new')
  })
})
```

> `composerCleared` 가 컴포저 부재 시 `false` 인 이유: 부재를 "제출됨"으로 읽으면 로그아웃/DOM 붕괴가 성공으로 오인된다(fail-closed). 컴포저가 없으면 `stillHasPrompt` 도 거짓이라 두 판정 모두 거짓 = 불확정 상태로 남고, 상태기계는 계속 폴링하다 deadline 에 `stage:'submit'` 으로 끝난다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-automate.test.js`
Expected: FAIL — `PAGE_FNS`/`callPage` export 없음.

- [ ] **Step 3: 최소 구현 (`electron/spike-chatgpt-automate.js` 에 append)**

```js
// ── 페이지 단계 함수 ────────────────────────────────────────────────
// 각 eval 은 self-contained: 6종을 idempotent 정의(있으면 skip)한 뒤 필요한 하나를 호출한다.
// (하드 네비게이션으로 window 함수가 사라져도 ReferenceError 없이 재정의된다.)
// norm 만 위 순수 함수의 소스를 그대로 이식한다(비교 정규화는 페이지에서 해야 하므로).
// idOf/CDN_RE 는 이식하지 않는다 — 이미지 신원 판정은 main 단독(플랜 D1).
// ⚠️ 스파이크는 dev 게이트 전용이라 번들/미니파이를 타지 않는다(toString 이식 안전).
export const PAGE_FNS = /* js */ `
(() => {
  const P = '[autoflowcut CGPT GEN]';
  if (!window.__cg_v1) {   // 센티널은 __cg_*__ 네임스페이스 밖(그 정규식에 걸리면 '7번째 함수'가 된다)
    const SEL = ${JSON.stringify(SELECTORS)};
    const norm = ${norm.toString()};
    const composerEl = () => document.querySelector(SEL.composer);
    const submitEl = () => document.querySelector(SEL.submit);
    const text = () => { const c = composerEl(); return c ? norm(c.textContent) : null; };
    const state = (prompt) => {
      const t = text();
      return { textMatches: t !== null && t === norm(prompt), submitPresent: !!submitEl() };
    };
    // 이미지 직렬화만 한다 — CDN/신규 판정은 main(pickNewCdnImage) 단독 책임.
    // 개수 상한 금지: baseline 에서 잘린 estuary 이미지가 나중에 창에 들어오면 "새 id"로 오인된다(D1).
    const collect = () => Array.from(document.images || []).map((im) => ({
      src: String(im.currentSrc || im.src || ''),
      complete: im.complete === true,
      w: im.naturalWidth || 0,
      h: im.naturalHeight || 0,
    }));
    const snapshot = (tag) => {
      const imgs = collect();
      const last = document.images && document.images.length ? document.images[document.images.length - 1] : null;
      try { if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' }); } catch (e) {}
      try { console.log(P, tag, imgs.length); } catch (e) {}
      return { imgs: imgs };
    };

    window.__cg_baseline__ = function () { return snapshot('baseline'); };

    window.__cg_inject__ = function (prompt) {
      const c = composerEl();
      if (!c) { try { console.log(P, 'inject: no composer'); } catch (e) {} return { textMatches: false, submitPresent: !!submitEl() }; }
      try { c.focus(); } catch (e) {}
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, String(prompt));
      } catch (e) { try { console.log(P, 'inject: execCommand threw', e && e.message); } catch (e2) {} }
      try { c.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(prompt), inputType: 'insertText' })); } catch (e) {}
      const r = state(prompt);
      try { console.log(P, 'inject', JSON.stringify(r)); } catch (e) {}
      return r;
    };

    // 주입하지 않고 상태만 본다 — fallback B(sendInputEvent) 입력을 clear 로 지우지 않기 위해 별도 함수.
    window.__cg_verify__ = function (prompt) {
      const r = state(prompt);
      try { console.log(P, 'verify', JSON.stringify(r)); } catch (e) {}
      return r;
    };

    window.__cg_clickSubmit__ = function () {
      const b = submitEl();
      if (b) { try { b.click(); } catch (e) {} }
      const r = { clicked: !!b };
      try { console.log(P, 'clickSubmit', JSON.stringify(r)); } catch (e) {}
      return r;
    };

    // 이 함수는 상태를 **보고만** 한다. 제출 판정은 main 의 D3 규칙:
    //   submitted = composerCleared === true, notSubmitted = stillHasPrompt === true.
    // submitPresent 는 관측/로그용이다(스펙 §3-F 의 `|| !submitPresent` 는 D3 에서 폐기).
    // 컴포저가 없으면(t === null) 두 판정 모두 거짓 = 불확정 → 계속 폴링(fail-closed).
    window.__cg_submitAck__ = function (prompt) {
      const t = text();
      const r = {
        composerCleared: t === '',
        submitPresent: !!submitEl(),
        stillHasPrompt: t !== null && t === norm(prompt),
      };
      try { console.log(P, 'submitAck', JSON.stringify(r)); } catch (e) {}
      return r;
    };

    window.__cg_poll__ = function () { return snapshot('poll'); };

    window.__cg_v1 = true;
  }
})()`

// 정의 블록 + 마지막 줄 호출식. 인자는 JSON 직렬화(프롬프트가 스크립트를 깨뜨릴 수 없음).
export function callPage(fnName, ...args) {
  const a = args.map((x) => JSON.stringify(x)).join(', ')
  return `${PAGE_FNS};\nwindow.${fnName}(${a})`
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-automate.test.js`
Expected: PASS. 특히 `__cg_submitAck__` 키 3종 정확 일치, jsdom inject 가 실제로 텍스트를 바꿈.

- [ ] **Step 5: 커밋 — 구현자는 스킵** (메시지 예정: `spike(chatgpt): page step functions + self-contained eval builder`)

---

### Task 3: main 측 trusted 입력 헬퍼 (fallback B / Enter)

**Files:**
- Modify: `electron/spike-chatgpt-automate.js` (append)
- Test: `tests/electron/spike-chatgpt-automate.test.js` (append)

**Interfaces:**
- Produces:
  - `SPIKE_PROMPT: string` = `'a single red apple on a white background'` (플랜 D2 — ASCII).
  - `clearComposerAndType(view, text) → void` — focus → Cmd+A → Delete → 문자별 `char` 이벤트.
  - `pressEnter(view) → void` — focus → `Return` keyDown / `\r` char / keyUp (Flow 전례 `electron/flow-compose-mention.js:188-190`).
  - `withEvalTimeout(promise, ms) → Promise` — 값은 그대로 통과, `ms` 안에 settle 안 되면 reject. **Task 5·6 이 둘 다 쓰므로 여기서 정의한다.**

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-chatgpt-automate.test.js 에 append
import { vi } from 'vitest'
import { clearComposerAndType, pressEnter, withEvalTimeout, SPIKE_PROMPT } from '../../electron/spike-chatgpt-automate.js'

// focus 가 첫 입력 이벤트보다 **먼저** 인지까지 봐야 한다 — 나중에 focus 해도 통과하면 false-green.
function fakeView() {
  const order = []
  return {
    order,
    webContents: {
      focus: vi.fn(() => order.push('focus')),
      sendInputEvent: vi.fn((e) => order.push(`${e.type}:${e.keyCode}`)),
    },
  }
}

describe('clearComposerAndType', () => {
  it('focuses FIRST, then selects all, deletes, then types each character', () => {
    const v = fakeView()
    clearComposerAndType(v, 'ab')
    expect(v.order[0]).toBe('focus')
    expect(v.order).toEqual(['focus', 'keyDown:a', 'keyUp:a', 'keyDown:Delete', 'keyUp:Delete', 'char:a', 'char:b'])
    const evs = v.webContents.sendInputEvent.mock.calls.map(([e]) => e)
    expect(evs[0]).toEqual({ type: 'keyDown', keyCode: 'a', modifiers: ['cmd'] })
    expect(evs[1]).toEqual({ type: 'keyUp', keyCode: 'a', modifiers: ['cmd'] })
    expect(evs[2]).toEqual({ type: 'keyDown', keyCode: 'Delete' })
    expect(evs[3]).toEqual({ type: 'keyUp', keyCode: 'Delete' })
    expect(evs.slice(4)).toEqual([
      { type: 'char', keyCode: 'a' },
      { type: 'char', keyCode: 'b' },
    ])
  })
})

describe('pressEnter', () => {
  it('focuses first, then sends the Flow-proven Return sequence once', () => {
    const v = fakeView()
    pressEnter(v)
    expect(v.order).toEqual(['focus', 'keyDown:Return', 'char:\r', 'keyUp:Return'])
    expect(v.webContents.sendInputEvent.mock.calls.map(([e]) => e)).toEqual([
      { type: 'keyDown', keyCode: 'Return' },
      { type: 'char', keyCode: '\r' },
      { type: 'keyUp', keyCode: 'Return' },
    ])
  })
})

describe('withEvalTimeout', () => {
  it('passes the resolved value through', async () => {
    await expect(withEvalTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })
  it('rejects when the promise never settles (a hung executeJavaScript cannot hang the shortcut)', async () => {
    await expect(withEvalTimeout(new Promise(() => {}), 5)).rejects.toThrow(/eval timeout/)
  })
  it('swallows a late rejection from the loser so it is not an unhandled rejection', async () => {
    let reject
    const p = new Promise((_, rj) => { reject = rj })
    await expect(withEvalTimeout(p, 5)).rejects.toThrow(/eval timeout/)
    reject(new Error('late'))                       // 흡수 안 하면 unhandledRejection
    await new Promise((r) => setTimeout(r, 10))
  })
})

describe('SPIKE_PROMPT', () => {
  it('is ASCII-only so sendInputEvent char typing can reproduce it', () => {
    // 타입 단언이 먼저 — 정규식은 undefined 도 'undefined' 로 강제 변환해 통과시킨다.
    expect(typeof SPIKE_PROMPT).toBe('string')
    expect(SPIKE_PROMPT.length).toBeGreaterThan(10)
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7E]+$/.test(SPIKE_PROMPT)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-automate.test.js`
Expected: FAIL — `clearComposerAndType is not a function`.

- [ ] **Step 3: 최소 구현 (append)**

```js
// ── main 측 trusted 입력(fallback) ───────────────────────────────────
// 하드코딩 프롬프트는 ASCII 로 고정한다: fallback B 가 char 이벤트로 한 글자씩 치는데
// 비-ASCII(한글)는 IME 경유라 신뢰할 수 없다(플랜 D2).
export const SPIKE_PROMPT = 'a single red apple on a white background'

export function clearComposerAndType(view, text) {
  const wc = view.webContents
  wc.focus()
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['cmd'] })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['cmd'] })
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' })
  for (const ch of Array.from(String(text))) wc.sendInputEvent({ type: 'char', keyCode: ch })
}

// Flow 전례(electron/flow-compose-mention.js:188-190)와 동일 시퀀스.
export function pressEnter(view) {
  const wc = view.webContents
  wc.focus()
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
  wc.sendInputEvent({ type: 'char', keyCode: '\r' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
}

// executeJavaScript 가 매달리면 단축키가 영영 안 끝난다 — 모든 eval 에 상한을 건다.
// 진 쪽(늦게 reject 되는 원본 promise)은 흡수해야 unhandledRejection 이 안 뜬다.
// (Task 5 의 authprobe 와 Task 6 의 상태기계가 둘 다 쓰므로 여기서 먼저 정의한다.)
export function withEvalTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`eval timeout after ${ms}ms`)), ms) })
  const race = Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  promise.catch(() => {})   // 진 promise 의 늦은 rejection 흡수(unhandledRejection 방지)
  return race
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-automate.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋 — 구현자는 스킵** (메시지 예정: `spike(chatgpt): trusted input fallbacks (type / Enter)`)

---

### Task 4: 이미지 저장 (`spike-chatgpt-image.js`)

**Files:**
- Create: `electron/spike-chatgpt-image.js`
- Test: `tests/electron/spike-chatgpt-image.test.js`

**Interfaces:**
- Consumes: `spikeDir(app)` from `electron/spike-chatgpt-storage.js` (Phase 1).
- Produces:
  - `extFromContentType(contentType: string|null, src?: string) → 'png'|'jpg'|'webp'`
  - `saveImage(app, view, src, fs, deps = {}) → Promise<string>` — `view.webContents.session.fetch(src)` → `res.ok` 검사 → mkdir → `generated-<ts>.<ext>` 저장 → 경로 반환. `deps.now()` 로 타임스탬프 주입 가능.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-chatgpt-image.test.js
import { describe, it, expect, vi } from 'vitest'
import { extFromContentType, saveImage } from '../../electron/spike-chatgpt-image.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content?id=new1&sig=x'
const app = { getPath: () => '/UD' }

function makeView({ ok = true, status = 200, contentType = 'image/png', bytes = [1, 2, 3] } = {}) {
  const fetch = vi.fn(async () => ({
    ok, status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  }))
  return { view: { webContents: { session: { fetch } } }, fetch }
}

function makeFs() {
  const calls = []
  return {
    calls,
    mkdirSync: vi.fn((...a) => { calls.push(['mkdir', ...a]) }),
    writeFileSync: vi.fn((...a) => { calls.push(['write', a[0]]) }),
  }
}

describe('extFromContentType', () => {
  it('maps the image content types', () => {
    expect(extFromContentType('image/png')).toBe('png')
    expect(extFromContentType('image/jpeg')).toBe('jpg')
    expect(extFromContentType('image/webp')).toBe('webp')
  })
  it('ignores charset/parameters and case', () => {
    expect(extFromContentType('Image/WEBP; charset=binary')).toBe('webp')
  })
  it('falls back to the src extension, then png', () => {
    expect(extFromContentType(null, 'https://x/y/a.webp?sig=1')).toBe('webp')
    expect(extFromContentType('application/octet-stream', 'https://x/y/a.jpeg')).toBe('jpg')
    expect(extFromContentType(null, CDN)).toBe('png')
    expect(extFromContentType(undefined, undefined)).toBe('png')
  })
})

describe('saveImage', () => {
  it('fetches through the view session (partition cookies) and writes the bytes', async () => {
    const { view, fetch } = makeView()
    const fs = makeFs()
    const p = await saveImage(app, view, CDN, fs, { now: () => 1700000000000 })
    expect(fetch).toHaveBeenCalledWith(CDN)
    expect(p).toBe('/UD/spike-chatgpt/generated-1700000000000.png')
    expect(fs.writeFileSync).toHaveBeenCalledOnce()
    expect(fs.writeFileSync.mock.calls[0][0]).toBe(p)
    expect(Buffer.isBuffer(fs.writeFileSync.mock.calls[0][1])).toBe(true)
    expect([...fs.writeFileSync.mock.calls[0][1]]).toEqual([1, 2, 3])
  })
  it('creates the directory BEFORE writing', async () => {
    const { view } = makeView()
    const fs = makeFs()
    await saveImage(app, view, CDN, fs, { now: () => 1 })
    expect(fs.calls.map((c) => c[0])).toEqual(['mkdir', 'write'])
    expect(fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
  })
  it('uses the response content-type for the extension', async () => {
    const { view } = makeView({ contentType: 'image/webp' })
    const fs = makeFs()
    const p = await saveImage(app, view, CDN, fs, { now: () => 7 })
    expect(p.endsWith('generated-7.webp')).toBe(true)
  })
  it('throws and writes nothing when the response is not ok', async () => {
    const { view } = makeView({ ok: false, status: 403 })
    const fs = makeFs()
    await expect(saveImage(app, view, CDN, fs, {})).rejects.toThrow(/403/)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-image.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 최소 구현**

```js
// electron/spike-chatgpt-image.js
// 생성 이미지 저장. src 는 인증형 https(estuary)라 뷰 세션(persist:chatgpt) 쿠키가 필요하다
// → Node fetch 가 아니라 session.fetch (전례: electron/ipc/shared.js sessionFetch).
import path from 'node:path'
import { spikeDir } from './spike-chatgpt-storage.js'

export function extFromContentType(contentType, src = '') {
  const t = String(contentType || '').toLowerCase().split(';')[0].trim()
  if (t === 'image/png') return 'png'
  if (t === 'image/jpeg' || t === 'image/jpg') return 'jpg'
  if (t === 'image/webp') return 'webp'
  const m = String(src || '').match(/\.(png|jpe?g|webp)(?:[?#]|$)/i)
  if (m) {
    const e = m[1].toLowerCase()
    return e === 'jpeg' ? 'jpg' : e
  }
  return 'png'
}

export async function saveImage(app, view, src, fs, deps = {}) {
  const { now = () => Date.now() } = deps
  const res = await view.webContents.session.fetch(src)
  if (!res || res.ok !== true) throw new Error(`[spike] image fetch failed: ${res ? res.status : 'no-response'}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extFromContentType(res.headers?.get?.('content-type'), src)
  const dir = spikeDir(app)
  fs.mkdirSync(dir, { recursive: true })   // 신규 디렉토리 — 없으면 ENOENT
  const p = path.join(dir, `generated-${now()}.${ext}`)
  fs.writeFileSync(p, buf)
  return p
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-image.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋 — 구현자는 스킵** (메시지 예정: `spike(chatgpt): save generated image via session.fetch`)

---

### Task 5: 로그인 프로브 + load-ready (`spike-chatgpt-authprobe.js`)

**Files:**
- Create: `electron/spike-chatgpt-authprobe.js`
- Test: `tests/electron/spike-chatgpt-authprobe.test.js`

**Interfaces:**
- Produces:
  - `AUTH_PROBE: string` — `{ composer: boolean, loginCta: boolean }` 반환 페이지 문자열.
  - `isLoggedIn(probe) → boolean` — `probe?.composer === true`.
  - `whenLoaded(view, { timeoutMs = 15000 }) → Promise<boolean>` — 로딩 중이면 `did-finish-load`/`did-fail-load`/타임아웃 중 먼저 오는 것까지 대기.
  - `ensureLoggedIn(view, { executeInView, attempts = 5, intervalMs = 500, sleep, log }) → Promise<boolean>` — SPA 하이드레이션 여유로 재시도(기본 ~2s).

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-chatgpt-authprobe.test.js
import { describe, it, expect, vi } from 'vitest'
import { AUTH_PROBE, isLoggedIn, whenLoaded, ensureLoggedIn } from '../../electron/spike-chatgpt-authprobe.js'

describe('AUTH_PROBE executed in jsdom', () => {
  const run = () => new Function(`return (${AUTH_PROBE})`)()   // eslint-disable-line no-new-func
  it('reports composer:true when the composer is rendered (logged in)', () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div>'
    expect(run()).toEqual({ composer: true, loginCta: false })
  })
  it('reports composer:false + loginCta:true on the logged-out page', () => {
    document.body.innerHTML = '<a href="https://auth.openai.com/auth/login">Log in</a>'
    expect(run()).toEqual({ composer: false, loginCta: true })
  })
  it('reports both false on a blank/error page', () => {
    document.body.innerHTML = ''
    expect(run()).toEqual({ composer: false, loginCta: false })
  })
  it('contains no Node/CDP tokens', () => {
    for (const bad of ['require(', 'process.', 'webContents', 'Debugger.']) expect(AUTH_PROBE).not.toContain(bad)
  })
})

describe('isLoggedIn', () => {
  it('is true only when the composer exists', () => {
    expect(isLoggedIn({ composer: true, loginCta: true })).toBe(true)
    expect(isLoggedIn({ composer: false, loginCta: false })).toBe(false)
    expect(isLoggedIn(null)).toBe(false)
    expect(isLoggedIn({ error: 'boom' })).toBe(false)
  })
})

function fakeWc({ loading = false, loadingSeq = null } = {}) {
  const handlers = {}
  const seq = loadingSeq ? [...loadingSeq] : null
  return {
    // loadingSeq 를 주면 호출마다 다음 값을 준다(등록 직후 재확인 경로 검증용).
    isLoading: vi.fn(() => (seq ? (seq.length > 1 ? seq.shift() : seq[0]) : loading)),
    on: vi.fn((ev, cb) => { (handlers[ev] ||= []).push(cb) }),
    removeListener: vi.fn((ev, cb) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== cb) }),
    emit: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
    handlers,
  }
}

describe('whenLoaded', () => {
  it('resolves immediately when the view is not loading', async () => {
    const wc = fakeWc({ loading: false })
    await expect(whenLoaded({ webContents: wc })).resolves.toBe(false)
    expect(wc.on).not.toHaveBeenCalled()
  })
  it('waits for did-finish-load and detaches its listeners', async () => {
    const wc = fakeWc({ loading: true })
    const p = whenLoaded({ webContents: wc })
    wc.emit('did-finish-load')
    await expect(p).resolves.toBe(true)
    expect(wc.removeListener).toHaveBeenCalledTimes(2)
  })
  it('resolves false on did-fail-load', async () => {
    const wc = fakeWc({ loading: true })
    const p = whenLoaded({ webContents: wc })
    wc.emit('did-fail-load')
    await expect(p).resolves.toBe(false)
  })
  it('resolves false on timeout (never hangs the shortcut)', async () => {
    const wc = fakeWc({ loading: true })
    await expect(whenLoaded({ webContents: wc }, { timeoutMs: 5 })).resolves.toBe(false)
  })
  it('re-checks isLoading after subscribing (load finished in the gap → no 15s hang)', async () => {
    const wc = fakeWc({ loadingSeq: [true, false] })   // 첫 확인엔 로딩 중, 등록 직후엔 이미 끝남
    await expect(whenLoaded({ webContents: wc }, { timeoutMs: 60000 })).resolves.toBe(false)
    expect(wc.isLoading).toHaveBeenCalledTimes(2)
    expect(wc.removeListener).toHaveBeenCalledTimes(2)
  })
})

describe('ensureLoggedIn', () => {
  const sleep = vi.fn(async () => {})
  it('true on the first probe when the composer is there — and does not sleep', async () => {
    const executeInView = vi.fn(async () => ({ composer: true, loginCta: false }))
    const s = vi.fn(async () => {})
    await expect(ensureLoggedIn({}, { executeInView, sleep: s })).resolves.toBe(true)
    expect(executeInView).toHaveBeenCalledOnce()
    expect(s).not.toHaveBeenCalled()
  })
  it('waits ~500ms between probes while the SPA hydrates (probe → sleep → probe)', async () => {
    const order = []
    let n = 0
    const executeInView = vi.fn(async () => { order.push('probe'); return ++n < 3 ? { composer: false } : { composer: true } })
    const s = vi.fn(async (ms) => { order.push(`sleep:${ms}`) })
    await expect(ensureLoggedIn({}, { executeInView, sleep: s })).resolves.toBe(true)
    expect(executeInView).toHaveBeenCalledTimes(3)
    expect(order).toEqual(['probe', 'sleep:500', 'probe', 'sleep:500', 'probe'])   // sleep 을 빼면 실패
  })
  it('false after all attempts and logs the last probe', async () => {
    const executeInView = vi.fn(async () => ({ composer: false, loginCta: true }))
    const log = { error: vi.fn(), info: vi.fn() }
    await expect(ensureLoggedIn({}, { executeInView, sleep, attempts: 3, log })).resolves.toBe(false)
    expect(executeInView).toHaveBeenCalledTimes(3)
    expect(log.error).toHaveBeenCalled()
  })
  it('treats a rejected eval as not-logged-in instead of throwing', async () => {
    const executeInView = vi.fn(async () => { throw new Error('context destroyed') })
    await expect(ensureLoggedIn({}, { executeInView, sleep, attempts: 2, log: { error: vi.fn() } })).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-authprobe.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 최소 구현**

```js
// electron/spike-chatgpt-authprobe.js
// G 전용 게이트.
// (withEvalTimeout 은 spike-chatgpt-automate.js 의 것을 재사용 — 상한 정책이 한 곳에만 있게.) URL 이 아니라 DOM 으로 판정한다(#prompt-textarea 렌더 = 로그인 세션).
// L/D/T/F 는 Phase 1 계약대로 무게이트.
import { withEvalTimeout } from './spike-chatgpt-automate.js'

export const AUTH_PROBE = /* js */ `(() => {
  const composer = !!document.querySelector('#prompt-textarea');
  const loginCta = !!(document.querySelector('[data-testid="login-button"]') || document.querySelector('a[href*="/auth/login"]'));
  try { console.log('[autoflowcut CGPT GEN] authprobe', JSON.stringify({ composer: composer, loginCta: loginCta })); } catch (e) {}
  return { composer: composer, loginCta: loginCta };
})()`

export function isLoggedIn(probe) {
  return probe?.composer === true
}

// 첫 G(직전 L/D/T/F 없이)는 loadURL 직후라 프로브가 로드 중에 돌아 거짓 미로그인이 난다.
// 이미 로드된 뷰(idempotent 재사용)면 즉시 resolve. 절대 매달리지 않게 타임아웃 포함.
export function whenLoaded(view, { timeoutMs = 15000 } = {}) {
  const wc = view?.webContents
  if (!wc || typeof wc.isLoading !== 'function' || !wc.isLoading()) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { wc.removeListener('did-finish-load', onFinish) } catch {}
      try { wc.removeListener('did-fail-load', onFail) } catch {}
      resolve(v)
    }
    const onFinish = () => finish(true)
    const onFail = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    wc.on('did-finish-load', onFinish)
    wc.on('did-fail-load', onFail)
    // 확인과 구독 사이에 로드가 끝나면 이벤트를 영영 못 받는다 → 구독 후 한 번 더 확인.
    if (!wc.isLoading()) finish(false)
  })
}

export async function ensureLoggedIn(view, deps) {
  const {
    executeInView,
    attempts = 5,
    intervalMs = 500,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    probeTimeoutMs = 10000,
    log = console,
  } = deps
  let last = null
  for (let i = 0; i < attempts; i++) {
    try {
      // 프로브 eval 도 상한을 건다 — 매달리면 단축키(그리고 상태기계의 reprobe)가 안 끝난다.
      last = await withEvalTimeout(executeInView(view, AUTH_PROBE), probeTimeoutMs)
    } catch (e) {
      last = { error: e?.message || String(e) }
    }
    if (isLoggedIn(last)) return true
    if (i < attempts - 1) await sleep(intervalMs)
  }
  log.error?.('[spike] not logged in — press Cmd+Alt+Shift+L and sign in. probe:', JSON.stringify(last))
  return false
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-authprobe.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋 — 구현자는 스킵** (메시지 예정: `spike(chatgpt): login DOM probe + load-ready wait`)

---

### Task 6: 상태 기계 `runGenerateStateMachine`

**Files:**
- Modify: `electron/spike-chatgpt-automate.js` (append)
- Test: `tests/electron/spike-chatgpt-statemachine.test.js`

**Interfaces:**
- Consumes: Task 1~3의 `callPage`, `baselineIdsOf`, `pickNewCdnImage`, `clearComposerAndType`, `pressEnter`.
- Produces:
  - `runGenerateStateMachine(view, prompt, deps) → Promise<{ok:true, src, id, injectMethod, submitMethod} | {ok:false, stage:'inject'|'submit'|'poll'|'context', detail}>`
  - deps: `{ executeInView, reprobe?, log?, now?, sleep?, typeText?, enter?, deadlineMs = 120000, cadenceMs = 1500, maxRejectStreak = 3, maxContextResets = 2, evalTimeoutMs = 15000, reprobeTimeoutMs = 5000 }`
    (`now`/`sleep`/`typeText`/`enter`/`reprobe` 는 테스트 주입용. 실제 호출부는 `executeInView`/`reprobe`/`log` 만 넘긴다.)

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-chatgpt-statemachine.test.js
import { describe, it, expect, vi } from 'vitest'
import { runGenerateStateMachine } from '../../electron/spike-chatgpt-automate.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content'
const loaded = (id) => ({ src: `${CDN}?id=${id}&sig=1`, complete: true, w: 1024, h: 1024 })
const PROMPT = 'a single red apple on a white background'

// callPage 는 정의블록 + 마지막 줄 호출식 → 마지막 줄에서 함수 이름을 뽑는다.
function fnNameOf(script) {
  const m = String(script).trim().split('\n').pop().match(/window\.(__cg_\w+__)\(/)
  return m ? m[1] : null
}

// handlers: { __cg_x__: value | (callIndexForThatFn) => value }  — 함수면 호출 회차(0-based)를 받는다.
function makeHarness(handlers) {
  const counts = {}
  const calls = []
  const executeInView = vi.fn(async (_view, script) => {
    const fn = fnNameOf(script)
    calls.push(fn)
    const n = (counts[fn] = (counts[fn] ?? -1) + 1)
    const h = handlers[fn]
    if (h === undefined) throw new Error(`unexpected page fn: ${fn}`)
    const v = typeof h === 'function' ? h(n) : h
    if (v instanceof Error) throw v
    return v
  })
  let t = 0
  return {
    executeInView, calls, counts,
    now: () => t,
    sleep: async (ms) => { t += ms },
    typeText: vi.fn(),
    enter: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    advance: (ms) => { t += ms },
  }
}
const ACK_SUBMITTED = { composerCleared: true, submitPresent: false, stillHasPrompt: false }
const ACK_NOT_SUBMITTED = { composerCleared: false, submitPresent: true, stillHasPrompt: true }

describe('runGenerateStateMachine — happy path', () => {
  it('baseline → inject A → click → ack → two identical new ids → ok', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [loaded('old1')] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: (n) => (n === 0 ? { imgs: [loaded('old1')] } : { imgs: [loaded('old1'), loaded('new1')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: true, src: `${CDN}?id=new1&sig=1`, id: 'new1', injectMethod: 'execCommand', submitMethod: 'click' })
    // 순서를 고정한다 — clickSubmit(주 제출 경로)을 지우거나 poll 을 ack 앞으로 옮기면 실패해야 한다.
    expect(h.calls.slice(0, 5)).toEqual(['__cg_baseline__', '__cg_inject__', '__cg_clickSubmit__', '__cg_submitAck__', '__cg_poll__'])
    expect(h.counts.__cg_poll__).toBe(2)             // 3회차(2연속 안정)에서 수락
    expect(h.typeText).not.toHaveBeenCalled()
    expect(h.enter).not.toHaveBeenCalled()
    expect(h.counts.__cg_verify__).toBeUndefined()   // A 성공이면 verify 안 씀
  })
})

describe('injection fallback A → B', () => {
  it('falls back to sendInputEvent typing and re-verifies without re-injecting', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: { imgs: [loaded('new1')] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(r.injectMethod).toBe('sendInputEvent')
    expect(h.typeText).toHaveBeenCalledWith({}, PROMPT)
    expect(h.counts.__cg_inject__).toBe(0)           // __cg_inject__ 는 딱 1회(재-inject 금지)
  })
  it('a rejecting inject eval is a context failure, not an injection failure (no blind typing)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: () => new Error('context destroyed'),
    })
    h.reprobe = vi.fn(async () => false)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.typeText).not.toHaveBeenCalled()          // 죽은 페이지에 trusted 타이핑 금지
    expect(h.counts.__cg_inject__).toBe(2)             // 3회 재시도 후 포기
  })

  it('a malformed (but resolved) inject value is a context failure, not a fallback trigger', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: 'yes' },        // 계약 밖 값
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.typeText).not.toHaveBeenCalled()
  })

  it('a malformed baseline is a context failure (an empty set would make old images look new)', async () => {
    const h = makeHarness({ __cg_baseline__: { imgs: 'nope' } })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.calls).toEqual(['__cg_baseline__'])
  })

  it('a malformed verify value is a context failure too', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: {},                           // textMatches 없음
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.calls).not.toContain('__cg_clickSubmit__')
  })

  it('a rejecting verify eval after fallback B is also a context failure', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: () => new Error('context destroyed'),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.typeText).toHaveBeenCalledOnce()
    expect(h.calls).not.toContain('__cg_clickSubmit__')
  })

  it('fails with stage:inject when B also does not match', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: { textMatches: false, submitPresent: false },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('inject')
    expect(h.calls).not.toContain('__cg_clickSubmit__')
  })
})

describe('submit fallback — Enter', () => {
  it('presses Enter once after two consecutive notSubmitted acks + a re-check', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // ack 회차: 0,1 = 안 먹음(streak 2) → 2 = ack2 재검증(안 먹음) → Enter → 이후 제출됨
      __cg_submitAck__: (n) => (n <= 2 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      // 이미지는 제출이 ack 된 뒤에 뜬다(생성은 컴포저가 비워진 다음 시작된다)
      __cg_poll__: (n) => (n >= 2 ? { imgs: [loaded('new1')] } : { imgs: [] }),
    })
    h.enter = vi.fn()
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    expect(r.submitMethod).toBe('enter')
  })
  it('does NOT press Enter after a single notSubmitted observation', async () => {
    // 시간 기준 픽스처여야 `>= 2` → `>= 1` 뮤테이션이 여기서 죽는다. 호출 회차 기준이면
    // 뮤턴트가 같은 사이클에 쏘는 ack2 가 다음 회차(=제출됨) 값을 먹어 Enter 가 안 나가 통과해버린다.
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => (h.now() < 3000 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      __cg_poll__: (n) => (n === 0 ? { imgs: [] } : { imgs: [loaded('new1')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
  it('does NOT press Enter when the ack2 re-check shows the submit landed (slow click)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 0,1 = 안 먹음(streak 2), 2 = ack2 재검증 시점엔 이미 제출됨 → Enter 금지
      __cg_submitAck__: (n) => (n <= 1 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      __cg_poll__: (n) => (n === 0 ? { imgs: [] } : { imgs: [loaded('new1')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
  it('retries the Enter fallback after an ack2 eval rejection (never permanently blocked)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // n=2 가 첫 ack2 재검증 — 그 한 번만 reject 시킨다
      __cg_submitAck__: (n) => (n === 2 ? new Error('transient') : ACK_NOT_SUBMITTED),
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)   // 나중 사이클에서 재검증 성공 → Enter 발화
    expect(r.stage).toBe('submit')
  })

  it('never presses Enter once a submit has been acknowledged (sticky ack)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 제출이 한 번 확인된 뒤 컴포저에 프롬프트가 다시 나타나도(복원/재렌더) Enter 금지
      __cg_submitAck__: (n) => (n === 0 ? ACK_SUBMITTED : ACK_NOT_SUBMITTED),
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).not.toHaveBeenCalled()
    expect(r.stage).toBe('poll')            // ack 됐으므로 submit 이 아니라 poll 실패
  })

  it('a rejected ack breaks the notSubmitted streak (Enter needs two CONSECUTIVE observations)', async () => {
    let enterAt = null
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (n) => (n === 1 ? new Error('transient') : ACK_NOT_SUBMITTED),
      __cg_poll__: { imgs: [] },
    })
    h.enter = vi.fn(() => { enterAt = h.now() })
    await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)
    expect(enterAt).toBe(6000)   // 스트릭을 안 끊으면 4500 에 나간다(관측 실패를 미제출로 오인)
  })

  it('presses Enter at most once even if the composer never clears', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_NOT_SUBMITTED,
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })   // 제출 ack 없음 → submit
  })
})

describe('submit acknowledgement is required (D3)', () => {
  it('does not read a missing submit button as "submitted" while the prompt is still there', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: false },
      // 버튼은 아직 렌더 안 됐고 프롬프트는 그대로 → 제출된 게 아니다
      __cg_submitAck__: { composerCleared: false, submitPresent: false, stillHasPrompt: true },
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)          // 미제출로 인식 → Enter fallback 이 살아 있어야
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })   // 'poll' 이면 오인 ack
  })

  it('treats "different text + no submit button" as unknown, not submitted', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 컴포저가 비지도 않았고 프롬프트도 아닌 상태 — 제출로 읽으면 안 된다
      __cg_submitAck__: { composerCleared: false, submitPresent: false, stillHasPrompt: false },
      __cg_poll__: { imgs: [loaded('new1')] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })
  })

  it('never accepts an image while the submit is unacknowledged', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 불확정 상태(다른 텍스트 + 버튼 존재): submitted 도 notSubmitted 도 아님
      __cg_submitAck__: { composerCleared: false, submitPresent: true, stillHasPrompt: false },
      __cg_poll__: { imgs: [loaded('new1')] },        // 안정된 새 이미지가 계속 보여도
      })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })
    expect(h.enter).not.toHaveBeenCalled()
  })
})

describe('reject streaks are per page function and must be consecutive', () => {
  it('gives up when ONE page function keeps failing even though the others succeed', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => new Error('__cg_submitAck__ is broken'),
      __cg_poll__: { imgs: [] },                 // 이건 계속 성공한다
    })
    h.reprobe = vi.fn(async () => true)          // 로그인·컴포저는 멀쩡
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.now()).toBeLessThan(120000)         // 스트릭을 합치면 여기서 120s 를 다 태운다
  })

  it('scattered (non-consecutive) rejections never trip the context guard', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (n) => (n % 2 === 0 ? new Error('flaky') : ACK_SUBMITTED),   // 성공이 스트릭을 끊는다
      __cg_poll__: (n) => (n < 6 ? { imgs: [] } : { imgs: [loaded('new1')] }),
    })
    h.reprobe = vi.fn(async () => false)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(h.reprobe).not.toHaveBeenCalled()     // 성공 시 스트릭 리셋을 지우면 여기서 context 로 죽는다
  })
})

describe('pre-acknowledgement images are absorbed, never accepted', () => {
  it('an image visible before the submit ack is treated as pre-existing; a later new one wins', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 첫 사이클은 아직 미제출 — 그 사이 직전 turn 의 늦은 이미지('stale')가 렌더된다
      __cg_submitAck__: (n) => (n === 0 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      __cg_poll__: (n) => (n <= 2 ? { imgs: [loaded('stale')] } : { imgs: [loaded('stale'), loaded('new2')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(r.id).toBe('new2')     // 'stale' 을 수락하면(흡수 로직 제거 시) 여기서 죽는다
  })
})

describe('image acceptance stability', () => {
  it('does not accept a new id seen only once (partial frame swap)', async () => {
    const seq = [
      { imgs: [loaded('prev')] },      // 1회차: prev
      { imgs: [loaded('other')] },     // 2회차: 다른 id → 불안정
      { imgs: [loaded('other')] },     // 3회차: 같은 id 2연속 → 수락
    ]
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: (n) => seq[Math.min(n, seq.length - 1)],
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(r.id).toBe('other')
    expect(h.counts.__cg_poll__).toBe(2)   // 0,1,2 중 3회차(index 2)에서 수락
  })
  it('never accepts baseline ids, non-estuary srcs, or same-id/new-sig', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [loaded('old1')] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: {
        imgs: [
          { src: `${CDN}?id=old1&sig=REFRESHED`, complete: true, w: 1024, h: 1024 },
          { src: 'https://chatgpt.com/backend-api/files/f?id=new9', complete: true, w: 1024, h: 1024 },
          { src: 'blob:https://chatgpt.com/x', complete: true, w: 1024, h: 1024 },
        ],
      },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: false, stage: 'poll', detail: 'deadline' })   // 제출은 ack 됨 → poll
  })
})

describe('deadline and context loss', () => {
  it('stops at the single 120s deadline (not per-phase)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.stage).toBe('poll')
    // 1.5s cadence 로 t=1500…118500 의 79회 실행. 80번째 sleep 은 정확히 deadline 에 닿아
    // eval 없이 break 한다 → 마지막 호출 인덱스 78.
    expect(h.counts.__cg_poll__).toBe(78)
    expect(h.now()).toBe(120000)
  })
  it('fails early with stage:context after repeated eval rejects + a failed re-probe', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => new Error('Script failed to execute: context destroyed'),
      __cg_poll__: () => new Error('context destroyed'),
    })
    h.reprobe = vi.fn(async () => false)   // 안정 로그아웃/DOM 부재
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('context')
    expect(h.reprobe).toHaveBeenCalled()
    expect(h.now()).toBeLessThan(120000)   // 120s 낭비하지 않음
  })
  it('keeps going when the re-probe says the page is fine (transient navigation)', async () => {
    let pollOk = false
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (n) => (n < 4 ? new Error('transient') : ACK_SUBMITTED),
      __cg_poll__: (n) => (n < 4 ? new Error('transient') : (pollOk = true, { imgs: [loaded('new1')] })),
    })
    h.reprobe = vi.fn(async () => true)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.reprobe).toHaveBeenCalled()
    expect(pollOk).toBe(true)
    expect(r.ok).toBe(true)
  })
  it('retries a rejecting baseline 3× before failing with stage:context', async () => {
    const h = makeHarness({ __cg_baseline__: () => new Error('destroyed') })
    h.reprobe = vi.fn(async () => false)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.calls).toEqual(['__cg_baseline__', '__cg_baseline__', '__cg_baseline__'])   // bounded retry(§3-F)
    expect(h.now()).toBe(3000)            // 재시도 사이 cadence 만큼만 대기, 루프엔 안 들어감
  })

  it('recovers when a transient baseline rejection succeeds on retry', async () => {
    const h = makeHarness({
      __cg_baseline__: (n) => (n === 0 ? new Error('transient') : { imgs: [] }),
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: { imgs: [loaded('new1')] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(h.counts.__cg_baseline__).toBe(1)   // 2회 호출(index 1)
  })

  it('gives up with stage:context when the page probes alive but evals keep failing', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => new Error('page fn broken'),
      __cg_poll__: () => new Error('page fn broken'),
    })
    h.reprobe = vi.fn(async () => true)     // 로그인·컴포저는 멀쩡 — 그래도 영원히 돌면 안 된다
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.now()).toBeLessThan(120000)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-statemachine.test.js`
Expected: FAIL — `runGenerateStateMachine is not a function`.

- [ ] **Step 3: 최소 구현 (`electron/spike-chatgpt-automate.js` 에 append)**

```js
// ── 상태 기계(main 오케스트레이션) ──────────────────────────────────
// 단일 total deadline(120s) · 고정 cadence(1.5s). 제출 확인(ack)과 미제출 확정을 독립 계산해
// 중간 상태(다른 텍스트 + submit 존재)에서는 둘 다 거짓 → 안전하게 계속 폴링한다.

export async function runGenerateStateMachine(view, prompt, deps) {
  const {
    executeInView,
    reprobe = async () => true,
    log = console,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    typeText = clearComposerAndType,
    enter = pressEnter,
    deadlineMs = 120000,
    cadenceMs = 1500,
    maxRejectStreak = 3,
    maxContextResets = 2,
    evalTimeoutMs = 15000,
    reprobeTimeoutMs = 5000,
  } = deps
  const P = '[spike]'
  const t0 = now()
  const remaining = () => deadlineMs - (now() - t0)
  const expired = () => remaining() <= 0
  let contextResets = 0

  // reject 스트릭은 **페이지 함수별로** 센다. 하나로 합치면 __cg_poll__ 성공이 매번
  // __cg_submitAck__ 의 스트릭을 지워, 한 함수만 영구히 깨진 상태를 영원히 못 잡는다.
  const streaks = new Map()
  const worstStreak = () => Math.max(0, ...streaks.values())

  const evalFn = async (fn, ...args) => {
    // 남은 시간을 넘겨 매달리지 않도록 eval 상한도 deadline 에 물린다.
    const budget = Math.max(1, Math.min(evalTimeoutMs, remaining()))
    try {
      const value = await withEvalTimeout(executeInView(view, callPage(fn, ...args)), budget)
      streaks.set(fn, 0)
      return { ok: true, value }
    } catch (e) {
      const n = (streaks.get(fn) || 0) + 1
      streaks.set(fn, n)
      log.error?.(P, 'eval rejected:', fn, e?.message || e, 'streak', n)
      return { ok: false }
    }
  }

  // 제출 전 단계(baseline/inject/verify)도 transient reject 를 bounded 재시도한다(§3-F).
  const evalWithRetry = async (fn, ...args) => {
    for (let i = 0; i < maxRejectStreak; i++) {
      if (expired()) break                      // deadline 을 넘겨 새 eval 을 쏘지 않는다
      const r = await evalFn(fn, ...args)
      if (r.ok) return r
      if (expired() || i === maxRejectStreak - 1) break
      await sleep(Math.min(cadenceMs, Math.max(remaining(), 0)))
    }
    return { ok: false }
  }
  // reprobe 도 deadline 에 물린다 — 안 그러면 남은 시간이 0.5s 일 때 시작한 5s 프로브가
  // 상태기계를 deadline 4.5s 뒤에 끝낸다(120s 보장이 거짓이 된다).
  const safeReprobe = async () => {
    if (expired()) return false
    try {
      return await withEvalTimeout(Promise.resolve().then(() => reprobe()), Math.max(1, Math.min(reprobeTimeoutMs, remaining())))
    } catch { return false }
  }
  const contextFail = async (what) => {
    const alive = await safeReprobe()
    return { ok: false, stage: 'context', detail: `${what} (page ${alive ? 'looked alive' : 'probe failed'})` }
  }

  // 연속 reject 를 무한 마스킹하지 않는다: 어떤 함수든 N회 연속 실패하면 재프로브하고,
  // 페이지가 멀쩡한데도 계속 실패하면(=페이지 함수 자체가 깨짐) 리셋 상한에서 조기 종료.
  // 반환: null = 계속 진행, string = 조기 실패 사유.
  const contextCheck = async () => {
    if (worstStreak() < maxRejectStreak) return null
    if (expired()) return null                   // 만료됐으면 재프로브 없이 루프가 끝나게 둔다
    if (!(await safeReprobe())) return 'page probe failed (logged out / composer gone)'
    streaks.clear()
    contextResets += 1
    if (contextResets > maxContextResets) return 'page alive but page-function evals keep failing'
    return null
  }

  // 1) baseline — 제출 전 estuary content-id 집합
  const base = await evalWithRetry('__cg_baseline__')
  if (!base.ok) return contextFail('baseline eval rejected')
  // 페이지가 깨져 계약 밖 값을 주면 baseline 이 빈 집합이 되어 기존 이미지가 "새 것"이 된다 → fail-closed.
  if (!Array.isArray(base.value?.imgs)) return contextFail('baseline returned a malformed value')
  const baseIds = baselineIdsOf(base.value.imgs)
  const excluded = new Set(baseIds)   // baseline + 제출 확인 전에 관측된 id 전부
  log.info?.(P, 'baseline estuary ids:', baseIds.length)

  // 2) 주입 A(execCommand) → 실패 시 B(sendInputEvent) + 별도 verify(재-inject 금지).
  //    ⚠️ "eval 이 거부됨"과 "eval 은 됐는데 텍스트가 안 맞음"을 구분한다. 전자는 컨텍스트
  //    문제라 stage:'context' — 페이지가 죽은 상태에서 trusted 타이핑을 쏘면 안 된다.
  let injectMethod = 'execCommand'
  const a = await evalWithRetry('__cg_inject__', prompt)
  if (!a.ok) return contextFail('inject eval rejected')
  if (typeof a.value?.textMatches !== 'boolean') return contextFail('inject returned a malformed value')
  let injected = a.value.textMatches === true
  if (!injected) {
    log.info?.(P, 'inject A did not take → fallback B (sendInputEvent)')
    injectMethod = 'sendInputEvent'
    try {
      typeText(view, prompt)
    } catch (e) {
      return { ok: false, stage: 'inject', detail: `sendInputEvent threw: ${e?.message || e}` }
    }
    const v = await evalWithRetry('__cg_verify__', prompt)
    if (!v.ok) return contextFail('verify eval rejected')
    if (typeof v.value?.textMatches !== 'boolean') return contextFail('verify returned a malformed value')
    injected = v.value.textMatches === true
  }
  if (!injected) return { ok: false, stage: 'inject', detail: 'composer text does not match prompt' }
  log.info?.(P, 'inject ok via', injectMethod)

  // 3) 제출 primary = click (clicked 는 제어에 쓰지 않고 체크포인트 로그로만 — 플랜 D4)
  let submitMethod = 'click'
  const clickR = await evalFn('__cg_clickSubmit__')
  log.info?.(P, 'submit click sent; button present =', clickR.value?.clicked)

  // 4) 단일 deadline 루프 — sleep 은 deadline 을 넘겨 자지 않고, 넘긴 뒤에는 eval 도 안 쏜다.
  let notSubmittedStreak = 0
  let submittedAck = false
  let enterTried = false
  let lastPollId = null
  for (;;) {
    await sleep(Math.min(cadenceMs, Math.max(remaining(), 0)))
    if (expired()) break

    const ackR = await evalFn('__cg_submitAck__', prompt)
    if (!ackR.ok) {
      // 관측 실패는 "미제출 관측"이 아니다 — 연속성을 깨야 Enter 가 불확실한 근거로 나가지 않는다.
      notSubmittedStreak = 0
      const lost = await contextCheck()
      if (lost) return { ok: false, stage: 'context', detail: lost }
    } else {
      const ack = ackR.value || {}
      // 플랜 D3: "비워짐"만 제출 신호. 프롬프트가 남아 있으면(버튼 유무 무관) 확정 미제출.
      // 나머지(다른 텍스트·컴포저 부재)는 불확정 — 둘 다 거짓으로 두고 계속 폴링한다.
      const submitted = ack.composerCleared === true
      const notSubmitted = ack.stillHasPrompt === true
      if (submitted && !submittedAck) { submittedAck = true; log.info?.(P, 'submit acknowledged') }
      notSubmittedStreak = notSubmitted ? notSubmittedStreak + 1 : 0

      // Enter fallback: 2연속(≥cadence 간격) 미제출 + 직전 재검증 + 1회 한정(중복 제출 완화)
      // submittedAck 는 sticky — 한 번이라도 제출이 확인됐으면 Enter 는 절대 나가지 않는다(중복 제출 방지).
      if (notSubmittedStreak >= 2 && submitMethod === 'click' && !enterTried && !submittedAck) {
        const ack2R = await evalFn('__cg_submitAck__', prompt)
        if (!ack2R.ok) {
          // 재검증을 못 했을 뿐이다 — enterTried 를 세우면 Enter 가 영영 봉쇄된다. 다음 사이클에 재시도.
          log.info?.(P, 'Enter fallback deferred — ack2 eval rejected')
          const lost = await contextCheck()
          if (lost) return { ok: false, stage: 'context', detail: lost }
        } else {
          const ack2 = ack2R.value || {}
          if (ack2.stillHasPrompt === true) {
            log.info?.(P, 'click ineffective ×2 → Enter fallback (once)')
            try { enter(view) } catch (e) { log.error?.(P, 'Enter fallback threw:', e?.message || e) }
            enterTried = true
            submitMethod = 'enter'
          } else {
            log.info?.(P, 'Enter fallback skipped — prompt is gone on re-check')
            enterTried = true
            if (ack2.composerCleared === true) submittedAck = true
          }
        }
      }
    }

    const pollR = await evalFn('__cg_poll__')
    if (!pollR.ok) {
      const lost = await contextCheck()
      if (lost) return { ok: false, stage: 'context', detail: lost }
      continue
    }
    if (!Array.isArray(pollR.value?.imgs)) return contextFail('poll returned a malformed value')
    const imgs = pollR.value.imgs
    // 제출이 확인되기 **전**에 보이는 estuary 이미지는 우리 결과일 수 없다(생성은 컴포저가 비워진
    // 뒤에 시작된다). baseline 에 흡수하고 안정성 추적도 리셋한다 — 안 그러면 제출 직전에 뜬
    // 늦은 이미지가 ack 직후 첫 폴링에서 "2연속"으로 성립해 그대로 수락된다.
    if (!submittedAck) {
      for (const id of baselineIdsOf(imgs)) excluded.add(id)
      lastPollId = null
      continue
    }
    const p = pickNewCdnImage([...excluded], imgs)
    if (p && lastPollId === p.id) {
      log.info?.(P, `accepted image id=${p.id} ${p.w}x${p.h} inject=${injectMethod} submit=${submitMethod} src=${p.src}`)
      return { ok: true, src: p.src, id: p.id, injectMethod, submitMethod }
    }
    lastPollId = p ? p.id : null
  }
  log.error?.(P, 'deadline exceeded; submittedAck =', submittedAck, 'lastPollId =', lastPollId)
  return { ok: false, stage: submittedAck ? 'poll' : 'submit', detail: 'deadline' }
}
```

> 다섯 가지 주의(전부 리뷰에서 실제로 뚫렸던 지점):
> 1. `enterTried = true` 는 ack2 가 **성공적으로 응답**했을 때만 세운다. ack2 가 reject 되면 세우지 않고 다음 사이클에 다시 시도한다 — 세워버리면 일시적 eval 실패 한 번이 Enter fallback 을 영구 봉쇄한다.
> 2. 성공 수락에 `submittedAck` 를 요구한다(D3) — 제출이 확인되지 않은 채 뜬 이미지는 우리 프롬프트의 결과가 아니다.
> 3. reject 스트릭은 **함수별**이다. 하나로 합치면 `__cg_poll__` 성공이 매번 `__cg_submitAck__` 스트릭을 지워, 한 함수만 깨진 상태를 120s 내내 못 잡는다.
> 4. `evalWithRetry` 가 다 실패한 것(= eval 거부)과 `textMatches:false`(= 주입이 안 먹음)는 다른 실패다. 전자는 `stage:'context'` — 죽은 페이지에 trusted 타이핑을 쏘면 안 된다.
> 5. 시간: `sleep` 은 `min(cadence, remaining)`, sleep 직후 만료면 eval 없이 `break`, eval 상한도 `min(evalTimeoutMs, remaining)`.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-statemachine.test.js`
Expected: PASS (전 케이스). 실패 시 `stage` 값과 poll 회차부터 확인.

- [ ] **Step 5: 커밋 — 구현자는 스킵** (메시지 예정: `spike(chatgpt): generate state machine (inject/submit fallbacks, id-stable poll)`)

---

### Task 7: `Cmd+Alt+Shift+G` 핸들러 배선

**Files:**
- Modify: `electron/ipc/spike-chatgpt.js`
- Test: `tests/electron/ipc/spike-chatgpt.test.js` (기존 L/D/T/F 케이스는 **수정 금지**, G 케이스만 추가)

**Interfaces:**
- Consumes: `ensureChatgptView`/`ensureVisibleAndFocused`(Phase 1), `whenLoaded`/`ensureLoggedIn`(Task 5), `runGenerateStateMachine`/`SPIKE_PROMPT`(Task 3·6), `saveImage`(Task 4).
- Produces: `registerSpikeShortcuts` 가 `Cmd+Alt+Shift+G` 를 추가 등록. deps 에 **테스트 전용 선택 옵션 `generateOptions`/`probeOptions`(기본 `{}`)** 를 추가해 상태기계/로그인 프로브로 그대로 전달한다. `main.js` 변경 없음(기존 deps 로 충분 — 옵션을 안 넘기면 스펙 기본값 120s/1.5s, 5×500ms).

- [ ] **Step 1: 실패 테스트 작성 (파일 하단에 append)**

```js
// tests/electron/ipc/spike-chatgpt.test.js 에 append
import { AUTH_PROBE } from '../../../electron/spike-chatgpt-authprobe.js'

const CDNSRC = 'https://chatgpt.com/backend-api/estuary/content?id=new1&sig=z'

// G 경로용 deps: 세션 fetch 가 달린 뷰 + 페이지 함수별 응답.
function makeGDeps({ loggedIn = true, imgs = null } = {}) {
  const { deps, registered } = makeDeps()
  const sessionFetch = vi.fn(async () => ({
    ok: true, status: 200,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([9]).buffer,
  }))
  const view = {
    webContents: {
      getURL: () => 'https://chatgpt.com',
      isDestroyed: () => false,
      focus: vi.fn(),
      isLoading: vi.fn(() => false),
      on: vi.fn(),
      removeListener: vi.fn(),
      sendInputEvent: vi.fn(),
      session: { fetch: sessionFetch },
    },
    setBounds: vi.fn(),
  }
  deps.makeView = vi.fn(() => view)
  const images = imgs || [{ src: CDNSRC, complete: true, w: 1024, h: 1024 }]
  deps.executeInView = vi.fn(async (_v, script) => {
    if (script === AUTH_PROBE) return { composer: loggedIn, loginCta: !loggedIn }
    // Phase 1 덤퍼(L/D/T/F)도 같은 executeInView 를 탄다 — 분기가 없으면 D 핸들러가 죽는다.
    if (String(script).includes('__autoflowcut_chatgpt_dump__')) return { url: 'https://chatgpt.com', images: [] }
    const call = String(script).trim().split('\n').pop()
    if (call.includes('__cg_baseline__')) return { imgs: [] }
    if (call.includes('__cg_inject__')) return { textMatches: true, submitPresent: true }
    if (call.includes('__cg_clickSubmit__')) return { clicked: true }
    if (call.includes('__cg_submitAck__')) return { composerCleared: true, submitPresent: false, stillHasPrompt: false }
    if (call.includes('__cg_poll__')) return { imgs: images }
    throw new Error('unexpected script: ' + call)
  })
  // 실 deadline 120s / 5×500ms 프로브를 그대로 타면 안 되고, 실제 wall-clock 에 의존하면
  // 느린 러너에서 깜빡인다 → 가상 시계를 주입한다(Task 6 하네스와 같은 방식).
  let t = 0
  deps.generateOptions = { deadlineMs: 30, cadenceMs: 5, now: () => t, sleep: async (ms) => { t += ms } }
  deps.probeOptions = { sleep: async () => {} }
  return { deps, registered, view, sessionFetch }
}

describe('Cmd+Alt+Shift+G (generate)', () => {
  it('is registered when the gate is on', () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    expect([...registered.keys()]).toContain('Cmd+Alt+Shift+G')
  })

  it('is NOT registered when the gate is off', () => {
    const { deps, registered } = makeDeps({ env: {} })
    registerSpikeShortcuts(deps)
    expect(registered.size).toBe(0)
  })

  it('generates and saves the image (ensureView → visible → probe → machine → save)', async () => {
    const { deps, registered, sessionFetch, view } = makeGDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+G')()
    expect(deps.makeView).toHaveBeenCalled()
    // 표시/포커스(= sendInputEvent fallback 의 전제)와 load-ready 대기를 실제 **순서대로** 탄다.
    // 호출 여부만 보면 두 줄을 상태기계 뒤로 옮겨도 통과한다 → invocationCallOrder 로 고정.
    const mw = deps.getMainWindow()
    expect(mw.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1000, height: 700 })
    const at = (m) => m.mock.invocationCallOrder[0]
    expect(at(deps.makeView)).toBeLessThan(at(mw.contentView.addChildView))
    expect(at(mw.contentView.addChildView)).toBeLessThan(at(view.webContents.focus))
    expect(at(view.webContents.focus)).toBeLessThan(at(view.webContents.isLoading))   // whenLoaded
    expect(at(view.webContents.isLoading)).toBeLessThan(at(deps.executeInView))       // 프로브
    expect(at(deps.executeInView)).toBeLessThan(at(sessionFetch))                     // 저장
    // 로그인 프로브가 상태기계보다 먼저
    const scripts = deps.executeInView.mock.calls.map(([, s2]) => s2)
    expect(scripts[0]).toBe(AUTH_PROBE)
    expect(scripts.findIndex((s2) => s2.includes('__cg_baseline__('))).toBeGreaterThan(0)
    expect(sessionFetch).toHaveBeenCalledWith(CDNSRC)
    expect(deps.fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
    const written = deps.fs.writeFileSync.mock.calls[0][0]
    expect(written).toMatch(/\/UD\/spike-chatgpt\/generated-\d+\.png$/)
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('image saved'), written)
  })

  it('gates on login: no state machine, no save, tagged log', async () => {
    const { deps, registered } = makeGDeps({ loggedIn: false })
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+G')()
    const scripts = deps.executeInView.mock.calls.map(([, s]) => s)
    expect(scripts).toHaveLength(5)                             // 기본 attempts 만큼 프로브(빈 배열 vacuous-pass 방지)
    expect(scripts.every((s) => s === AUTH_PROBE)).toBe(true)   // 프로브만 돌고 끝
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
    expect(deps.log.error).toHaveBeenCalled()
  })

  it('logs the failure stage and saves nothing when generation fails', async () => {
    const { deps, registered } = makeGDeps({ imgs: [] })     // 새 이미지 없음 → deadline
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+G')()
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining('generate failed'), expect.anything(), expect.anything())
  })

  it('never throws out of the shortcut handler (save failure reaches the outer catch)', async () => {
    // ensureLoggedIn 은 eval 예외를 자체적으로 삼킨다 → outer try/catch 를 시험하려면
    // 로그인 이후 단계(session.fetch)가 throw 해야 한다. handler 의 try/catch 를 지우면 실패.
    const { deps, registered, view } = makeGDeps()
    view.webContents.session.fetch = vi.fn(async () => { throw new Error('boom') })
    registerSpikeShortcuts(deps)
    await expect(registered.get('Cmd+Alt+Shift+G')()).resolves.toBeUndefined()
    expect(deps.log.error).toHaveBeenCalledWith('[spike] generate threw:', 'boom')
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('leaves L/D/T/F ungated (Phase 1 contract)', async () => {
    const { deps, registered } = makeGDeps({ loggedIn: false })
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+D')()
    expect(deps.fs.writeFileSync).toHaveBeenCalled()          // 로그인 안 됐어도 덤프는 저장됨
  })
})
```

> `registerSpikeShortcuts` deps 에 **선택적 `generateOptions` / `probeOptions`(둘 다 기본 `{}`)** 를 추가해 각각 `runGenerateStateMachine` 과 `ensureLoggedIn` 으로 그대로 전달한다 — 테스트가 가상 시계(`now`/`sleep`)와 짧은 deadline 을 주입해 실제 wall-clock 에 의존하지 않게 하는 것이 유일한 목적이다(실 `setTimeout` 에 기대면 느린 러너에서 깜빡인다). `main.js` 는 두 키를 넘기지 않으므로 프로덕션 경로는 스펙 값(120s/1.5s, 5×500ms) 그대로다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/ipc/spike-chatgpt.test.js`
Expected: FAIL — `Cmd+Alt+Shift+G` 미등록.

- [ ] **Step 3: 최소 구현**

```js
// electron/ipc/spike-chatgpt.js — import 추가
import { ensureLoggedIn, whenLoaded } from '../spike-chatgpt-authprobe.js'
import { runGenerateStateMachine, SPIKE_PROMPT } from '../spike-chatgpt-automate.js'
import { saveImage } from '../spike-chatgpt-image.js'
```

```js
// registerSpikeShortcuts 안, deps 구조분해에 두 옵션 추가:
//   const { app, env, globalShortcut, getMainWindow, makeView, disposeView, state,
//           executeInView, fs, log, generateOptions = {}, probeOptions = {} } = deps
// 그리고 reg('Cmd+Alt+Shift+F', ...) 아래에 추가:

  // G: 하드코딩 프롬프트로 이미지 1장 생성·저장(스파이크 종료 조건). G만 로그인 게이트.
  reg('Cmd+Alt+Shift+G', async () => {
    try {
      const view = ensure()
      ensureVisibleAndFocused(view, getMainWindow())
      await whenLoaded(view)                     // 첫 G(로드 직후) 거짓 미로그인 방지
      const authed = await ensureLoggedIn(view, { executeInView, log, ...probeOptions })
      if (!authed) return                        // ensureLoggedIn 이 이미 태그드 로그를 남김
      const r = await runGenerateStateMachine(view, SPIKE_PROMPT, {
        executeInView,
        log,
        reprobe: () => ensureLoggedIn(view, { executeInView, attempts: 1, probeTimeoutMs: 5000, log, ...probeOptions }),
        ...generateOptions,
      })
      if (!r.ok) {
        log.error('[spike] generate failed:', r.stage, r.detail || '')
        return
      }
      const p = await saveImage(app, view, r.src, fs)
      log.info('[spike] image saved:', p)
    } catch (e) {
      log.error('[spike] generate threw:', e?.message || e)
    }
  })
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/ipc/spike-chatgpt.test.js`
Expected: PASS — 기존 L/D/T/F 케이스 포함 전부.

- [ ] **Step 5: 전체 게이트**

Run: `npm run test:run`
Expected: 전체 그린. 그리고 `git diff HEAD --stat -- tests/electron/api/genai.test.js` 와 `git status --short -- tests/electron/api/genai.test.js` 가 **둘 다 빈 출력**(무수정 — staged 변경까지 포함해서)인지 확인.

- [ ] **Step 6: 커밋 — 구현자는 스킵** (메시지 예정: `spike(chatgpt): Cmd+Alt+Shift+G generate-and-save handler`)

---

## 구현 후 오케스트레이터 검증(구현자 아님)

1. **뮤테이션 실측**(각각 되돌리면 테스트가 죽어야 함):
   - `__cg_submitAck__` 반환 키 `submitPresent` → `submitGone` 으로 rename → Task 2 eval-boundary 테스트 FAIL.
   - `notSubmittedStreak >= 2` → `>= 1` → "single notSubmitted 는 Enter 금지" FAIL.
   - ack2 재검증 블록 제거 → "slow click 이면 Enter 금지" FAIL.
   - ack2 reject 경로에서 `enterTried = true` 를 세움 → "ack2 rejection 후 Enter 재시도" FAIL.
   - `lastPollId === p.id` 안정성 검사 제거 → "partial frame" FAIL.
   - `submitted` 를 스펙 원식(`|| !submitPresent`)으로 되돌림 → D3 "missing submit button" FAIL.
   - `await evalFn('__cg_clickSubmit__')` 한 줄 삭제 → happy-path 호출 순서 FAIL.
   - `collect()` 에 `slice(-40)` 재도입 → "no slice cap" FAIL.
   - `CDN_RE` 를 `/backend-api/` 로 완화 → wrong-backend-path FAIL.
   - `idOf` fail-closed 제거(전체 src fallback) → (g) FAIL.
   - `evalWithRetry` 를 `evalFn` 으로 되돌림(재시도 제거) → "retries a rejecting baseline 3×" FAIL.
   - `contextResets` 상한 제거 → "probes alive but evals keep failing" FAIL(= 120s 소진).
   - `clearComposerAndType`/`pressEnter` 에서 `wc.focus()` 를 뒤로 이동 → focus 순서 FAIL.
   - `ensureLoggedIn` 의 `sleep` 제거 → "probe → sleep → probe" FAIL.
   - `whenLoaded` 의 구독-후 재확인 제거 → race 테스트 FAIL.
   - `mkdirSync` 를 write 뒤로 이동 → mkdir-before-write FAIL.
   - `ensureLoggedIn` 게이트 제거 → G 게이트 테스트 FAIL.
   - G 핸들러에서 `ensureVisibleAndFocused` / `whenLoaded` 삭제 → Task 7 배선 assert FAIL.
   - G 핸들러에서 `ensureVisibleAndFocused` 를 상태기계 **뒤로 이동** → Task 7 invocationCallOrder FAIL.
   - reject 스트릭을 함수별에서 단일 카운터로 되돌림 → "ONE page function keeps failing" FAIL.
   - `streaks.set(fn, 0)`(성공 시 리셋) 제거 → "scattered rejections" FAIL.
   - inject/verify 의 `!ok → contextFail` 을 `stage:'inject'` 로 되돌림 → "rejecting inject eval" FAIL.
   - 루프의 `if (expired()) break` 제거 → deadline 테스트의 `counts.__cg_poll__ === 78` FAIL.
   - PAGE_FNS 센티널을 `__cg_v1__`(트레일링 `__`)로 되돌림 → "exactly six" FAIL.
   - 제출 확인 전 이미지 흡수(`if (!submittedAck) { …absorb…; continue }`) 제거 → "pre-acknowledgement images" FAIL.
   - Enter 게이트의 `&& !submittedAck` 제거 → "sticky ack" FAIL.
   - ack reject 시 `notSubmittedStreak = 0` 제거 → "rejected ack breaks the streak"(enterAt 6000) FAIL.
   - inject/baseline/verify/poll shape 검증 제거 → malformed 테스트 4건 FAIL.
   - `safeReprobe` 의 `withEvalTimeout` 클램프 제거 → 테스트로는 안 물린다(모든 reprobe mock 이 즉시 resolve) — **코드 리뷰로만 지키는 항목**. 120s 보장 문구의 근거이므로 지우지 말 것.
   - `withEvalTimeout` 을 그냥 `promise` 통과로 바꿈 → "hung executeJavaScript" FAIL.
2. `git diff` raw 로 스코프 밖 변경(특히 `electron/main.js`, `genai*`) 0 확인.
3. 리뷰 findings-0 loop: Fable 5 + Codex **병렬**, 두 리뷰어 모두 0 될 때까지.
4. 사용자 실앱 검증: 앱 재시작(`AUTOFLOWCUT_SPIKE=1 npm run dev`) → `Cmd+Alt+Shift+L` 로그인 확인 → **빈 새 채팅** → `Cmd+Alt+Shift+G` → 터미널에서
   - `[spike] baseline estuary ids: N`
   - `[spike] inject ok via execCommand|sendInputEvent`
   - `[spike] submit click sent` (+ 필요시 `Enter fallback`)
   - `[spike] accepted image id=… inject=… submit=… src=…`
   - `[spike] image saved: …/spike-chatgpt/generated-*.png`
   확인 + 저장 파일 눈으로 열어 **preview(저해상)가 아닌 최종 이미지**인지 확인(경험적 잔여 ①), 채팅에 생성이 **1건만** 있는지 확인(경험적 잔여 ②).
