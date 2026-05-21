# reCAPTCHA 차단 자동 감지·대응 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미지 배치 생성 중 Google Flow의 reCAPTCHA 차단이 발생하면 자동으로 감지해 배치를 일시정지하고, 단계적 대기(5/10/30분) 후 자동 재개하며, 사용자에게 안내 모달을 띄운다.

**Architecture:** 순수 함수 2개(감지 `isRecaptchaError`, 정책 `planRecaptchaWait`)를 별도 모듈로 분리해 단위 테스트하고, `useAutomation.js`의 기존 `pausedRef` 일시정지 메커니즘을 재사용해 escalation 대기를 구현한다. 모달은 메시지 + 확인 버튼만 있는 순수 안내용 컴포넌트로, 배치 동작(중지/재개)은 전부 앱 기존 컨트롤이 담당한다.

**Tech Stack:** React (hooks), Electron, vitest (테스트 러너), 기존 i18n(`src/locales`).

**범위:** 씬 이미지 배치 생성(`useAutomation.js`)만 대상. 레퍼런스 생성·비디오 생성도 같은 7~15초 패턴이지만 이번 범위 밖 — Task 1~2의 감지 유틸·정책 모듈은 재사용 가능하게 만들어 후속 작업 비용을 낮춘다.

**배경 (확정된 설계):**
- Flow는 reCAPTCHA 차단 시 Generate 버튼을 disable하지 **않음** → 버튼 상태로는 감지 불가. 클릭은 성공하고 **서버 응답**이 거부됨 (`result.error`에 `reCAPTCHA evaluation failed` / `unusual activity` 문자열).
- escalation: 연속 차단 1회→5분, 2회→10분, 3회→30분, 4회+→자동재개 중단(수동).
- 재개 후 일정 씬 수 연속 성공 → incident 카운터 리셋.
- 모달 = 메시지 + [확인]. 확인은 모달만 닫음(배치 영향 없음). 1~3회는 대기 끝나면 자동 재개·자동 닫힘.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `src/utils/recaptchaDetect.js` (Create) | 에러 문자열이 reCAPTCHA 차단인지 판정하는 순수 함수 |
| `src/config/defaults.js` (Modify) | `recaptcha` 설정 블록(대기 단계·리셋 임계값) 추가 |
| `src/services/recaptchaPolicy.js` (Create) | incident 횟수 → 대기시간·자동재개 여부 계산 (순수 함수) |
| `src/components/RecaptchaModal.jsx` (Create) | 안내 모달 (메시지 + 카운트다운 + 확인 버튼) |
| `src/components/RecaptchaModal.css` (Create) | 모달 스타일 |
| `src/locales/ko.js`, `src/locales/en.js` (Modify) | 모달·알림 문구 |
| `src/hooks/useAutomation.js` (Modify) | 감지 연결 + escalation 대기 + 모달 상태 노출 |
| `src/App.jsx` (Modify) | `RecaptchaModal` 렌더 + `useAutomation` 상태 연결 |
| `electron/main.js` 또는 알림 모듈 (Modify) | OS 시스템 알림 (선택, Task 7) |

테스트는 `tests/`가 `src/` 구조를 미러링한다 (CLAUDE.md). 러너는 vitest: 단일 파일 `npx vitest run <path>`.

---

## Task 1: reCAPTCHA 에러 감지 유틸

**Files:**
- Create: `src/utils/recaptchaDetect.js`
- Test: `tests/utils/recaptchaDetect.test.js`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/utils/recaptchaDetect.test.js
import { describe, it, expect } from 'vitest'
import { isRecaptchaError } from '../../src/utils/recaptchaDetect'

