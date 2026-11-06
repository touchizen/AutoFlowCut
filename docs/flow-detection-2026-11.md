# Flow 페이지 조작과 감지 대응 조사 (2026-11-06)

## 조사 범위와 사실

기준 커밋 `211a7793`. 지정 브리프와 레포 AGENTS.md·CLAUDE.md를 읽고 구현 전에 작성했다. 실제 Flow 페이지에는 접속하거나 생성 요청을 보내지 않았다. 사용 중인 앱을 종료·재시작하지 않았다.

사용자가 본 ‘비정상적인 활동이 감지되었습니다. 페이지를 수정하는 브라우저 확장 프로그램으로 인해 문제가 발생할 수 있습니다’는 감지 증거다. 어떤 조작이 원인인지 로컬 코드만으로 확정할 수 없다. `2c74b6bb`는 CDP attach 때 UI/응답이 막혔다고 기록한다. CDP 복귀는 제외한다. 브리프가 인용한 과거 옵션과 달리, 기준 main의 electron 소스에는 해당 옵션이나 CDP 호출이 남아 있지 않다. 새 경로도 추가하지 않는다.

CLAUDE.md의 ‘Flow 제거됨’ 설명은 현재 코드와 다르다. 현재 Flow 모드는 `flow-angular.js`로 강제 디스패치하며, 구형 생성 함수는 대부분 미등록이다. 새 batchexecute 요청 본문은 수정하지 않는다. 그러나 항상 설치되는 **두 fetch 래퍼**, XHR 프로토타입 래퍼와 진단 전역은 남아 있다.

## 원인 후보 순위 (추정과 관측 구분)

1. **전역 fetch/XHR 교체**: `main.injectRpcCapture`가 dom-ready/SPA/로드 후 설치한다. `FLOW_RPC_CAPTURE_INJECTION`은 `XMLHttpRequest.prototype.open/send`, `window.fetch`, 함수 name/toString, XHR 인스턴스 속성을 바꾼다. 별도로 `FLOW_PAGE_INJECTION`이 fetch를 다시 감싸고 전역 버퍼·설정을 만든다. 페이지는 참조·프로토타입·own property·Function.prototype.toString 차이를 관측할 수 있다. 현재 새 Flow 경로에서도 존재하는 확실한 조작이다. 감지를 촉발했는지는 미확인.
2. **합성 이벤트·직접 편집기 변경**: `.click()`, dispatchEvent, execCommand, value setter, DOM selection과 focus. 합성 이벤트의 isTrusted=false, 이벤트 순서·편집기 상태를 페이지가 관측한다. 이미 제출/주요 버튼은 sendInputEvent를 사용하지만 설정은 합성 클릭을 먼저 시도한다.
3. **연속 제출과 실패 뒤 진행**: 이미지/영상 자동화가 다음 항목을 계속 보낼 수 있다. RPC 일반 오류가 연속되어도 감지 전용 circuit breaker는 없다. 총 44장 뒤 실패했다는 기록은 속도·누적 제한 양쪽과 양립한다.
4. **구형 요청 본문과 UI 불일치**: FLOW_PAGE_INJECTION의 seed/aspect/imageInputs, T2V→I2V 엔드포인트·모델·시작/종료 프레임·길이 덮어쓰기. 구형 경로에 높은 위험이지만 현재 Angular 제출은 해당 변조 분기를 사용하지 않으므로 이번 직접 원인이라는 근거는 약하다.
5. **부수적인 흔적**: electronAPI contextBridge, WIZ 토큰 읽기, 페이지 컨텍스트 읽기 RPC, 세션 fetch, settings dumper 전역, 네트워크 진단 전역, paste 리스너. 자체로 감지됐다는 근거는 없다.

RPC code 8/RESOURCE_EXHAUSTED는 자원·일일 한도 분류다. 감지 문구가 없으면 감지라고 단정하지 않는다. 연속 중립 RPC 오류는 별도 ‘연속 오류로 정지’ 사유다. Pro 약 100장/2.1 약 360장은 브리프의 과거 관측치이며 확정한 서비스 한도가 아니다.

## 조작 목록과 대안

모든 `executeJavaScript`는 기본 **메인 월드**다. contextIsolation:true는 preload만 격리하며 executeJavaScript를 격리하지 않는다. 기준 main에는 executeJavaScriptInIsolatedWorld 호출이 없다(아래 구현 상태와 구분). preload 자체는 격리 월드지만 contextBridge.exposeInMainWorld의 electronAPI는 페이지에서 보인다. sendInputEvent, session.webRequest/will-download, main 메모리·뮤텍스·input shield는 메인 프로세스이고 페이지 JS 전역을 교체하지 않는다. 입력·다운로드·네트워크 자체는 페이지에서 관측된다.

