// electron/flow-compose-mention.js
//
// #R36: Flow 컴포저(Slate 에디터)에 @멘션 칩 + 텍스트를 주입하는 공용 헬퍼.
//   이미지 씬(flow:generate-scene)과 T2V 비디오(flow:generate-video-t2v)가 동일하게 재사용한다.
//   원래 character.js 안의 클로저였던 것을 순수 함수로 추출(flowView 를 인자로 받음).

import {
  CLICK_CHARACTER_TAB,
  hasMentionOption,
  dispatchMentionOption,
  chipCheck,
  MENTION_PROBE,
} from './flow-mention-dom.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Slate 컴포저 에디터 셀렉터 (generate-image 와 동일 우선순위).
export const EDITOR_SELECTOR = `(function(){
  return document.querySelector("[data-slate-editor='true']")
    || document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)")
    || document.querySelector('[contenteditable="true"]:not([aria-hidden])')
    || document.querySelector('textarea');
})()`

/** 컴포저에 일반 텍스트를 append(execCommand insertText). */
export async function appendSceneText(flowView, text) {
  return flowView.webContents.executeJavaScript(`
    (async function(){
      const t = ${JSON.stringify(text)};
      const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
      const e = ${EDITOR_SELECTOR};
      if(!e) return false;
      e.focus();
      try { const s=window.getSelection(); s.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(e); r.collapse(false); s.addRange(r); } catch {}
      try { e.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:t})); } catch {}
      const ok = document.execCommand('insertText', false, t);
      try { e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t})); } catch {}
      await sleep(120);
      return !!ok;
    })()
  `).catch(() => false)
}

/** `@이름` 멘션 한 건 삽입: @ 트러스트 키입력 → 피커 → "캐릭터" 탭 → 이름매칭 option 선택. */
export async function insertSceneMention(flowView, name) {
  // 1) "@" 를 트러스트 키 입력으로 친다 — execCommand 주입은 멘션 피커를 트리거 못 함(isTrusted 필요).
  try {
    flowView.webContents.focus()
    flowView.webContents.sendInputEvent({ type: 'keyDown', keyCode: '@' })
    flowView.webContents.sendInputEvent({ type: 'char', keyCode: '@' })
    flowView.webContents.sendInputEvent({ type: 'keyUp', keyCode: '@' })
  } catch (e) { console.warn('[Flow Compose] sendInputEvent @ failed:', e.message) }

  // 2) 피커(div[role=dialog]) 열림 대기.
  let hasDialog = false
  for (let i = 0; i < 20 && !hasDialog; i++) {
    await sleep(250)
    hasDialog = await flowView.webContents.executeJavaScript(`!!document.querySelector("div[role='dialog']")`).catch(() => false)
  }
  if (!hasDialog) { console.warn('[Flow Compose] mention picker(dialog) 안 열림 (nameLen:', name?.length ?? 0, ')'); return false }

  // 3) "캐릭터" 탭 클릭 — 기본 "모두" 탭은 이미지가 다수라 가상화로 캐릭터 entity 가 렌더 안 됨.
  const tabClicked = await flowView.webContents.executeJavaScript(CLICK_CHARACTER_TAB).catch(() => false)
  if (!tabClicked) console.warn('[Flow Compose] 캐릭터 탭을 못 찾음 — "모두" 탭에서 검색으로 진행')
  await sleep(500)

  // 3.5) 검색창에 이름 입력해 필터링(가상화 스크롤 회피). value 직접 set(한글 IME 우회) + input 이벤트.
  await flowView.webContents.executeJavaScript(`(function(){
    const dlg = document.querySelector("div[role='dialog']"); if(!dlg) return false;
    const inp = dlg.querySelector("input[type='text']") || dlg.querySelector("input");
    if(!inp) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, ${JSON.stringify(name)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`).catch(() => false)
  await sleep(600)

  // 4) 이름매칭 option 폴링. 옵션 라벨은 "이름 + 타입라벨"(ko: Zed2캐릭터 / en: Zed2Character)이라
  //    통짜 textContent 로 비교하면 로케일에 묶인다 — 이름 leaf 만 읽는다(flow-mention-dom.js).
  let found = false
  for (let i = 0; i < 16 && !found; i++) {
    await sleep(300)
    found = await flowView.webContents.executeJavaScript(hasMentionOption(name)).catch(() => false)
  }
  if (!found) {
    // 프로브는 이름을 담지 않는다(길이만) — main 의 console 은 Sentry breadcrumb 이 된다.
    const probe = await flowView.webContents.executeJavaScript(MENTION_PROBE).catch((e) => ({ probeError: e.message }))
    console.warn('[Flow Compose] mention option not found — nameLen:', name?.length ?? 0, 'probe:', JSON.stringify(probe))
    return false
  }

  // 5) 매칭 옵션에 pointer/mouse/click 시퀀스 디스패치(Radix onSelect).
  const dispatched = await flowView.webContents.executeJavaScript(dispatchMentionOption(name)).catch(() => false)
  await sleep(500)
  let dialogClosed = !(await flowView.webContents.executeJavaScript(`!!document.querySelector("div[role='dialog']")`).catch(() => true))
  if (!dialogClosed) {
    console.warn('[Flow Compose] option dispatch did not close picker — trying Enter')
    try {
      flowView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      flowView.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
      flowView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    } catch {}
    await sleep(500)
    dialogClosed = !(await flowView.webContents.executeJavaScript(`!!document.querySelector("div[role='dialog']")`).catch(() => true))
  }
  // 칩 삽입 검증: 칩 텍스트에 이름이 들어갔는지로 판정(Enter 폴백의 거짓 성공 차단).
  // post 는 길이·불리언만 담는다(chipCheck 참고) — 이름은 nameLen 으로만 찍는다.
  const post = await flowView.webContents.executeJavaScript(chipCheck(EDITOR_SELECTOR, name)).catch((e) => ({ probeError: e.message }))
  const ok = !!(dialogClosed && post && post.hasMentionChip)
  if (!ok) console.warn('[Flow Compose] mention select incomplete — nameLen:', name?.length ?? 0, JSON.stringify({ dispatched, dialogClosed, post }))
  return ok
}

/**
 * 컴포저를 비우고 segments(text/mention)를 순서대로 주입한다. 이미지 씬·T2V 공용.
 * @returns {Promise<{ok:true} | {ok:false, error:string, staleMention?:string}>}
 */
export async function injectComposeSegments(flowView, segs) {
  // 기존 텍스트 클리어(빈 컴포저에서 시작)
  await flowView.webContents.executeJavaScript(`(function(){try{const e=${EDITOR_SELECTOR}; if(e){e.focus(); const s=window.getSelection(); s.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(e); s.addRange(r); document.execCommand('delete',false,null);}}catch{}})()`).catch(() => {})
  await sleep(100)
  for (const seg of segs || []) {
    if (seg.type === 'mention') {
      const ok = await insertSceneMention(flowView, seg.name)
      // 멘션 피커에 캐릭터가 없으면(Flow UI 삭제 등) staleMention 신호 → 렌더러가 재등록(self-heal).
      if (!ok) return { ok: false, error: '멘션 선택 실패: ' + seg.name, staleMention: seg.name }
    } else if (seg.type === 'text' && seg.text) {
      const ok = await appendSceneText(flowView, seg.text)
      if (!ok) return { ok: false, error: '텍스트 주입 실패' }
    }
  }
  return { ok: true }
}