describe('isRecaptchaError', () => {
  it('detects "reCAPTCHA evaluation failed"', () => {
    expect(isRecaptchaError('reCAPTCHA evaluation failed')).toBe(true)
  })
  it('detects "unusual activity" message', () => {
    expect(isRecaptchaError('We noticed some unusual activity.')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(isRecaptchaError('RECAPTCHA Evaluation Failed')).toBe(true)
  })
  it('returns false for unrelated errors', () => {
    expect(isRecaptchaError('Generation timeout')).toBe(false)
    expect(isRecaptchaError('No images')).toBe(false)
  })
  it('returns false for non-string / empty input', () => {
    expect(isRecaptchaError(null)).toBe(false)
    expect(isRecaptchaError(undefined)).toBe(false)
    expect(isRecaptchaError('')).toBe(false)
    expect(isRecaptchaError(42)).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/utils/recaptchaDetect.test.js`
Expected: FAIL — `isRecaptchaError` is not defined / 모듈 없음.

- [ ] **Step 3: 구현**

```js
// src/utils/recaptchaDetect.js
/**
 * Flow 생성 실패 메시지가 reCAPTCHA 차단(봇 감지)인지 판정한다.
 * Flow는 차단 시 Generate 버튼을 disable하지 않고 서버 응답으로만 거부하므로,
 * 결과 에러 문자열 매칭이 유일한 감지 수단이다.
 */
const RECAPTCHA_PATTERNS = [/recaptcha/i, /unusual activity/i]

export function isRecaptchaError(text) {
  if (typeof text !== 'string' || text.length === 0) return false
  return RECAPTCHA_PATTERNS.some((re) => re.test(text))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/utils/recaptchaDetect.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/utils/recaptchaDetect.js tests/utils/recaptchaDetect.test.js
git commit -m "feat(automation): add reCAPTCHA error detection util"
```

---

## Task 2: reCAPTCHA 설정 + escalation 정책

**Files:**
- Modify: `src/config/defaults.js` (`generation` 블록 다음에 `recaptcha` 추가)
- Create: `src/services/recaptchaPolicy.js`
- Test: `tests/services/recaptchaPolicy.test.js`

- [ ] **Step 1: `defaults.js`에 `recaptcha` 설정 추가**

`src/config/defaults.js`의 `generation: { ... }` 블록 바로 다음에 추가:

```js
  // reCAPTCHA 차단 대응 (escalation)
  recaptcha: {
    waitTiersMs: [5 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000], // 1·2·3회 대기
    maxIncidents: 3,          // 초과(4회+) 시 자동 재개 중단 → 수동
    resetAfterScenes: 25,     // 재개 후 연속 성공 N씬 → incident 카운터 리셋
  },
```

- [ ] **Step 2: 실패 테스트 작성**

```js
// tests/services/recaptchaPolicy.test.js
import { describe, it, expect } from 'vitest'
import { planRecaptchaWait, shouldResetIncidents } from '../../src/services/recaptchaPolicy'

describe('planRecaptchaWait', () => {
  it('1st incident → 5 min, autoResume true', () => {
    expect(planRecaptchaWait(1)).toEqual({ waitMs: 300000, autoResume: true })
  })
  it('2nd incident → 10 min', () => {
    expect(planRecaptchaWait(2)).toEqual({ waitMs: 600000, autoResume: true })
  })
  it('3rd incident → 30 min', () => {
    expect(planRecaptchaWait(3)).toEqual({ waitMs: 1800000, autoResume: true })
  })
  it('4th incident → no auto-resume (manual)', () => {
    expect(planRecaptchaWait(4)).toEqual({ waitMs: 0, autoResume: false })
  })
  it('beyond 4th stays manual', () => {
    expect(planRecaptchaWait(7)).toEqual({ waitMs: 0, autoResume: false })
  })
})

describe('shouldResetIncidents', () => {
  it('false below threshold', () => {
    expect(shouldResetIncidents(24)).toBe(false)
  })
  it('true at threshold', () => {
    expect(shouldResetIncidents(25)).toBe(true)
  })
  it('true above threshold', () => {
    expect(shouldResetIncidents(40)).toBe(true)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/services/recaptchaPolicy.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 구현**

```js
// src/services/recaptchaPolicy.js
import { DEFAULTS } from '../config/defaults'

const { waitTiersMs, maxIncidents, resetAfterScenes } = DEFAULTS.recaptcha

/**
 * incidentCount(1-based, 증가 후 값) → 다음 대기 계획.
 * @param {number} incidentCount  연속 차단 횟수 (1,2,3,...)
 * @returns {{waitMs:number, autoResume:boolean}}
 *   autoResume=false 면 자동 재개 안 함 (4회+) — 사용자가 수동 재개해야 함.
 */
export function planRecaptchaWait(incidentCount) {
  if (incidentCount > maxIncidents) {
    return { waitMs: 0, autoResume: false }
  }
  return { waitMs: waitTiersMs[incidentCount - 1], autoResume: true }
}

/**
 * 재개 후 연속 성공 씬 수가 리셋 임계값에 도달했는지.
 * @param {number} consecutiveSuccesses
 * @returns {boolean}
 */
export function shouldResetIncidents(consecutiveSuccesses) {
  return consecutiveSuccesses >= resetAfterScenes
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/services/recaptchaPolicy.test.js`
Expected: PASS (8 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/config/defaults.js src/services/recaptchaPolicy.js tests/services/recaptchaPolicy.test.js
git commit -m "feat(automation): add reCAPTCHA escalation policy + config"
```

---

## Task 3: i18n 문구 추가

**Files:**
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`

기존 locale 객체의 적당한 섹션(예: `status` 또는 최상위)에 `recaptcha` 키 그룹을 추가한다. 키 구조는 두 파일이 동일해야 한다.

- [ ] **Step 1: `ko.js`에 문구 추가**

`src/locales/ko.js`의 최상위 객체 안에 추가:

```js
  recaptcha: {
    title: '⚠️ reCAPTCHA 일시 차단 — {{min}}분 후 자동 재개',
    titleManual: '🚫 reCAPTCHA 차단이 풀리지 않습니다',
    body: 'Google Flow는 짧은 시간에 생성 요청이 몰리면 봇 방지(reCAPTCHA) 점수가 낮아져 생성을 일시적으로 막습니다. 앱 오류가 아니라 Google 측 보호 장치입니다. 점수는 잠시 쉬면 자동으로 회복되며, {{min}}분 뒤 배치를 자동으로 이어서 진행합니다. 그대로 두셔도 됩니다.',
    bodyManual: '자동 재개를 3번 시도했지만 계속 막혔습니다. Flow 탭에서 이미지를 직접 1~2장 생성해 reCAPTCHA를 풀어주세요. 그래도 안 되면 VPN을 끄거나 30분~1시간 뒤 다시 시도하세요. 해결되면 앱의 재개 버튼을 눌러주세요.',
    countdown: '자동 재개까지 {{time}}',
    confirm: '확인',
    notify: 'reCAPTCHA 차단 감지 — {{min}}분 후 자동 재개',
    notifyManual: 'reCAPTCHA 차단 — 수동 조치가 필요합니다',
  },
```

- [ ] **Step 2: `en.js`에 동일 키 추가**

`src/locales/en.js`의 최상위 객체 안에 추가:

```js
  recaptcha: {
    title: '⚠️ reCAPTCHA paused — auto-resume in {{min}} min',
    titleManual: '🚫 reCAPTCHA block won\'t clear',
    body: 'Google Flow temporarily blocks generation when too many requests arrive in a short time and the bot-protection (reCAPTCHA) score drops. This is not an app error — it is Google\'s protection. The score recovers on its own; the batch will auto-resume in {{min}} minutes. You can leave it as is.',
    bodyManual: 'Auto-resume was tried 3 times but the block persists. Generate 1-2 images manually in the Flow tab to clear reCAPTCHA. If it still fails, turn off any VPN or retry after 30-60 minutes. Press the app\'s resume button once it works.',
    countdown: 'Auto-resume in {{time}}',
    confirm: 'OK',
    notify: 'reCAPTCHA block detected — auto-resume in {{min}} min',
    notifyManual: 'reCAPTCHA block — manual action required',
  },
```

- [ ] **Step 3: 키 정합성 확인**

Run: `node -e "const ko=Object.keys(require('./src/locales/ko.js').recaptcha||require('./src/locales/ko.js').default.recaptcha).sort();const en=Object.keys(require('./src/locales/en.js').recaptcha||require('./src/locales/en.js').default.recaptcha).sort();console.log(JSON.stringify(ko)===JSON.stringify(en)?'OK':'MISMATCH '+ko+' vs '+en)"`
Expected: `OK`
(러너가 ESM이면 이 확인은 생략하고 육안으로 키 7개 일치만 확인: title, titleManual, body, bodyManual, countdown, confirm, notify, notifyManual — 8개.)

- [ ] **Step 4: 커밋**

```bash
git add src/locales/ko.js src/locales/en.js
git commit -m "feat(automation): add reCAPTCHA modal/notification i18n strings"
```

---

## Task 4: RecaptchaModal 컴포넌트

메시지 + 카운트다운 + [확인] 버튼만 있는 순수 안내 모달. 확인을 누르면 `onClose`만 호출(배치 동작에 영향 없음). 자체 오버레이 마크업을 가져 `Modal.jsx` 의존 없이 독립 동작한다.

**Files:**
- Create: `src/components/RecaptchaModal.jsx`
- Create: `src/components/RecaptchaModal.css`
- Test: `tests/components/RecaptchaModal.test.jsx`

- [ ] **Step 1: 실패 테스트 작성**

```jsx
// tests/components/RecaptchaModal.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RecaptchaModal from '../../src/components/RecaptchaModal'

const t = (key, vars = {}) =>
  ({
    'recaptcha.title': `paused ${vars.min}`,
    'recaptcha.titleManual': 'manual',
    'recaptcha.body': `body ${vars.min}`,
    'recaptcha.bodyManual': 'body manual',
    'recaptcha.countdown': `cd ${vars.time}`,
    'recaptcha.confirm': 'OK',
  }[key] || key)

describe('RecaptchaModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<RecaptchaModal open={false} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows auto-resume title with minutes when open', () => {
    render(<RecaptchaModal open mode="auto" waitMs={300000} onClose={() => {}} t={t} />)
    expect(screen.getByText(/paused 5/)).toBeTruthy()
  })

  it('shows manual title when mode=manual', () => {
    render(<RecaptchaModal open mode="manual" onClose={() => {}} t={t} />)
    expect(screen.getByText('manual')).toBeTruthy()
  })

  it('confirm button calls onClose', () => {
    const onClose = vi.fn()
    render(<RecaptchaModal open mode="auto" waitMs={300000} onClose={onClose} t={t} />)
    fireEvent.click(screen.getByText('OK'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/RecaptchaModal.test.jsx`
Expected: FAIL — 컴포넌트 없음.

- [ ] **Step 3: 컴포넌트 구현**

```jsx
// src/components/RecaptchaModal.jsx
import { useState, useEffect } from 'react'
import './RecaptchaModal.css'

/**
 * reCAPTCHA 차단 안내 모달 — 순수 안내용.
 * props:
 *  - open: boolean
 *  - mode: 'auto' | 'manual'   ('auto'=1~3회, 'manual'=4회+)
 *  - waitMs: number            (mode='auto'일 때 카운트다운 총 길이)
 *  - onClose: () => void       (확인 클릭 시 — 모달만 닫음, 배치 영향 없음)
 *  - t: (key, vars) => string
 * 배치 중지/재개는 이 모달이 아니라 앱 본체 컨트롤이 담당한다.
 */
export default function RecaptchaModal({ open, mode = 'auto', waitMs = 0, onClose, t }) {
  const [remainMs, setRemainMs] = useState(waitMs)

  useEffect(() => {
    if (!open || mode !== 'auto') return
    setRemainMs(waitMs)
    const end = Date.now() + waitMs
    const id = setInterval(() => {
      const left = Math.max(0, end - Date.now())
      setRemainMs(left)
      if (left <= 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [open, mode, waitMs])

  if (!open) return null

  const min = Math.round(waitMs / 60000)
  const isManual = mode === 'manual'
  const mm = String(Math.floor(remainMs / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remainMs % 60000) / 1000)).padStart(2, '0')

  return (
    <div className="recaptcha-modal-overlay" role="dialog" aria-modal="true">
      <div className="recaptcha-modal">
        <h3 className="recaptcha-modal-title">
          {isManual ? t('recaptcha.titleManual') : t('recaptcha.title', { min })}
        </h3>
        <p className="recaptcha-modal-body">
          {isManual ? t('recaptcha.bodyManual') : t('recaptcha.body', { min })}
        </p>
        {!isManual && (
          <p className="recaptcha-modal-countdown">
            {t('recaptcha.countdown', { time: `${mm}:${ss}` })}
          </p>
        )}
        <button className="recaptcha-modal-confirm" onClick={onClose}>
          {t('recaptcha.confirm')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: CSS 구현**

```css
/* src/components/RecaptchaModal.css */
.recaptcha-modal-overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.recaptcha-modal {
  background: #1e2530; color: #e8ecf1;
  border-radius: 12px; padding: 28px 32px;
  max-width: 460px; width: calc(100% - 48px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.recaptcha-modal-title { margin: 0 0 14px; font-size: 1.1rem; }
.recaptcha-modal-body { margin: 0 0 16px; font-size: .92rem; line-height: 1.65; color: #c4ccd6; }
.recaptcha-modal-countdown { margin: 0 0 18px; font-size: 1rem; font-weight: 700; color: #ffd866; }
.recaptcha-modal-confirm {
  display: block; width: 100%; padding: 10px 0;
  background: #3a9a3a; color: #fff; border: none; border-radius: 8px;
  font-size: .95rem; font-weight: 700; cursor: pointer;
}
.recaptcha-modal-confirm:hover { background: #338233; }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/components/RecaptchaModal.test.jsx`
Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/components/RecaptchaModal.jsx src/components/RecaptchaModal.css tests/components/RecaptchaModal.test.jsx
git commit -m "feat(automation): add RecaptchaModal info component"
```

---

## Task 5: useAutomation 감지·escalation 연결

`runConcurrentQueue` 안에서 reCAPTCHA 실패를 감지해 기존 `pausedRef`로 배치를 일시정지하고, escalation 대기 후 자동 재개한다. 모달 상태를 훅 밖으로 노출한다.

**Files:**
- Modify: `src/hooks/useAutomation.js`
- Test: `tests/hooks/useAutomation.recaptcha.test.js`

- [ ] **Step 1: import + 상태/ref 추가**

`src/hooks/useAutomation.js` 상단 import 블록에 추가 (기존 import들 다음):

```js
import { isRecaptchaError } from '../utils/recaptchaDetect'
import { planRecaptchaWait, shouldResetIncidents } from '../services/recaptchaPolicy'
```

`useAutomation` 함수 본문, `const [statusMessage, setStatusMessage] = useState('')` 다음 줄에 추가:

```js
  // reCAPTCHA 차단 모달 상태: null 이면 닫힘
  const [recaptchaModal, setRecaptchaModal] = useState(null) // { mode:'auto'|'manual', waitMs }
```

`const batchStartedAtRef = useRef(null)` 다음 줄에 추가:

```js
  const recaptchaIncidentRef = useRef(0)      // 연속 차단 횟수
  const recaptchaHandlingRef = useRef(false)  // 한 incident 동안 핸들러 중복 실행 방지
  const lastRecaptchaAtRef = useRef(0)        // 마지막 reCAPTCHA 발생 시각 — in-flight 잔여 실패가 들어오면 갱신되어 대기 종료를 자동 연장
  const consecutiveSuccessRef = useRef(0)     // 재개 후 연속 성공 씬 수
```

- [ ] **Step 2: reCAPTCHA 차단 핸들러 작성**

`runConcurrentQueue` 함수 안, `collectCompleted` 정의 다음(`// Phase 1` 주석 앞)에 추가:

```js
    // reCAPTCHA 차단 감지 → 일시정지 + escalation 대기 + 자동 재개.
    // 한 incident 동안 여러 씬이 동시에 실패해도 incident 카운터는 1회만 증가(recaptchaHandlingRef 가드).
    // 다만 in-flight 잔여(동시 ~4개)가 시차로 실패해 들어올 때마다 lastRecaptchaAtRef 가 갱신되어,
    // 대기 종료가 자연히 "마지막 차단 + waitMs" 시점으로 밀린다.
    // (그렇지 않으면 첫 5분의 앞부분(15~30초)이 "여전히 차단당하는 중"으로 깎여 실질 휴식이 부족함.)
    const handleRecaptchaBlock = async () => {
      // 차단 발생 때마다 시각 갱신 — 이미 핸들링 중이어도 갱신만 하고 빠짐.
      lastRecaptchaAtRef.current = Date.now()
      if (recaptchaHandlingRef.current) return

      recaptchaHandlingRef.current = true
      recaptchaIncidentRef.current += 1
      consecutiveSuccessRef.current = 0

      const { waitMs, autoResume } = planRecaptchaWait(recaptchaIncidentRef.current)

      pausedRef.current = true
      setIsPaused(true)

      if (!autoResume) {
        // 4회+ → 자동 재개 안 함. 모달은 수동 모드로 떠 있고, 재개는 사용자가.
        setRecaptchaModal({ mode: 'manual', waitMs: 0 })
        setStatusMessage(t('recaptcha.notifyManual'))
        return
      }

      setRecaptchaModal({ mode: 'auto', waitMs })
      setStatusMessage(t('recaptcha.notify', { min: Math.round(waitMs / 60000) }))

      // "마지막 reCAPTCHA 이후 waitMs 만큼 조용해질 때까지" 대기.
      // in-flight 잔여 실패가 들어오면 lastRecaptchaAtRef 가 갱신돼 종료 시점이 자동으로 밀린다.
      // (모달 카운트다운은 fixed waitMs 기준으로 표시되므로 00:00 도달 후 잠시 더 머물 수 있다 — 의도된 동작.)
      while (!stopRequestedRef.current && Date.now() < lastRecaptchaAtRef.current + waitMs) {
        await new Promise(r => setTimeout(r, 500))
      }

      // 자동 재개
      setRecaptchaModal(null)
      recaptchaHandlingRef.current = false
      if (!stopRequestedRef.current) {
        pausedRef.current = false
        setIsPaused(false)
      }
    }
```

- [ ] **Step 3: collect 경로에 감지 삽입**

`collectCompleted` 안, `const result = await collectGeneration(item.generationId)` 다음 줄(현재 `console.log('[Automation] Collected scene'...)` 위)에 추가:

```js
            if (!result.success && isRecaptchaError(result.error)) {
              console.warn('[Automation] reCAPTCHA block detected on scene', item.scene.id)
              await handleRecaptchaBlock()
            }
```

- [ ] **Step 4: submit 경로에 감지 삽입**

Phase 1 루프의 submit 실패 분기(`else { ... }`, 현재 `console.error('[Automation] Submit failed...')` 블록)에서 — `consecutiveErrors++` **앞에** 추가:

```js
        if (isRecaptchaError(submitResult.error)) {
          console.warn('[Automation] reCAPTCHA block detected on submit, scene', scene.id)
          await handleRecaptchaBlock()
          continue   // 연속 submit 실패(3회 break) 카운트에 포함하지 않음
        }
```

(이 `continue`로 reCAPTCHA submit 실패는 `consecutiveErrors` 누적·강제 break 대상에서 제외된다.)

- [ ] **Step 5: 성공 시 연속 성공 카운트 + 리셋**

`collectCompleted` 안, `processAsyncResult` 호출 후 `finalizeOk` 분기에서 — `if (!finalizeOk) { errorCountRef.current++ }` 다음에 추가:

```js
            if (finalizeOk) {
              consecutiveSuccessRef.current++
              if (recaptchaIncidentRef.current > 0 && shouldResetIncidents(consecutiveSuccessRef.current)) {
                console.log('[Automation] reCAPTCHA incident counter reset after', consecutiveSuccessRef.current, 'successes')
                recaptchaIncidentRef.current = 0
              }
            } else {
              consecutiveSuccessRef.current = 0
            }
```

- [ ] **Step 6: 배치 시작 시 카운터 초기화 + 모달 상태 노출**

`runConcurrentQueue` 안 `completedCountRef.current = 0` 다음 줄에 추가:

```js
    recaptchaIncidentRef.current = 0
    recaptchaHandlingRef.current = false
    lastRecaptchaAtRef.current = 0
    consecutiveSuccessRef.current = 0
    setRecaptchaModal(null)
```

훅의 `return { ... }` 객체에 `recaptchaModal`과 닫기 함수를 추가:

```js
    recaptchaModal,
    closeRecaptchaModal: () => setRecaptchaModal(null),
```

- [ ] **Step 7: 통합 테스트 작성**

```js
// tests/hooks/useAutomation.recaptcha.test.js
import { describe, it, expect } from 'vitest'
import { isRecaptchaError } from '../../src/utils/recaptchaDetect'
import { planRecaptchaWait } from '../../src/services/recaptchaPolicy'

// useAutomation 의 reCAPTCHA 경로는 Flow IPC 의존이 커서 풀 렌더 대신
// "감지 → escalation 계획" 결합을 검증한다 (핸들러가 쓰는 두 모듈의 계약).
describe('reCAPTCHA detection → escalation integration', () => {
  it('collect 실패 메시지가 reCAPTCHA면 incident 1회 → 5분 자동대기', () => {
    const result = { success: false, error: 'reCAPTCHA evaluation failed' }
    const detected = !result.success && isRecaptchaError(result.error)
    expect(detected).toBe(true)
    expect(planRecaptchaWait(1)).toEqual({ waitMs: 300000, autoResume: true })
  })

  it('일반 timeout 은 reCAPTCHA로 처리하지 않음', () => {
    const result = { success: false, error: 'Generation timeout' }
    expect(!result.success && isRecaptchaError(result.error)).toBe(false)
  })

  it('연속 4회차는 수동 모드(autoResume=false)', () => {
    expect(planRecaptchaWait(4).autoResume).toBe(false)
  })
})
```

- [ ] **Step 8: 테스트 실행**

Run: `npx vitest run tests/hooks/useAutomation.recaptcha.test.js`
Expected: PASS (3 tests)

- [ ] **Step 9: 기존 자동화 테스트 회귀 확인**

Run: `npx vitest run tests/hooks tests/utils tests/services`
Expected: 전부 PASS — 기존 테스트가 깨지지 않음.

- [ ] **Step 10: 커밋**

```bash
git add src/hooks/useAutomation.js tests/hooks/useAutomation.recaptcha.test.js
git commit -m "feat(automation): detect reCAPTCHA block and auto-pause with escalation"
```

---

## Task 6: App.jsx에 모달 렌더 연결

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: import 추가**

`src/App.jsx`의 컴포넌트 import 블록에 추가:

```js
import RecaptchaModal from './components/RecaptchaModal'
```

- [ ] **Step 2: useAutomation 반환값 구조분해에 추가**

`App.jsx`에서 `useAutomation(...)` 호출 결과를 구조분해하는 곳에 `recaptchaModal`, `closeRecaptchaModal`를 추가한다. 예:

```js
  const {
    /* ...기존 필드... */
    recaptchaModal,
    closeRecaptchaModal,
  } = useAutomation(/* ...기존 인자... */)
```

- [ ] **Step 3: 모달 렌더**

`App.jsx`의 최상위 JSX 반환부, 다른 `*Modal` 컴포넌트들을 렌더하는 곳 근처에 추가:

```jsx
      <RecaptchaModal
        open={!!recaptchaModal}
        mode={recaptchaModal?.mode}
        waitMs={recaptchaModal?.waitMs || 0}
        onClose={closeRecaptchaModal}
        t={t}
      />
```

(`t`는 App.jsx에서 이미 쓰는 i18n 함수. 다른 모달들이 쓰는 동일 변수를 그대로 사용.)

- [ ] **Step 4: 수동 검증 (UI)**

`npm run dev`로 앱 실행 → 개발용으로 `handleRecaptchaBlock`를 임시 트리거하거나, 실제 배치에서 reCAPTCHA 발생 시:
- 모달이 메시지 + 카운트다운 + [확인] 으로 뜨는지
- [확인] 클릭 시 모달만 닫히고 배치는 계속 대기/재개되는지
- 대기 종료 시 모달이 자동으로 닫히고 배치가 재개되는지
확인. (UI 자동 테스트 불가 — 육안 확인 결과를 기록.)

- [ ] **Step 5: 커밋**

```bash
git add src/App.jsx
git commit -m "feat(automation): render RecaptchaModal wired to useAutomation"
```

---

## Task 7: OS 시스템 알림 (선택)

앱이 백그라운드일 때도 사용자가 차단을 알아채도록 OS 알림을 띄운다. Electron `Notification` 사용.

**Files:**
- Modify: `electron/main.js` (IPC 핸들러 추가)
- Modify: `electron/preload.js` (API 노출)
- Modify: `src/hooks/useAutomation.js` (`handleRecaptchaBlock`에서 호출)

- [ ] **Step 1: main 프로세스에 IPC 핸들러 추가**

`electron/main.js`의 다른 `ipcMain.handle` 등록부 근처에 추가:

```js
const { Notification } = require('electron')
ipcMain.handle('notify:os', (_e, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: String(title || 'AutoFlowCut'), body: String(body || '') }).show()
    }
  } catch (e) {
    console.warn('[notify:os] failed:', e.message)
  }
  return { ok: true }
})
```

- [ ] **Step 2: preload에 API 노출**

`electron/preload.js`의 `contextBridge.exposeInMainWorld` 노출 객체에 추가:

```js
  notifyOS: (payload) => ipcRenderer.invoke('notify:os', payload),
```

(노출 네임스페이스는 기존 preload 패턴을 따른다 — 예: 기존이 `window.electronAPI.xxx` 면 그 객체 안에 추가.)

- [ ] **Step 3: handleRecaptchaBlock에서 알림 호출**

`useAutomation.js`의 `handleRecaptchaBlock` 안 — `setStatusMessage(...)` 호출 직후 두 군데(manual 분기 / auto 분기)에 추가:

```js
      try {
        window.electronAPI?.notifyOS?.({
          title: 'AutoFlowCut',
          body: autoResume
            ? t('recaptcha.notify', { min: Math.round(waitMs / 60000) })
            : t('recaptcha.notifyManual'),
        })
      } catch { /* 알림 실패는 무시 */ }
```

(`window.electronAPI` 네임스페이스는 Step 2에서 확인한 실제 노출 객체명으로 맞춘다.)

- [ ] **Step 4: 수동 검증**

앱을 백그라운드로 두고 reCAPTCHA 차단 발생 시 OS 알림이 뜨는지 육안 확인.

- [ ] **Step 5: 커밋**

```bash
git add electron/main.js electron/preload.js src/hooks/useAutomation.js
git commit -m "feat(automation): OS notification on reCAPTCHA block"
```

---

## Task 8: reCAPTCHA Enterprise reason code 조사 및 활용 (조사 우선)

**배경 (사전지식 없이 읽어도 되도록):**
reCAPTCHA Enterprise(Flow가 쓰는 버전)는 봇 판정 시 점수(0.0~1.0)뿐 아니라 **reason code**를 함께 산출한다 — 점수가 왜 낮은지 설명하는 라벨이다. 대표 코드: `AUTOMATION`(자동화 도구 감지), `TOO_FAST`(상호작용이 비정상적으로 빠름), `SUSPECTED_ATTACKER`, `UNEXPECTED_USAGE_PATTERNS` 등. 이 코드를 알면 단순 "차단됨"이 아니라 "왜 차단됐는지"를 알 수 있어 사용자 안내와 backoff 튜닝을 더 정확히 할 수 있다.

**중요한 전제 — 결과가 두 갈래다:**
reason code는 원래 **사이트 운영자(서버)**가 받는 정보다. AutoFlowCut은 Flow를 클라이언트로서 자동화하므로, Flow API 응답이 reason code를 클라이언트까지 노출하는지는 **불확실하다.** 그래서 이 Task는 "조사 먼저, 결과에 따라 분기"다. 두 경우 모두 정상 결론이다:
- **Case A:** 응답에 구조화된 reason/reasonCodes 필드가 있음 → 추출해서 활용.
- **Case B:** 평문 문자열("reCAPTCHA evaluation failed")만 있음 → 그 사실을 문서화하고 종료. Task 1의 문자열 매칭이 최선이며 추가 코드 불필요.

현실적으로 Case B 가능성이 더 높다(클라이언트는 보통 Enterprise 평가 reason code를 못 받음). 그래도 한 번 확인할 가치는 있고, Task 5까지 구현된 뒤라야 실제 응답을 캡처할 수 있어 이 Task를 마지막에 둔다.

**Files (Case A일 때만):**
- Modify: `src/utils/recaptchaDetect.js` (reason 추출 함수 추가)
- Modify: `src/hooks/useAutomation.js` (reason을 모달/로그에 전달)
- Test: `tests/utils/recaptchaDetect.test.js`

- [ ] **Step 1: 실제 reCAPTCHA 실패 응답 캡처**

Task 1~7 구현 후, 실제 배치를 돌려 reCAPTCHA 차단을 한 번 유발한다. `src/hooks/useAutomation.js`의 `collectCompleted` 안 `const result = await collectGeneration(...)` 다음에 임시 로그를 넣는다:

```js
            if (!result.success) {
              console.log('[reCAPTCHA-investigate] full result:', JSON.stringify(result, null, 2))
            }
```

submit 경로(Phase 1 루프의 submit 실패 `else` 분기)에도 임시 로그:

```js
        console.log('[reCAPTCHA-investigate] submitResult:', JSON.stringify(submitResult, null, 2))
```

DevTools 콘솔에서 reCAPTCHA 실패 시 출력된 객체 전체를 확인한다. (electron/ipc/flow-api.js의 `collectGeneration` 반환 구조도 함께 본다.)

- [ ] **Step 2: 응답 구조 판정**

캡처한 객체에서 확인한다:
- `result.error`가 평문 문자열뿐인가?
- `result`에 `reason` / `reasonCodes` / `errorCode` / `code` / `details` / 중첩 `error` 객체 같은 구조화 필드가 있는가?
- Flow API 원응답(`aisandbox-pa.googleapis.com`)에 reCAPTCHA 관련 코드 필드가 있는가?

판정:
- 구조화 reason 필드 발견 → **Case A**, Step 3 진행.
- 평문 문자열만 → **Case B**, Step 3·4 건너뛰고 Step 5로.

- [ ] **Step 3 (Case A 전용): reason 추출 함수 + 테스트**

`src/utils/recaptchaDetect.js`에 추가 (필드 경로는 Step 2에서 확인한 실제 경로로 맞춘다 — 아래는 `result.reasonCodes` 배열을 가정한 예시):

```js
/**
 * reCAPTCHA 실패 결과에서 reason code를 추출한다. (Case A 전용)
 * @param {object} result  collectGeneration/submitGenerationDOM 반환 객체
 * @returns {string[]}  reason code 배열 (없으면 빈 배열)
 */
export function getRecaptchaReasons(result) {
  if (!result || typeof result !== 'object') return []
  const codes = result.reasonCodes ?? result.reason ?? []
  return Array.isArray(codes) ? codes.map(String) : [String(codes)]
}
```

테스트 `tests/utils/recaptchaDetect.test.js`에 추가:

```js
import { getRecaptchaReasons } from '../../src/utils/recaptchaDetect'

describe('getRecaptchaReasons', () => {
  it('extracts reasonCodes array', () => {
    expect(getRecaptchaReasons({ reasonCodes: ['AUTOMATION', 'TOO_FAST'] }))
      .toEqual(['AUTOMATION', 'TOO_FAST'])
  })
  it('returns [] when no reason field', () => {
    expect(getRecaptchaReasons({ error: 'reCAPTCHA evaluation failed' })).toEqual([])
  })
  it('returns [] for non-object input', () => {
    expect(getRecaptchaReasons(null)).toEqual([])
  })
})
```

Run: `npx vitest run tests/utils/recaptchaDetect.test.js`
Expected: PASS (Task 1의 5개 + 신규 3개 = 8 tests)

- [ ] **Step 4 (Case A 전용): reason을 모달·로그에 노출**

`useAutomation.js`의 `handleRecaptchaBlock`에서 `getRecaptchaReasons(...)`로 추출한 코드를 `console.warn`으로 남기고, 모달 상태 객체에 `reasons` 필드로 실어 보낸다. `RecaptchaModal`(Task 4)의 본문 아래에 "감지 사유: AUTOMATION, TOO_FAST" 식 한 줄을 추가한다 — 모달 형태는 그대로(메시지 + [확인]), reason 한 줄만 덧붙임.

- [ ] **Step 5 (Case A·B 공통): 임시 로그 제거 + 결과 문서화**

Step 1에서 넣은 `[reCAPTCHA-investigate]` 임시 로그 2개를 제거한다.
조사 결과를 `src/utils/recaptchaDetect.js` 상단 주석에 한 줄로 기록한다:
- Case A 예: `// 조사(2026-..): Flow 응답 result.reasonCodes 에 Enterprise reason code 노출됨 → getRecaptchaReasons 사용.`
- Case B 예: `// 조사(2026-..): Flow 응답은 평문 result.error 문자열만 제공 — 클라이언트에 reason code 미노출. 문자열 매칭이 최선.`

- [ ] **Step 6: 커밋**

```bash
# Case A:
git add src/utils/recaptchaDetect.js tests/utils/recaptchaDetect.test.js src/hooks/useAutomation.js src/components/RecaptchaModal.jsx
git commit -m "feat(automation): extract and surface reCAPTCHA reason codes"

# Case B (문서화만):
git add src/utils/recaptchaDetect.js
git commit -m "docs(automation): document Flow exposes no reCAPTCHA reason codes"
```

---

## Self-Review

**1. Spec coverage** — 확정 설계 대비:
- reCAPTCHA 감지(버튼 아닌 응답 기반) → Task 1 + Task 5 Step 3·4 ✓
- escalation 5/10/30분, 4회+ 수동 → Task 2 + Task 5 Step 2 ✓
- incident "1회 = 차단 1건"(타일 수 무관) → `recaptchaHandlingRef` 가드, Task 5 Step 2 ✓
- 재개 후 연속 성공 시 카운터 리셋 → Task 2 `shouldResetIncidents` + Task 5 Step 5 ✓
- 첫 재개 씬 = probe → 별도 코드 불필요: 재개 후 루프가 자연히 다음 씬 제출, 또 실패하면 핸들러 재발동 (`recaptchaHandlingRef` 가 재개 시 false로 풀림, Task 5 Step 2) ✓
- in-flight 잔여(동시 ~4개) 시차 실패로 첫 5분의 앞부분이 "여전히 차단당하는 시간"으로 깎이는 문제 → `lastRecaptchaAtRef` 로 "마지막 차단 시점 + waitMs" 기준 대기 (Task 5 Step 2) ✓
- 모달 = 메시지 + 확인, 확인은 모달만 닫음 → Task 4 ✓
- 1~3회 자동 닫힘 → `handleRecaptchaBlock` 대기 종료 시 `setRecaptchaModal(null)` ✓
- 4회+ 액션 요구 모달, 수동 재개 → Task 4 `mode='manual'` + Task 5 autoResume=false 분기 ✓
- 중지/재개는 앱 기존 컨트롤 → 모달에 해당 버튼 없음, `pausedRef`/`stopRequestedRef` 기존 메커니즘 재사용 ✓
- OS 알림 → Task 7 ✓
- reCAPTCHA reason code 정밀 감지 → Task 8 (조사 후 Case A/B 분기) ✓

**2. Placeholder scan** — "TBD/적절히 처리" 류 없음. 모든 코드 스텝에 실제 코드 포함. Task 6 Step 2·3과 Task 7 Step 2·3은 "기존 패턴을 따른다"는 지시가 있는데, 이는 App.jsx의 기존 useAutomation 구조분해 위치·preload 네임스페이스가 리포지토리 현 상태에 종속적이라 불가피한 부분 — 구체적 치환 대상(추가할 키 이름·코드)은 모두 명시됨.

**3. Type consistency** — `recaptchaModal` 객체 형태 `{ mode, waitMs }`가 Task 5(생성)·Task 4(소비, props `mode`/`waitMs`)·Task 6(렌더)에서 일치. `planRecaptchaWait` 반환 `{ waitMs, autoResume }`가 Task 2·5에서 일치. `isRecaptchaError(string)` 시그니처가 Task 1·5에서 일치.

**알려진 한계 (의도된 범위 밖):**
- in-flight ~4개 씬은 한 incident에서 같이 실패함 — `recaptchaHandlingRef` 가드로 incident 카운터는 1회만 증가하지만, 그 4개 씬은 error로 마킹됨. 재개 후 사용자가 "실패 씬만 재시도"로 처리 (기존 retry 기능). 설계 합의대로임.
- 모달 카운트다운은 fixed `waitMs` 기준 표시이므로 in-flight 추가 실패로 실제 대기가 연장될 경우 카운트다운이 00:00에 도달한 뒤 잠시(보통 <30초) 더 머문 뒤 닫힌다. 동작상 문제는 없고, 정밀 카운트다운이 필요하면 후속 작업에서 모달에 `waitEnd` 갱신 prop을 추가하면 됨.
- 레퍼런스/비디오 생성은 범위 밖 — Task 1·2 모듈 재사용해 후속 플랜에서.