| 파일 / 함수·스크립트 | 월드 / 흔적 | 대안 및 위험 |
|---|---|---|
| main.makeFlowView, injectRpcCapture, injectNetTrace / flow-page-injection.FLOW_PAGE_INJECTION | 메인 월드; fetch 교체·toString 위장·__autoflowcut_* 버퍼·본문/URL 변조 | 기본 설치 제거; 구형 호환은 opt-in. 모델·비율·개수·길이는 Flow 설정 UI 사용. seed와 구형 I2V 강제 변환은 대체 불가하면 제출 전 거부 |
| flow-rpc-capture.FLOW_RPC_CAPTURE_INJECTION | 메인 월드; XHR open/send, fetch 교체·함수 own property·XHR.__af_rpc·doc/seq 전역 | DOM에서 새 결과를 읽고 정상 다운로드. DOM은 RPC send/응답/미디어UUID 검증과 동등하지 않으므로 확인 가능한 단순 이미지부터 제한 |
| flow-preload의 exposeInMainWorld | 격리 preload → 메인 전역 electronAPI | 기본 DOM 경로는 bridge 노출 생략. 명시적 기존 캡처 모드에서만 허용 |
| main.makeFlowView 부트스트랩 | 메인 월드; 랜딩/동의/Enter Tool .click(), WIZ/세션/프로젝트 읽기, settings dumper | 안전 모드는 자동 동의/랜딩 조작 생략, 사용자 수동 진입. 읽기는 격리 월드로 이동. 로그인 페이지에서 자동 조작 금지 |
| main.setFlowPageInject/clearFlowPageInject/getApiBase | 메인 월드; 설정 전역 쓰기/읽기 | 전역 쓰기는 호환 플래그 뒤, 안전 경로는 UI만 사용 |
| ipc/shared.trustedClickLocked | 메인 월드 DOM 위치/elementFromPoint 판독·scrollIntoView; main sendInputEvent mouseMove/down/up | 좌표 판독을 격리 월드로. DOM 스크롤/포커스도 관측 가능. 히트테스트·beforeDispatch·뮤텍스는 유지 |
| ipc/shared.readFlowSession / flow-session.buildSessionProbeJs | 메인 월드 fetch: 세션 읽기 요청 | 새 도메인에서는 URL/DOM 로그인 상태만 확인. 토큰을 필요로 하는 호환 경로는 opt-in |
| ipc/shared.flowPageFetch/getRecaptchaToken | 메인 월드 fetch·grecaptcha 접근 | 안전 경로에서 호출하지 않음. 정상 UI 제출이 토큰과 요청을 생성 |
| ipc/shared.configureFlowMode/switchFlowToVideoMode/closeAgentPanels/applyAgentDefaults/listAgentModels | 메인 월드; Pointer/Mouse/Keyboard 합성 이벤트·라디오 .click()·settings panel 열기 | 격리 월드 판독 + sendInputEvent 클릭. 목록만 읽더라도 패널 열기/닫기는 UI 변경 |
| flow-composer-settings.settingsDriverCore/runSettingsDriver/SETTINGS_DRIVER_JS/applyComposerSettings | 메인 월드; 합성 라디오/모델 클릭, Escape 이벤트, UI 재판독 | 기존 플래너/검증을 재사용하되 safe 경로는 모든 클릭을 main trustedClick으로 수행. DOM 구조 변화는 fail-closed |
| ipc/flow-angular.SET_EDITOR_TEXT_JS/generateImage/submitVideo | 메인 월드; selection·focus·execCommand delete/insertText. 제출은 sendInputEvent | safe 입력은 keyDown/keyUp/char로 교체하고 격리 월드 재판독. 한글·줄바꿈·OS key-lock 경합을 단위/통합 검증 |
| flow-reference-driver.FLOW_PASTE_OBSERVER_INJECTION, APPEND_EDITOR_TEXT_JS, clearComposer/insertMention/appendText/composeReferencePlan | 메인 월드; paste capture 리스너·상태 전역·execCommand·Escape. native paste는 main | 업로드 maseQ UUID와 asb token 연결은 DOM만으로 증명 불가. 기존 기능을 명시적 호환 플래그 뒤에 남기며 safe 경로는 미지원 레퍼런스를 제출 전에 거부 |
| flow-compose-mention.appendSceneText/insertSceneMention/injectComposeSegments 및 flow-mention-dom | 메인 월드; execCommand·선택·합성 멘션/탭 이벤트; 일부 키 sendInputEvent | safe 경로는 plain text부터 지원. 기존 멘션 합성은 opt-in |
| flow-character-name.FLOW_APPLY_NAME_PROBE | 메인 월드; value setter·input/change·이름 변경 | trusted 입력+UI 저장 필요. safe 경로는 기존 이름쓰기 IPC를 차단 |
| ipc/character의 injectPrompt/캐릭터 생성·업로드·이름/멘션 경로 | 메인 월드; File/DataTransfer·file input·value·execCommand·버퍼 reset·본문 inject | 새 UI reference driver도 capture UUID 의존. safe 경로는 제출/변경 전 거부. 실제 사용자 파일/클립보드는 건드리지 않음 |
| ipc/flow-api의 미등록 legacyGenerateImage | 메인 월드; .click, 편집기/textarea setter, input/beforeinput/change, blob→canvas, 본문 inject | 현재 미등록. 되살리지 않음. body 변조는 플래그 뒤에서만 설치 |
| ipc/flow-api의 collect/check/DOM 다운로드 | 메인 월드; 읽기 프로브, hover/Pointer/Mouse/ArrowRight/Escape 이벤트·메뉴 클릭 | 격리 DOM 결과+trusted 다운로드; 결과 매칭 모호/시간 초과는 재생성하지 않고 수동 확인 안내 |
| ipc/video의 미등록 legacy T2V/I2V·Agent ON | 메인 월드; 본문 inject, 에디터 텍스트·합성 이벤트·blob fetch/앵커 다운로드 | UI 설정을 쓰는 Angular 경로가 이미 대체. safe 영상 상태/미디어UUID를 DOM으로 신뢰할 수 없으면 제출 전 거부 |
| ipc/dom의 inspect/probe/execute/select/type/download | 메인 월드; 임의 스크립트·execCommand·input/change·canvas 판독 | 임의 실행 IPC는 호환 opt-in. 안전 DOM 경로는 고정된 읽기 프로브만 제공 |
| flow-video-download.NAVIGATE_JS/RETURN_IF_ON_JS/driveEditorDownload | 메인 월드; history.replaceState·합성 popstate·Escape. 실제 메뉴 클릭은 main | 실제 카드/뒤로가기 trusted click으로 교체 필요. 정상 session will-download는 재사용 가능하지만 video MIME·title·resolution 필터는 이미지에 그대로 쓸 수 없음 |
| flow-rpc-client.callFlowRpc | 메인 월드; WIZ 읽기·XMLHttpRequest 읽기 RPC(jwpduf/as29s 등), 별도 네트워크 | safe 경로에서는 사용하지 않음. 영상 generationId/상태·업로드 id의 DOM 대체는 미확인 |
| flow-agent-toggle/flow-composer-dom/flow-composer-refs/flow-submit-gate/flow-media-collect/flow-dom-dump | 직렬화되어 호출하는 메인 월드의 주로 읽기 함수; 일부 cloneNode는 분리된 복제본만 변경 | 순수 DOM 판독은 격리 월드로 그대로 이동 가능. 선택자만 맞아도 결과의 소유권이 보장되지는 않음 |
| flow-settings-dumper.FLOW_SETTINGS_DUMPER / flow-xhr-capture.FLOW_XHR_CAPTURE_INJECTION | 메인 월드 전역 함수·상태·추가 fetch/XHR 교체, innerHTML/outerHTML 진단 | 기본 설치 제거. 진단도 명시적 opt-in. 사용자의 프롬프트/쿠키/토큰은 새 로그에 남기지 않음 |
| flow-mode-tab.buildSelectModeScript / flowOpenRetry | 메인 월드; 탭 .click/합성 이벤트 또는 readiness 판독 | safe 설정 드라이버에서 trusted 클릭; read probe는 격리 |
| ipc/mcp | 앱 renderer(mainWindow) executeJavaScript로 앱 액션 전달 | Flow 원격 페이지 조작 아님. 원격 생성은 공통 IPC 정지 관문을 통과해야 함 |

