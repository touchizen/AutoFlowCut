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

// ── 페이지 단계 함수 ───────────────────────────────
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
      const mainImgs = document.querySelectorAll('main img');
      const last = mainImgs.length
        ? mainImgs[mainImgs.length - 1]
        : (document.images && document.images.length ? document.images[document.images.length - 1] : null);
      try { if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' }); } catch (e) {}
      try { console.log(P, tag, imgs.length); } catch (e) {}
      return {
        imgs: imgs,
        href: location.href,
        alerts: document.querySelectorAll('[role="alert"]').length,
      };
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
    // submitPresent 는 관측/로그용이다(스펙 §3-F 의 \`|| !submitPresent\` 는 D3 에서 폐기).
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

// ── main 측 trusted 입력(fallback) ──────────────────────────────────
// 하드코딩 프롬프트는 ASCII 로 고정한다: fallback B 가 char 이벤트로 한 글자씩 치는데
// 비-ASCII(한글)는 IME 경유라 신뢰할 수 없다(플랜 D2).
// 이미지 생성을 **명시적으로** 요구해야 한다 — 명사구만 던지면 ChatGPT 가 텍스트로 답해
// 이미지가 영영 안 나오고, 상태기계는 120s 를 폴링하다 'poll deadline' 으로 끝난다.
export const SPIKE_PROMPT = 'Generate an image of a single red apple on a white background'

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
  log.info?.(P, 'baseline href:', base.value.href)
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
  let alertsWarned = false
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
          } else if (ack2.composerCleared === true) {
            log.info?.(P, 'Enter fallback skipped — prompt is gone on re-check')
            enterTried = true
            submittedAck = true
          } else {
            log.info?.(P, 'Enter fallback deferred — ack2 re-check indeterminate')
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
    const alerts = Number(pollR.value?.alerts)
    if (!alertsWarned && alerts > 0) {
      alertsWarned = true
      // log 은 main.js 가 { error, info } 만 넘긴다 — warn 을 쓰면 실앱에서 조용히 사라진다.
      log.info?.(P, 'WARN page alerts detected:', alerts, 'href:', pollR.value?.href)
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
      log.info?.(P, `accepted image id=${p.id} ${p.w}x${p.h} inject=${injectMethod} submit=${submitMethod} href=${pollR.value.href} src=${p.src}`)
      return { ok: true, src: p.src, id: p.id, injectMethod, submitMethod }
    }
    lastPollId = p ? p.id : null
  }
  log.error?.(P, 'deadline exceeded; submittedAck =', submittedAck, 'lastPollId =', lastPollId)
  return { ok: false, stage: submittedAck ? 'poll' : 'submit', detail: 'deadline' }
}