아래 부록은 electron 전체를 직접 검색한 호출 위치다. 템플릿 안의 코드는 호출부 외에도 위 표의 스크립트 생성 파일에서 확인했다. mainWindow.webContents 호출은 앱 renderer이며 Flow 페이지와 구별했다.

## 구현 설계·대안 선택

A. 기존 캡처를 유지하고 속도만 낮추기: 기능 회귀가 적지만 전역 교체가 그대로다.
B. **기본 DOM 자동화 + 기능별 명시적 호환 옵션**: 메인 월드 래퍼/본문 변조를 기본 제거하고, 검증 가능한 UI·DOM·다운로드만 사용한다. 현재 DOM의 asb 토큰은 RPC UUID와 동등하지 않으므로 unsupported를 명확히 반환한다. 목표 대안이다. 다만 아래 최종 구현에서는 DOM 소유권 증거 부족 때문에 응답 캡처를 유지했고, 완전한 기본 DOM 생성 경로를 완성하지 않았다.
C. CDP/새 네트워크 중계: 브리프의 CDP 금지와 맞지 않거나 응답 본문 API가 없어 제외한다. Electron webRequest는 응답 본문을 제공하지 않는다.

작업 순서는 (a) 감지 문구/연속 오류 circuit breaker·간격 설정·사용자 알림, (b) 기본 본문 변조 제거/기존 UI 설정 유지, (c) 격리 DOM 결과 캡처와 정상 다운로드 또는 증명 불가능한 경우 제출 전 거부, (d) native 입력이다. 각 코드 변경은 실패 테스트를 먼저 실행하고 단위+통합 검증한다. 사용자가 이미 이 순서와 구현을 지시했으므로 추가 승인 절차를 만들지 않는다.

## 아직 동등하게 대체할 수 없는 기능

- seed 고정, UI 미제공 videoModelKey/임의 길이/종료 프레임/endpoint 강제, imageInputs 직접 조립: 같은 결과로 조용히 강등하지 않는다.
- maseQ 업로드 UUID ↔ asb 썸네일 토큰의 소유권, 멘션 순서와 서버 요청 필드, 생성 응답 모델키/거절 mediaId 검증.
- 영상 작업의 generationId·실패 state 4·상태 폴/복구/고해상도 편집 화면 연결: 기존 RPC 식별자 없이는 동일 신뢰도로 대체할 수 없다.
- 단순 DOM 결과도 기존/외부 생성 결과와의 혼동·가상화·여러 새 카드·실패 배너·탭 변경을 검증해야 한다. 관측 불가면 fail-closed. 감지 회피나 성공을 보장하지 않는다.

## 검증·운영 기록 (작업 중 갱신)

- 이전 실행의 최초 검사 기록은 10,346 통과 / 3 실패 / 56 건너뜀(총 10,405)이었다. 이번 main 재검사는 10,347 통과 / 3 실패 / 55 건너뜀. smoke의 시스템 FFmpeg 9가 제거한 filter_complex_script 옵션 때문에 3건 실패했다. vendor 바이너리의 별도 임시 symlink를 AFC_TEST_FFMPEG로 지정한 동일 main 재검사는 10,350 통과 / 55 건너뜀 / 실패 0(총 10,405)이다. 테스트 소스나 제품 렌더링 코드는 바꾸지 않았다.
- 실제 Flow 시험은 수행하지 않는다. 이후 사용자와 1장 → 3장, 최소 60초+0~15초 지연, 감지/첫 연속 오류 정지·다운로드 소유권·모델/비율 일치 확인. 감지 시 재시도 없이 중단한다.

## 부록: 호출 위치 전수 검색 (기준 커밋)


### electron/flow-agent-defaults.js

```text
110: el.dispatchEvent(new PointerEvent('pointerover', c));
111: el.dispatchEvent(new PointerEvent('pointermove', c));
112: el.dispatchEvent(new PointerEvent('pointerdown', c));
114: el.dispatchEvent(new MouseEvent('mouseover', c));
115: el.dispatchEvent(new MouseEvent('mousemove', c));
116: el.dispatchEvent(new MouseEvent('mousedown', c));
117: el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
118: try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {}
119: el.dispatchEvent(new MouseEvent('mouseup', c));
120: el.dispatchEvent(new MouseEvent('click', c));
122: } catch { try { el.click(); return true; } catch { return false; } }
179: try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch {}
237: document.body.dispatchEvent(new KeyboardEvent('keydown', {
273: const humanClick = (el) => { if (!el) return false; try { const r = el.getBoundingClientRect(); const x = r.left + r.width/2, y = r.top + r.height/2; const c = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; try { el.dispatchEvent(new PointerEvent('pointerdown', c)); } catch {} el.dispatchEvent(new MouseEvent('mousedown', c)); try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {} el.dispatchEvent(new MouseEvent('mouseup', c)); el.dispatchEvent(new MouseEvent('click', c)); return true; } catch { try { el.click(); return true; } catch { return false; } } };
294: try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch {}
302: for (let i = 0; i < 10; i++) { if (!document.body.contains(panel) || !isVis(panel)) break; try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, composed: true })); } catch {} await sleep(150); }
```

### electron/flow-agent-toggle.js

```text
345: try { el.dispatchEvent(new PointerEvent('pointerdown', c)); } catch {}
346: el.dispatchEvent(new MouseEvent('mousedown', c));
347: try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {}
348: el.dispatchEvent(new MouseEvent('mouseup', c));
349: el.dispatchEvent(new MouseEvent('click', c));
350: } catch { try { el.click(); } catch {} }
```

### electron/flow-character-name.js

```text
45: el.dispatchEvent(new Event('input', { bubbles: true }));
46: el.dispatchEvent(new Event('change', { bubbles: true }));
48: return { ok: el.value === name, value: el.value };
```

### electron/flow-compose-mention.js

```text
44: if (await flowView.webContents.executeJavaScript(CHAR_FILTER_ACTIVE_EXPR).catch(() => false)) return true
46: const hasFilter = await flowView.webContents.executeJavaScript(`!!(${FILTER_TRIGGER_EXPR})`).catch(() => false)
56: hasItem = await flowView.webContents.executeJavaScript(`!!(${CHAR_MENUITEM_EXPR})`).catch(() => false)
66: applied = await flowView.webContents.executeJavaScript(CHAR_FILTER_ACTIVE_EXPR).catch(() => false)
82: return flowView.webContents.executeJavaScript(`
90: try { e.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:t})); } catch {}
91: const ok = document.execCommand('insertText', false, t);
92: try { e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t})); } catch {}
116: hasDialog = await flowView.webContents.executeJavaScript(`!!document.querySelector("div[role='dialog']")`).catch(() => false)
126: let tabClicked = await flowView.webContents.executeJavaScript(CLICK_CHARACTER_TAB).catch(() => false)
133: const probe = await flowView.webContents.executeJavaScript(MENTION_PROBE).catch((e) => ({ probeError: e.message }))
140: const searchEntered = await flowView.webContents.executeJavaScript(`(function(){
146: inp.dispatchEvent(new Event('input', { bubbles: true }));
150: const probe = await flowView.webContents.executeJavaScript(MENTION_PROBE).catch((e) => ({ probeError: e.message }))
162: const optionState = await flowView.webContents.executeJavaScript(hasMentionOption(name)).catch(() => null)
168: const probe = await flowView.webContents.executeJavaScript(MENTION_PROBE).catch((e) => ({ probeError: e.message }))
182: const dispatched = await flowView.webContents.executeJavaScript(dispatchMentionOption(name)).catch(() => false)
184: let dialogClosed = !(await flowView.webContents.executeJavaScript(`!!document.querySelector("div[role='dialog']")`).catch(() => true))
193: dialogClosed = !(await flowView.webContents.executeJavaScript(`!!document.querySelector("div[role='dialog']")`).catch(() => true))
197: const post = await flowView.webContents.executeJavaScript(chipCheck(EDITOR_SELECTOR, name)).catch((e) => ({ probeError: e.message }))
215: await flowView.webContents.executeJavaScript(`(function(){try{const e=${EDITOR_SELECTOR}; if(e){e.focus(); const s=window.getSelection(); s.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(e); s.addRange(r); document.execCommand('delete',false,null);}}catch{}})()`).catch(() => {})
```

### electron/flow-composer-settings.js

```text
269: ;(doc.body || doc).dispatchEvent(ev)
352: trig[0].click()
364: c.el.click()
388: trigger.click()
399: try { trigger.click() } catch (_e) { /* 메뉴 닫기 실패는 무시 */ }
404: item.click()
426: c.el.click()
447: c.el.click()
531: const exec = (js) => { guard(); return flowView.webContents.executeJavaScript(js, true) }
```

### electron/flow-mention-dom.js

```text
137: t.click();
172: try { o.dispatchEvent(__mkEvent(PointerEvent, 'pointerover', opt)); o.dispatchEvent(__mkEvent(PointerEvent, 'pointerenter', opt)); } catch {}
173: try { o.dispatchEvent(__mkEvent(PointerEvent, 'pointerdown', opt)); } catch {}
174: o.dispatchEvent(__mkEvent(MouseEvent, 'mousedown', opt));
175: try { o.dispatchEvent(__mkEvent(PointerEvent, 'pointerup', opt)); } catch {}
176: o.dispatchEvent(__mkEvent(MouseEvent, 'mouseup', opt));
177: o.dispatchEvent(__mkEvent(MouseEvent, 'click', opt));
```

### electron/flow-mode-tab.js

```text
44: try { el.dispatchEvent(new PointerEvent('pointerdown', c)); } catch {}
45: el.dispatchEvent(new MouseEvent('mousedown', c));
46: try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {}
47: el.dispatchEvent(new MouseEvent('mouseup', c));
48: el.dispatchEvent(new MouseEvent('click', c));
49: } catch { try { el.click(); } catch {} }
```

### electron/flow-page-injection.js

```text
64: window.__autoflowcut_fetch_patched__ = true
89: window.__autoflowcut_inject__ = Object.assign(
176: window.fetch = async function(input, init) {
182: try { const _h = new URL(url, location.href); if (/aisandbox/i.test(_h.hostname) && /(^|\.)googleapis\.com$/i.test(_h.hostname)) window.__autoflowcut_api_origin__ = _h.origin } catch (_e) {}
325: if (!window.__autoflowcut_net__) window.__autoflowcut_net__ = []
```

### electron/flow-reference-driver.js

```text
72: window.__autoflowcut_paste_obs__ = st;
108: try { inserted = document.execCommand('insertText', false, text) } catch (_) { inserted = false }
119: (document.body || document).dispatchEvent(ev);
```

### electron/flow-rpc-capture.js

```text
62: window.__autoflowcut_rpc_doc__ = doc
64: if (typeof window.__autoflowcut_rpc_seq__ !== 'number') window.__autoflowcut_rpc_seq__ = 0
65: window.__autoflowcut_rpc_capture__ = true
77: const seq = (window.__autoflowcut_rpc_seq__ = window.__autoflowcut_rpc_seq__ + 1)
195: window.fetch = patchedFetch
```

### electron/flow-rpc-client.js

```text
85: const reqid = (window.__autoflowcut_rpc_reqid__ = (window.__autoflowcut_rpc_reqid__ || 0) + 1)
120: r = await flowView.webContents.executeJavaScript(script, true)
```

### electron/flow-settings-dumper.js

```text
35: window.__autoflowcut_dumper_ready__ = true
74: window.__autoflowcut_dump_settings__ = function() {
```

### electron/flow-video-download.js

```text
116: window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
123: window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
```

### electron/flow-xhr-capture.js

```text
86: window.__autoflowcut_wiz_reported__ = true
92: window.__autoflowcut_xhr_patched__ = true
```

### electron/ipc/character.js

```text
214: const ready = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
234: const r = await flowView.webContents.executeJavaScript(FLOW_APPLY_NAME_PROBE(displayName))
286: .executeJavaScript(COMPOSE_EDITOR_READY)
303: return flowView.webContents.executeJavaScript(`(function(){
313: return flowView.webContents.executeJavaScript(`(function(){
322: i.dispatchEvent(new Event('input',{bubbles:true}));
323: i.dispatchEvent(new Event('change',{bubbles:true}));
337: const r = await wc.executeJavaScript(`(function(){
356: return flowView.webContents.executeJavaScript(`
394: editor.dispatchEvent(new Event('input', { bubbles: true }));
405: editor.focus(); editor.click(); await sleep(100);
416: } else { document.execCommand('selectAll', false, null); }
417: document.execCommand('delete', false, null); await sleep(50);
418: try { editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText })); } catch {}
419: if (document.execCommand('insertText', false, promptText)) {
420: try { editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText })); } catch {}
488: .executeJavaScript(`!!(${GENERATE_BTN_SELECTOR})`)
643: enabled = await flowView.webContents.executeJavaScript(`!!(${GENERATE_BTN_SELECTOR})`).catch(() => false)
788: submitState = await flowView.webContents.executeJavaScript(SUBMIT_PROBE).catch(() => 'error')
801: const r = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
812: ready = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
885: enabled = await flowView.webContents.executeJavaScript(`!!(${GENERATE_BTN_SELECTOR})`).catch(() => false)
901: const _pre = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE)
912: scan: () => flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE),
1132: ready = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
1270: await flowView.webContents.executeJavaScript('window.__autoflowcut_net__ = []').catch(() => {})
```

### electron/ipc/dom.js

```text
57: ready = await flowView.webContents.executeJavaScript(READY).catch(() => false)
91: try { page = await flowView.webContents.executeJavaScript(FLOW_PAGE_PROBE_JS) } catch { probeOk = false }
206: return await flowView.webContents.executeJavaScript(
220: const result = await flowView.webContents.executeJavaScript(script)
296: const promptResult = await flowView.webContents.executeJavaScript(`
378: editor.dispatchEvent(new Event('input', { bubbles: true }));
379: editor.dispatchEvent(new Event('change', { bubbles: true }));
404: editor.click();
434: document.execCommand('selectAll', false, null);
438: document.execCommand('delete', false, null);
443: editor.dispatchEvent(new InputEvent('beforeinput', {
450: const inserted = document.execCommand('insertText', false, promptText);
456: editor.dispatchEvent(new InputEvent('input', {
484: editor.dispatchEvent(new Event('input', { bubbles: true }));
486: editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText }));
561: const urls = await flowView.webContents.executeJavaScript(`
576: const result = await flowView.webContents.executeJavaScript(`
612: const base64 = await flowView.webContents.executeJavaScript(`
```

### electron/ipc/flow-angular.js

```text
83: try { document.execCommand('delete', false, null) } catch (_) {}
85: try { inserted = document.execCommand('insertText', false, text) } catch (_) { inserted = false }
244: const exec = (flowView, js) => flowView.webContents.executeJavaScript(js, true)
```

### electron/ipc/flow-api.js

```text
83: hasWiz = await flowView.webContents.executeJavaScript('!!(window.WIZ_global_data && window.WIZ_global_data.SNlM0e)', true)
117: domImgs = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE)
164: const pid = await flowView.webContents.executeJavaScript(`
267: const hasTextarea = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
295: const enterClicked = await flowView.webContents.executeJavaScript(`
303: if (xr.singleNodeValue) { xr.singleNodeValue.click(); return 'add_2_xpath'; }
313: b.click(); return 'icon_' + t;
321: b.click(); return 'text_' + text.substring(0, 30);
355: textareaReady = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
437: existingBlobs = await flowView.webContents.executeJavaScript(
447: const _pre = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE)
536: submitState = await flowView.webContents.executeJavaScript(SUBMIT_PROBE).catch(() => 'error')
592: promptResult = await flowView.webContents.executeJavaScript(`
653: editor.dispatchEvent(new Event('input', { bubbles: true }));
654: editor.dispatchEvent(new Event('change', { bubbles: true }));
672: editor.click();
693: document.execCommand('selectAll', false, null);
696: document.execCommand('delete', false, null);
700: editor.dispatchEvent(new InputEvent('beforeinput', {
705: const inserted = document.execCommand('insertText', false, promptText);
707: try { editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText })); } catch {}
727: editor.dispatchEvent(new Event('input', { bubbles: true }));
729: editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText }));
769: const diag = await flowView.webContents.executeJavaScript(`
808: enabled = await flowView.webContents.executeJavaScript(SUBMIT_ENABLED_PROBE).catch(() => false)
945: expectedImageCount = await flowView.webContents.executeJavaScript(`
1021: try { imgs = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE) } catch {}
1067: const currentBlobs = await flowView.webContents.executeJavaScript(
1073: const base64 = await flowView.webContents.executeJavaScript(`
1736: const domResult = await flowView.webContents.executeJavaScript(`
1749: el.dispatchEvent(new PointerEvent('pointerdown', pOpts))
1750: el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
1751: el.dispatchEvent(new PointerEvent('pointerup', pOpts))
1752: el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
1753: el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
1769: document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }))
1822: el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
1823: el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
1826: node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
1827: node.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
1842: targetImg.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
1843: targetImg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
1846: hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
1847: hoverNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
1900: downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...hoverOpts, composed: true }))
1901: downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...hoverOpts, composed: true }))
1902: downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: dlX, clientY: dlY }))
1903: downloadItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: dlX, clientY: dlY }))
1904: downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: dlX, clientY: dlY }))
1919: downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...jOpts, composed: true }))
1920: downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...jOpts, composed: true }))
1921: downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: jX, clientY: jY }))
1922: downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: jX, clientY: jY }))
1953: downloadItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
2026: await flowView.webContents.executeJavaScript(`
2031: if (text === '닫기' || text === 'Close') { btn.click(); break }
```

### electron/ipc/mcp.js

```text
28: const raw = await webContents.executeJavaScript(script)
```

### electron/ipc/shared.js

```text
98: ? await flowView.webContents.executeJavaScript(AGENT_TOGGLE_DIAGNOSTIC).catch(() => null)
122: const r = await flowView.webContents.executeJavaScript(buildSessionProbeJs(candidates))
207: const measure = () => flowView.webContents.executeJavaScript(`
233: const hitTest = (x, y, measuredUrl) => flowView.webContents.executeJavaScript(HIT_TEST_JS(x, y, measuredUrl, jsSelector))
444: const pagePromise = flowView.webContents.executeJavaScript(`
501: const token = await flowView.webContents.executeJavaScript(`
702: const result = await flowView.webContents.executeJavaScript(`
711: try { document.body.dispatchEvent(new KeyboardEvent('keydown', {
724: el.dispatchEvent(new PointerEvent('pointerover', common));
725: el.dispatchEvent(new PointerEvent('pointermove', common));
727: el.dispatchEvent(pDown);
729: el.dispatchEvent(new MouseEvent('mouseover', common));
730: el.dispatchEvent(new MouseEvent('mousemove', common));
731: el.dispatchEvent(new MouseEvent('mousedown', common));
732: el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
733: try { el.dispatchEvent(new PointerEvent('pointerup', common)); } catch {}
734: el.dispatchEvent(new MouseEvent('mouseup', common));
735: el.dispatchEvent(new MouseEvent('click', common));
737: } catch { try { el.click(); return true; } catch { return false; } }
911: const present = (selector) => flowView.webContents.executeJavaScript(`!!(${selector})`).then(Boolean).catch(() => false)
916: await flowView.webContents.executeJavaScript(
917: `try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true })); } catch (e) {}`
935: const scan = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_DIAGNOSTIC).catch(() => null)
965: let probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
971: probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
987: probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
1013: let probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
1018: probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
1031: probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
1052: const r = await flowView.webContents.executeJavaScript(buildSelectModeScript(mode))
1091: const result = await flowView.webContents.executeJavaScript(script)
1125: const r = await flowView.webContents.executeJavaScript(buildListModelsScript())
1168: try { return { read: true, page: await flowView.webContents.executeJavaScript(FLOW_PAGE_PROBE_JS) } }
```

### electron/ipc/video.js

```text
100: submitState = await flowView.webContents.executeJavaScript(SUBMIT_PROBE).catch(() => 'error')
113: const r = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
288: : await flowView.webContents.executeJavaScript(`
337: editor.dispatchEvent(new Event('input', { bubbles: true }));
348: editor.focus(); editor.click(); await sleep(100);
365: document.execCommand('selectAll', false, null);
367: document.execCommand('delete', false, null); await sleep(50);
368: try { editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText })); } catch {}
369: const inserted = document.execCommand('insertText', false, promptText);
420: const _pre = await flowView.webContents.executeJavaScript(GENERATED_VIDEO_PROBE)
427: scan: () => flowView.webContents.executeJavaScript(GENERATED_VIDEO_PROBE),
603: const promptResult = await flowView.webContents.executeJavaScript(`
652: editor.dispatchEvent(new Event('input', { bubbles: true }));
663: editor.focus(); editor.click(); await sleep(100);
680: document.execCommand('selectAll', false, null);
682: document.execCommand('delete', false, null); await sleep(50);
683: try { editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText })); } catch {}
684: const inserted = document.execCommand('insertText', false, promptText);
817: const result = await flowView.webContents.executeJavaScript(`
966: const result = await flowView.webContents.executeJavaScript(`
```

### electron/main.js

```text
148: const NET_TRACE_INJECTION = 'window.__autoflowcut_net_trace__ = true;\n' + FLOW_XHR_CAPTURE_INJECTION
163: view.webContents.executeJavaScript(NET_TRACE_INJECTION).catch(() => {})
169: view.webContents.executeJavaScript(FLOW_RPC_CAPTURE_INJECTION).catch((e) => {
509: view.webContents.executeJavaScript(FLOW_PAGE_INJECTION).catch(() => {})
627: await view.webContents.executeJavaScript(FLOW_PAGE_INJECTION)
636: await view.webContents.executeJavaScript(FLOW_SETTINGS_DUMPER)
647: const landingResult = await view.webContents.executeJavaScript(`
653: el.click();
681: const consentResult = await view.webContents.executeJavaScript(`
688: b.click();
695: cb.click();
697: cb.dispatchEvent(new Event('change', { bubbles: true }));
703: b.click();
794: const clicked = await view.webContents.executeJavaScript(`
812: if (xr.singleNodeValue) { xr.singleNodeValue.click(); return 'add_2_xpath'; }
819: if (t === 'add_2' || t === 'add') { b.click(); return 'icon_' + t; }
825: if (icon.textContent.trim() === 'arrow_forward') { b.click(); return 'arrow_forward'; }
831: b.click(); return 'text_' + text.substring(0, 30);
837: b.click(); return 'cta';
871: const lastResort = await view.webContents.executeJavaScript(`
966: const patched = await flowView.webContents.executeJavaScript(
967: `(function(){ window.__autoflowcut_inject__ = ${JSON.stringify(payload)}; return !!window.__autoflowcut_fetch_patched__ })()`
988: await flowView.webContents.executeJavaScript(
989: `window.__autoflowcut_inject__ = ${JSON.stringify(flowInjectClearPayload())}`
1004: .executeJavaScript('window.__autoflowcut_api_origin__ || null')
1174: const result = await mainWindow.webContents.executeJavaScript(`
1238: mainWindow.webContents.executeJavaScript(
1257: mainWindow.webContents.executeJavaScript(
1332: mainWindow.webContents.executeJavaScript(
1410: mainWindow.webContents.executeJavaScript(
1430: mainWindow.webContents.executeJavaScript(
1456: mainWindow.webContents.executeJavaScript(
1477: mainWindow.webContents.executeJavaScript(
1498: mainWindow.webContents.executeJavaScript(
1842: const net = await flowView.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.__autoflowcut_net__ || []))')
1850: try { mainWindow.webContents.executeJavaScript(`console.log('[FlowNetDump] saved: ${path.basename(filePath).replace(/'/g, "\\'")}')`) } catch {}
1861: const probe = await flowView.webContents.executeJavaScript(FLOW_DOM_DUMP_PROBE)
1868: try { mainWindow.webContents.executeJavaScript(`console.log('[FlowDomDump] saved: ${path.basename(filePath).replace(/'/g, "\\'")}')`) } catch {}
```

## 2026-11-07 추가 검토

기존 전용 worktree의 4개 커밋과 미커밋 변경을 보존해 이어서 검증한다. 새로 확인한 문제는 main 등록부의 safety 관문 연결 및 취소 epoch 전달 누락이다. 실패하는 wiring 테스트로 재현했고 클릭 직전 관문과 함께 연결했다. 설정 패널은 기존 순수 scan/plan을 격리 월드에서 사용하고, main에서 매번 재탐색한 버튼에 native click을 보내는 경로를 추가한다. 모델/모드 전환 뒤에는 안정 대기와 최종 재판독, 닫힌 요약 검증을 유지한다. 임의 seed/endpoint/body 필드는 만들지 않는다.

현재 저장된 최신 DOM 증거(`flow-live-dom-m3.js`, `flow-live-dom-download-20261019.js`)의 asb 토큰에는 서버 media UUID·generation ID·프롬프트 소유권이 없다. 기존 `scanGeneratedImages`는 과거 UUID 링크만 인식하므로 현행 갤러리에 그대로 연결할 수 없다. 기존/다른 클라이언트에서 생긴 단일 카드도 새 카드로 보일 수 있어, 개수 차이만으로 성공을 추정하는 대체는 적용하지 않는다. RPC 캡처를 끄면 생성 전에 명시적으로 거부하며 capture 없이 실제 생성부터 시도하지 않는다. 이 제한을 숨겨 'fetch-free 생성 완료'로 보고하지 않는다.

## 실제 반영 상태와 기본값 (2026-11-07)

- (a) main의 공통 IPC 관문이 이미지·영상·캐릭터·씬 생성/업스케일을 직렬화하고, 앞 핸들러 종료부터 최소 60초 + 0~15초 지연을 보장한다. 기존 씬 탭 간격도 유지된다. `AUTOFLOWCUT_FLOW_MIN_INTERVAL_MS`(기본 60000, 1000~300000), `AUTOFLOWCUT_FLOW_JITTER_MS`(기본 15000, 0~120000), `AUTOFLOWCUT_FLOW_RPC_ERROR_LIMIT`(기본 3, 1~20)로 설정한다. 숫자가 잘못되면 기본값을 쓴다. 60초는 보수적인 초기값이며 안전한 서비스 한도로 검증한 숫자는 아니다.
- 격리 월드 998의 읽기 전용 프로브가 보이는 경고를 확인한다. 생성 준비/응답 대기 중에는 2초마다 추가 확인한다. 경고가 있거나 중립 생성 RPC 오류가 연속 N회면 main/renderer가 정지 상태를 유지한다. Stop, 알림 닫기, 프로젝트 변경, 큐 초기화로 해제되지 않는다. 오류 재시도도 main과 renderer 양쪽에서 거부한다. API 모드는 영향받지 않는다. code 8/RESOURCE_EXHAUSTED는 한도 오류로 구분한다.
- 정지 후에도 이미 제출한 작업의 자연스러운 완료/기존 마감은 유지한다. 완료 조회·수집을 계속 허용하고, 일괄 정리 IPC는 map을 보존한다. 다른 작업의 성공 이미지를 정지 오류로 덮어쓰지 않는다. UI 취소로 자동 반영하지 못한 결과는 Flow 갤러리에서 확인·복구해야 한다. 정지 알림이 왔다고 이미 전송된 요청이 서버에서 취소되는 것은 아니다.
- (b) `AUTOFLOWCUT_FLOW_LEGACY_MUTATION=1`인 경우에만 구형 본문 변조 fetch 래퍼·settings dumper·추가 net trace·구형 임의 DOM 실행을 허용한다. **기본값 off**: 현행 Angular 생성에 필요 없는 두 번째 래퍼와 본문 변조를 제거하기 위해서다. 새 이미지/영상의 모델·비율·개수·길이·해상도·프레임 모드는 기존 Flow UI를 이용한다. 임의 seed나 UI에 없는 필드를 생성 요청에 쓰지 않는다.
- (d) 기본 설정 드라이버는 격리 월드 996에서 순수 DOM scan/plan을 실행한다. 라디오/모델/패널 닫기는 기존 hit-test·dispatch guard를 거친 sendInputEvent 클릭이다. 매 클릭 전에 같은 대상을 재탐색하고, 모델/모드 전환·마지막 설정에 안정 대기/재판독을 한다. 알 수 없는 모델·메뉴·옵션이나 반영 실패는 제출 전에 거부한다. 명시적 legacyMutation 옵션에서만 구형 합성 설정 드라이버를 쓴다.
- 레퍼런스 없는 이미지/영상 프롬프트는 네이티브 selectAll + ASCII char 입력, 한글·이모지·줄바꿈은 Electron insertText로 입력한다. 읽기/포커스 검증은 격리 월드 997이다. 실패하면 value setter/execCommand로 재시도하지 않는다. 실제 Electron 입력기 동작은 Flow 실기 시험 전까지 미검증이다.
- (c) **현행 Flow의 fetch/XHR 교체 없는 생성 결과 캡처는 미완료**다. `AUTOFLOWCUT_FLOW_RPC_CAPTURE`는 **기본값 on**, `0`으로 끌 수 있다. 현재 media UUID·업로드·영상 상태 소유권을 잃지 않고 Flow 모드를 유지하기 위해서다. 꺼진 경우 legacyMutation도 강제로 꺼지고 preload bridge/응답 래퍼를 설치하지 않는다. 결과 검증이 필요한 생성·레퍼런스 조작·업스케일은 제출 전에 `flow-dom-capture-unsupported`로 거부한다. 대체 DOM 경로가 구현됐다고 보고하지 않는다.
- 남은 페이지 조작: RPC fetch/XHR 래퍼 및 bridge, 레퍼런스의 paste observer/execCommand/합성 Escape, 에이전트 패널 보조 조작, 세션 WIZ 읽기 및 읽기 RPC, 영상 다운로드의 history/popstate, 일부 메인 월드 DOM 읽기/scroll/focus. 생성/레퍼런스 조작은 위 capture 플래그를 끄면 차단된다. 정상 다운로드의 session will-download 기존 경로는 유지한다. 격리 월드로 옮겨도 공유 DOM의 스크롤·포커스·실제 입력 자체는 페이지가 관측한다.

## TDD·리뷰·작업 보존

- 이전 실행의 `95073738`(조사), `66a3b5c1`(구형 조작 기본 해제), `234ab9a6`(정지 관문), `9ed0c4ae`(경고 판별/취소)을 보존했다. 이번 작업이 새로 만든 커밋은 아니다.
- main 연결 누락: wiring 테스트 실패 → 관문/취소 전달 → 관련 12파일 223개 통과.
- native 설정: 단위 2개 실패 + 통합 4개 실패/1개 통과 → 최소 구현 → 단위/통합 통과. 이후 기존 설정/이미지/영상 IPC 포함 7파일 269개 통과.
- 리뷰 지적의 결과 유실: 새 회귀 3개 실패 → 일괄 settle 제거/성공 결과 및 map 보존 → 관련 5파일 38개 통과.
- 영상/I2V 모드·모델·길이·해상도·개수·프레임 전환도 fixture로 검증했다. 최종 집중 검사 4파일 26개 통과, 별도 리뷰어 재검사 3파일 24개 통과. 실제 Flow 연결·생성은 하지 않았다.
- 커밋 시도는 저장소 메타데이터가 읽기 전용인 환경에서 index.lock 생성이 Operation not permitted로 거부됐다. 권한을 우회하지 않았다. 변경은 `/private/tmp/autoflowcut-flow-detection`의 지정 브랜치 worktree에 미커밋 상태로 남긴다. main 병합·push·실행 앱 재시작은 하지 않았다.
- 목표 (c)가 미완료라 전체 plan은 진행 중으로 유지한다. 완성된 것처럼 archive 처리하지 않는다.

## 이후 사용자와 할 실기 시험

1. 현재 Flow 경고를 사용자가 해소했는지 먼저 확인한다. 기존 앱은 이번 작업 중 그대로 둔다. 수정본 앱 실행은 별도 시험 시점에 사용자와 진행한다.
2. 레퍼런스 없는 이미지 1장: 모델·비율·개수=1, 한글/줄바꿈 프롬프트, 결과 내용·저장된 씬 일치 확인. 요청을 반복해서 성공을 탐색하지 않는다.
3. 이상이 없을 때 3장, 최소 60초 + 0~15초 간격. 제출 시각, UI 설정, 결과 소유권·다운로드, 경고/연속 오류 정지와 오류 재시도 차단을 확인한다.
4. 경고가 다시 뜨면 추가 생성 없이 중단한다. 원인 후보의 순위를 실제 원인 확정으로 바꾸려면 한 번에 한 변경만 비교한 별도 관찰이 필요하다. 67장 배치나 일일 상한 시험은 하지 않는다.

## 최종 로컬 검증

- 동일 환경 전체 테스트: main **10,350 통과 / 55 건너뜀 / 0 실패**(876파일), 수정본 **10,435 통과 / 55 건너뜀 / 0 실패**(889파일). 총 테스트 10,405 → 10,490(+85). `AFC_TEST_FFMPEG=/private/tmp/afc-test-ffmpeg npm run test:run -- --maxWorkers=4`로 실행했다. 건너뜀은 기존과 같은 55개다.
- `npm run build` 성공. vite의 큰 chunk 경고는 남아 있다. 앱 프로세스를 실행하지 않았다. `git diff --check` 및 신규 파일 whitespace 검사도 통과했다.
- 로그: `/private/tmp/afc-main-baseline-fixedenv-20261107.log`, `/private/tmp/afc-detection-verified-20261107.log`, `/private/tmp/afc-detection-build-verified-20261107.log`.
- main HEAD는 시작과 같은 `211a77933f299fc2f2520f8cb7ceeb161e72a315`. 원래 있던 coverage/dist-adapter/test-results untracked 디렉터리도 보존했다.
- `/private/tmp/afc-flow-detection-20261107.patch`는 main 대비 기존 커밋 + 이번 미커밋 변경 + 신규 소스/테스트를 포함한다. node_modules/vendor의 읽기 전용 재사용 symlink와 빌드 출력은 제외한다. 금지된 디버거 메서드 문자열 검색은 전체 패치에서 0건이다.
