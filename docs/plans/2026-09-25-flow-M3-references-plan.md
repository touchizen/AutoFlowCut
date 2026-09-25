# 계획 — M3 레퍼런스: 레퍼런스 이미지 · @인라인 멘션 · 레퍼런스 영상(r2v)을 flow.google.com 에서 (2026-09-25, R3)

레포: `~/workspace/AutoFlowCut-bugfix` (worktree, 브랜치 `feat/flow-m3-references` — M2 `fix/flow-batchexecute` 위, HEAD `c2a815e0`)
상태: **PLAN R3. 코드 변경 0.** 저자 Opus 5.5. R0 리뷰(Sonnet 5 ×2 — A1 수정 수용, B1·B2·B3 수용) · M3-0 프로브(P1–P9, 추가 확인 PR §4) · R0 뒤의 사용자 결정 · R1 리뷰(Sonnet 5 ×2 — A1·B1·B2·B3 수용) · R2 리뷰(Sonnet 5 ×2 — A1 수정 수용, B1·B2·B3 수용)를 반영했다(§8). R0 의 `[분기]` 는 프로브로 전부 닫혔다.
증거: `docs/handoffs/evidence/2026-09-25-m3-references-capture.md`(**C**), `…-m3-samples.masked.jsonl`(**S3#n**, 행 1–20: 2 maseQ(파일 대화상자) · 3 ogiZ0b ref1 · 4 maseQ(붙여넣기) · 9 ogiZ0b ref2+멘션 · 10 MZZa6b Omni · 14 YhhmEf 대조군 · 15 MZZa6b Veo · 17 MZZa6b 인라인 멘션(P9) · 19 ogiZ0b 같은 미디어 두 번 멘션 · 20 MZZa6b 같은 미디어 두 번 멘션), `…-m3-dom-<단계>.elements.json`(**D3:<단계>**), 프로브 결과 `…-m3-probes.md`(**PR** P1–P9 · §4 추가 확인), 리뷰 처분 `docs/handoffs/briefs/2026-09-25/findings/m3-plan-r0.findings.md`, M2 계획서 `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md`(**P2**, § 와 행 번호 #n), M2 핸드오프(**H2**), 킥오프(**K3**), HTrJv 카탈로그 = 09-24 샘플 11행(**CAT**, 20000자에서 잘림). **RAW** = 캡처 때 바탕화면에 남은 원본 DOM 덤프(저장소 밖, 마스킹해서 읽은 사실만).
표기: **[관측]** 캡처·덤프·프로브에 있는 사실 · **[추정]** 관측에서 끌어낸 추론 · **[미상]** 아무도 본 적 없음.

---

## 0. 목표·범위

사용자 결정(바꾸지 않는다 — R0 뒤 결정 4·5 추가, 2 는 세션 범위로 좁혀짐):
1. **@멘션 = Flow 인라인 멘션 재현** — 이미지·영상 모두(영상 모양은 P9 로 관측). 캐릭터 엔티티(`C4BZMd`)는 쓰지 않는다.
2. **업로드 = 같은 페이지 세션 안에서 재사용** — 처음 쓸 때 편집기에 클립보드 이미지를 붙여넣어 올리고, 같은 페이지 세션(문서) 동안은 애셋 창의 id 썸네일로 골라 붙인다. 앞 세션 업로드는 썸네일이 불투명해 다시 올린다(ref 당 세션마다 1장 중복). 목록에 없으면 창을 한 번 다시 열어 보고, 그래도 없으면 다시 올린다. 붙인 뒤엔 칩 id 로 확정한다.
3. **범위 = 이미지(`ogiZ0b`) + 레퍼런스 영상(`MZZa6b`, r2v)**. i2v·업스케일·캐릭터 엔티티는 범위 밖(fail-closed 유지).
4. **클립보드**: `text/uri-list`(Finder 파일 복사)가 있을 때만 업로드를 멈춘다. 그 밖엔 text/html/rtf/image 를 복원하고 앱 전용 형식(예: 앱 자신의 텍스트창이 싣는 `application/x-lexical-editor`)은 버린다 — 그것 때문에 멈추면 안 된다.
5. **M2 돈 구멍(§1-1)은 M3 에서만 닫는다** — M2 브랜치 소급 없음.

| 경로 | 지금(M2 끝) | M3 뒤 |
|---|---|---|
| 이미지 씬(배치 `useAutomation` · 단일 `useSceneGeneration` · MCP) — 캐릭터/장소/스타일 태그 ref | `flow-references-unsupported`(클릭 전) | 애셋 창 "＋" 로 칩 첨부 → `ogiZ0b [1][0][2]` |
| 이미지 씬 프롬프트의 `@이름` | 같음 | 인라인 멘션 → `ogiZ0b [1][0][8]` 멘션 세그먼트 + 칩 |
| 영상 T2V 프롬프트의 `@이름` | `flow-mention-chips-unsupported` | 인라인 멘션 → `MZZa6b [0][0][0][2]` + `[0][0][1]` |
| 레퍼런스 **생성**(Ref 탭, `purpose:'reference'`) + 스타일 ref 이미지 | `flow-references-unsupported` | 그대로(범위 밖 §7) |

**불변(위반은 BLOCKER, P2 §3·H2 §2 그대로)**: 돈 규칙(`generationId` 있고 `videoPath` 없으면 상태 무관 재제출 금지 — r2v 도 같다, `MZZa6b` 200 = 과금) · 클릭 전 fail-closed · 제출은 신뢰 클릭만(`sendInputEvent`) · 요청 본문 변조 금지(레퍼런스·멘션도 UI 로 붙여 페이지가 요청을 만든다) · CDP 금지 · 앱은 `maseQ`·제출 RPC 를 만들지 않고 reCAPTCHA 를 부르지 않는다 · **앱은 Flow 뷰에 키 이벤트를 보내지 않는다** · 로그·Sentry 에 내용 금지(프롬프트·파일 경로·파일명·URL·본문·토큰·base64·멘션 라벨) — 길이·id 앞 8자·상태어만.

---

## 1. 고고학 — 지금 어디서 막히고, 옛 경로 중 무엇이 살아 있나

### 1-1. 막는 자리 (M1-10 게이트와 그 주변)

| 자리 | 코드 | 지금 결과 | M3 |
|---|---|---|---|
| 엔진 입력 게이트 | `src/engine/engineFlow.js:182-189` `flowInputGate` — `matchedRefCount>0`(`:186`)·`referenceImages.length>0`(`:187`) | `flow-references-unsupported` | 업스케일 검사(`:183-185`)만 남기고 D1 |
| 엔진 이미지 진입점 둘 | 동기 `generateImage`(`:365-398` — 게이트 `:371`, 라우팅 `:374`, 거부 `:381`, `asyncMode:false` `:393`) · **배치·MCP 의 비동기 `submitGeneration`(`:400-451` — 게이트 `:424`, 라우팅 `:427`, 거부 `:434`, `asyncMode:true` `:446`)** | 같음 | 둘 다 D1·D3 의 같은 절차 |
| 멘션 해석(옛 엔티티 전제) | `src/utils/sceneMentions.js:22-24` — 후보 = `type==='character' && entityId && flowNameSyncStatus==='synced'` | 새 사이트엔 엔티티 동기화가 없어 사실상 전부 미해결 | 쓰지 않는다(D3) |
| 영상 엔진 | `engineFlow.js:515-517`(`segments` → `flow-mention-chips-unsupported`), `:520-526`(ref 이미지 → `flow-t2v-reference-images-unsupported`) | 클릭 전 거부 | D1 |
| 영상 프롬프트 빌더 | `src/utils/videoPromptReferences.js:60-70` — Flow 분기가 `parseSceneMentions` 로 `segments` | 위 거부로 간다 | D15 |
| 이미지 핸들러 | `electron/ipc/flow-angular.js:364` — `referenceImages` 비어 있지 않으면 | `flow-references-unsupported` | 옛 필드는 계속 거부, 새 필드 `refs`/`plan`(D1) |
| 영상 핸들러 | `flow-angular.js:555` — `segments` | `flow-mention-chips-unsupported` | 같음(옛 필드), 새 필드 `refs`/`plan` |
| 영상 IPC 구조분해 | `electron/ipc/video.js:122-125` — 필드를 나열해 받는다 | 새 필드는 버려진다 | `refs, plan` 추가(M2-3 의 `resolution` 선례) |
| 배치 ref 필터 | `src/hooks/useAutomation.js:293-300` — Flow 는 `flowImageInjectable`(= 옛 `mediaId`, `refImageGuard.js:9-11`)로 거른다 | 파일만 있는 ref 가 엔진에 도달조차 못 한다 | `sourceAvailable`(`refImageGuard.js:5-7`, D15) |
| 배치 선행 업로드 | `useAutomation.js:624-629` — Flow 에서 비-캐릭터 ref 를 `uploadReference` 로 올린다 → 엔진 `:498` 이 즉시 거부 | 경고만 쌓이고 진행 | Flow 에선 없음(D15) |
| 동기화 게이트(프리플라이트) | `src/utils/mentionSyncTargets.js:22-41`(`:27` 이 `parseSceneMentions`) → `emptyRefGate.js:188-193`·`App.jsx:1796-1799`·`mentionSyncRequest.js:39` | 미동기화 캐릭터 멘션이면 옛 엔티티 동기화 모달 — MCP 는 `nonInteractiveSyncGate`(`emptyRefGate.js:21`)가 배치를 취소 | 퇴역(D15) |
| M1 제외 가드 | `src/utils/refImageGuard.js:80-136` — 쓸 수 있음 = 옛 mediaId·엔티티·`flowSyncable`(`:108-116`); 태그만 걸린 **캐릭터** ref 는 mediaId 없으면 제외 | 로컬 이미지가 있어도 제외 | 쓸 수 있음 = 로컬 이미지(D15) |
| 모델키 검증 | `electron/flow-rpc-protocol.js:292` — `m[2] !== 't2v'` 면 false | r2v 키는 전부 불일치 | D11 |
| 제출 프롬프트 추출 | `flow-rpc-protocol.js:350-351` — `ogiZ0b`/`YhhmEf` 만 | `MZZa6b` 는 `[]` | D10 |
| 영상 응답 파서 | `flow-rpc-protocol.js:178` — `RPC = 'YhhmEf'` 고정(shape 경로 문구) | — | rpcid 인자 |
| 캡처 허용 목록 | `electron/flow-rpc-capture.js:24,30` — `{ogiZ0b, YhhmEf}` | **`MZZa6b`·`maseQ` 는 보이지 않는다** | D5·D10 |
| 라우터 | `electron/flow-rpc-router.js:138`(rpc 동일만 후보) · `:42`(유예는 `YhhmEf` 만) · `:50-54`·`:179-183`(미바인딩 보고는 `YhhmEf` 만) · `:219-243`(파서 분기 ogiZ0b/YhhmEf) | — | D5·D10 |

**지금 이미 있는 돈 구멍 — M3 에서만 닫는다(사용자 결정 5)**: 컴포저에 칩이 있으면 프롬프트에 멘션이 없어도 페이지는 `YhhmEf` 대신 `MZZa6b` 를 보낸다 — [관측] 캡처 h1(Omni)·h2b(Veo)는 사용자가 ＋로 칩만 붙이고 평문 프롬프트로 제출한 것이고 둘 다 `MZZa6b` 로 나갔다(S3#10·#15). 페이지 입장에서 잔여 칩과 구별되지 않는다. 그 뒤는 코드 판독 사실이다: 캡처는 `MZZa6b` 를 모르므로(`flow-rpc-capture.js:30`) gen(`rpc:'YhhmEf'`)은 바인딩되지 않고 15s 훅의 크레딧 재판독(`flow-angular.js:700-708`)이 감소를 보고 `flow-submit-lost` 로 닫는다 — 과금된 영상은 id 도 없이 사라지고 미바인딩 보고(`flow-rpc-router.js:179-183`)도 `YhhmEf` 만 본다. 이미지는 잔여 칩이 그대로 레퍼런스로 실린다(0크레딧). → D9 의 "칩 없음" 게이트와 D10 의 대체 rpc 바인딩을 **레퍼런스 없는 M1·M2 경로에도** 건다.

### 1-2. 옛 레퍼런스 경로 — 재사용 / 사망

| 것 | 위치 | 판정 | 이유 |
|---|---|---|---|
| 옛 @멘션 주입(Slate·Radix 다이얼로그·캐릭터 탭·이름 매칭·신뢰 `@` 키) | `electron/flow-compose-mention.js`, `electron/flow-mention-dom.js` | **사망** | 새 편집기는 ProseMirror·애셋 창은 Material. 옛 교훈 "execCommand 로는 `@` 피커가 안 열린다"(`flow-compose-mention.js:104`)는 **새 사이트에서 뒤집혔다**(PR P4 — `insertText('@')` 로 열린다). 로케일 문구 앵커 금지만 산다(`tests/electron/noLocaleBoundDomAnchors.test.js:11-20`) |
| 캐릭터 엔티티 생성·등록(aisandbox REST) | `electron/flow-character-api.js`, `electron/ipc/character.js` | **사망 + 단락됨** | `character.js:435,601,726,1236` 가 `unsupportedOnAngular`. 새 사이트 엔티티(`C4BZMd`/`rzMKMb`)는 사용자 결정으로 안 쓴다 |
| 옛 레퍼런스 업로드(`UPLOAD_URL` REST) | `electron/main.js:171`, `electron/ipc/flow-api.js:1873` | **사망 + 단락됨** | 새 업로드는 `maseQ`(reCAPTCHA 토큰 `[0][10][0]`, S3#2·#4) — 앱이 부를 수 없다 |
| 요청 본문 주입(fetch 몽키패치·CDP Fetch) | `electron/flow-page-injection.js:109-201`, `electron/cdp-image-inject.js:22` | **사망 + 금지** | 본문 변조·CDP. 새 사이트는 XHR 이라 무효이기도 하다 |
| `ref.mediaId`(옛 업로드·생성물 id) | `refImageGuard.js:9-11` 등 | **레퍼런스 정체성으로 안 쓴다**(D2) | 앞 세션·생성 미디어는 애셋 창 썸네일이 불투명이라(PR P5) 존재도 id 도 검증할 수 없다 |
| 멘션 문법·해석 | `src/utils/mentionParser.js:24`(`MENTION_RE`), `:45-64`(`iterateMentions`), `:106-116`(`resolveMentionPrefix` — 한글 조사) | **재사용** | 타입 무관 해석(=`getMatchingReferences` `useScenes.js:672-681`) |
| 레퍼런스 바이트 해석 | `src/utils/referenceResolver.js:57-103` | **재사용(엄격 모드로)** | 못 읽은 ref 는 경고 후 **건너뛴다**(`:90-93`) → ref 하나씩 불러 빈 결과면 실패(D2) |
| 신뢰 클릭·뷰포트·방패·키 잠금·DOM 단계 직렬화·워치독 | `electron/ipc/shared.js:132-163`(측정 시 `scrollIntoView` `:190`, `beforeDispatch` `:308`), `flow-angular.js:226-304`, `main.js:366,372-392,407` | **재사용(변경 없음)** | 애셋 창 항목·탭·추가·칩 제거도 같은 신뢰 클릭. 키 잠금 예외 없음(D8) |
| 캡처·라우터·프로토콜 | `flow-rpc-capture.js`, `flow-rpc-router.js`, `flow-rpc-protocol.js` | **확장** | D5·D10·D11·D12 |

### 1-3. 레퍼런스 데이터 모델 — 로컬 이미지를 어떻게 얻나

- ref 필드: `id, type(character|scene|style…), name, category, caption, data(메모리 base64/data URL), filePath, imagePath(프로젝트 상대), mediaId(옛), entityId/workflowId/flowNameSyncStatus(옛 엔티티 동기화)`. 이미지 원천 판정 `sourceAvailable = data || filePath || imagePath`(`refImageGuard.js:5-7`).
- 씬에 걸린 ref = `getMatchingReferences(scene)`(`src/hooks/useScenes.js:636-686`): 캐릭터·장소·스타일 태그 + 프롬프트의 `@name`(타입 무관, `:672-681`). 스타일 ref 이미지는 `resolveSceneStyle` 이 `matchedRefs` 에 밀어 넣는다(`useSceneGeneration.js:100-102` 주석).
- 바이트: `resolveReferenceImages(refs, {projectName, strictMime})`(`referenceResolver.js:57`) — `data` → `filePath` → 프로젝트 `references/{name}`. Flow 엔진은 `getProjectName` 을 받는다(`useGenerationEngine.js:20`, `useGenAPI.js:70-83`).
- 영상 ref 는 태그가 아니라 **멘션만**(API 모드 `videoPromptReferences.js:73-90` 와 같은 규칙).

### 1-4. 관측 요약 — 캡처(C)·프로브(PR)

1. **캡처 채널** [관측, 리뷰 A1]: 캡처 샘플 16건과 프로브 업로드 6건의 `maseQ`·`MZZa6b` send·loadend 가 전부 `XMLHttpRequest.prototype` 래핑 훅(`source=xhr`, `electron/flow-xhr-capture.js:122`)에 잡혔다 — 프로덕션 캡처(`flow-rpc-capture.js:59-100`)와 같은 기법이라 두 rpc 도 그 캡처로 보인다(실기 G1 이 다시 확인).
2. **업로드** [관측 S3#2·#4, PR P1·P6·P8]: `maseQ` 요청 `[0][10][0]` reCAPTCHA · `[1]` base64 · `[2]` mime · `[8]` 파일명; 응답 `[0][0]` = 새 mediaId = `[1][3][4]`. 붙여넣기는 PNG(`image.png`)로 간다. `flowView.webContents.paste()` 가 **앱 창·Flow 뷰 모두 포커스 없음**과 **숨은 뷰(제자리 확장+방패)**에서 된다; 붙여넣기 관찰까지 1–4ms, 대상 편집기, `files=1`; **관찰 직후(2ms) 클립보드를 복원해도 업로드 정상**. 칩 수명: ~0.1s `aria-busy="true"`·img 없음 → ~7.9s busy 해제, **여전히 img 없음** → ~9.6s `flow-content` id img. 같은 이미지 두 번 → 새 id. 1×1·6000² 모두 7–9s. 파일 입력(`input[type=file]`)은 어떤 덤프에도 없다.
3. **애셋 창** [관측 D3:a·g, PR P5]: 트리거 `button.add-menu-trigger`(열리면 `aria-expanded="true"`·아이콘 `close`), 탭 `[role=tab]` 리거처 `drive_folder_upload`(업로드)·`dashboard`(전체) 등, 전체 목록은 `cdk-virtual-scroll-viewport.asset-list-viewport`, 항목 `button.asset-item[role=option]`, 검색 `input.search-input`(`cdkfocusinitial`), 미리보기 `img.detail-preview-image`, `button.detail-add-to-prompt-btn` — **추가하면 창이 저절로 닫힌다**. **이번 페이지 세션에 올린 미디어만** 썸네일이 `flow-content.google/image/<mediaId>`; 앞 세션 업로드·대부분의 생성 이미지는 목록·미리보기 모두 불투명 `lh3…/asb/…`(RAW·P5). 불투명 항목을 추가해도 칩엔 진짜 id 가 뜬다. 앱 재시작 뒤 **처음 연 창**엔 24s 전에 붙여넣은 두 장이 없었고, 그 뒤엔 새 업로드가 즉시 맨 위에 id 썸네일로 떴다.
4. **`@`** [관측 PR P4]: 캐럿 끝에서 `execCommand('insertText','@')` → 애셋 창이 열린다(신뢰 키도 열리지만 DOM 단계의 키 잠금이 keyDown 을 막는다). 한 번에 넣은 `mail a@b.com now`·`x (@`·`x @ y` 는 **안 열린다**. `@` 로 연 창은 ＋ 트리거 클릭으로 **안 닫히고** Escape 로 닫힌다 — Escape 는 `@` 뒤에 친 글자까지 지운다. `@` 뒤에 친 글자는 목록을 거르지 않는다.
5. **멘션 노드** [관측 PR P3]: `<span class="mention-chip" data-mention-id="<mediaId>" data-reference-type="media" contenteditable="false"><애셋 이름></span>` — id 를 드러낸다. 삽입 뒤 **공백 한 칸이 자동으로 붙는다**. 멘션은 칩을 **추가**한다. 같은 미디어 두 번 멘션 = 노드 2개, 칩은 하나로 합쳐지고 순서가 끝으로 간다 — **요청에서도**(PR §4, S3#19·#20) 레퍼런스 목록은 1개(중복 제거), 멘션 세그먼트는 등장마다 순서대로, 응답 되돌림 1개. 멘션 뒤 자동 공백은 다음 텍스트 세그먼트의 앞 공백으로 실린다(`" walks with "`). 편집기 텍스트엔 라벨(붙여넣은 업로드는 `image.png`)이 들어간다.
6. **칩·지우기** [관측 RAW bodyHtml, PR P2]: `flow-ingredient-bar > … > flow-image-ingredient-chip > button.chip-container[aria-busy] > div.chip-image-wrapper > img.chip-image` + `div.hover-icon-overlay > mat-icon(cancel)`. hover(mouseMove) 뒤 칩 클릭 = 그 칩만 제거. `div.top-right-actions > button.clear-button` = 칩·텍스트 모두 제거 — **단 애셋 창이 열린 동안엔 먹지 않는다**.
7. **설정 × 칩** [관측 PR P7]: 칩·멘션이 있는 채로 이미지↔영상·Omni↔Veo 전환 — 칩·멘션 유지, 요약 정상.
8. **이미지 요청** [관측 S3#3·#9 · 09-24 S 1행]: `[1][0][2]` 레퍼런스(`[id,null,null,null,1]`, 칩 순서), 없으면 `null`; `[1][0][8]` 세그먼트 — 멘션 `[null,[[id,"<이름>"]]]`, 텍스트 `["…"]`. 응답 `[0][0][6][0][15][3][0][i][2]` 가 레퍼런스를 되돌린다.
9. **영상 요청** [관측 S3#10·#15·#14, PR P9]: `MZZa6b [0][0]` = `[<프롬프트>, [[null,id]…], <모델키>, 1, null, […]]`(`YhhmEf` 보다 `[1]` 이 끼어 모델키가 `[2]`). 인라인 멘션 프롬프트 `[0][0][0][2]` = `[[[null,[["<id>","<이름>"]]],[" …"]]]` — 이미지와 같은 세그먼트(S3#17, 두 번 멘션 S3#20). 응답 모양은 `YhhmEf` 와 같고 세그먼트와 `[3][0][5][6][1][1][i][2]` 레퍼런스를 되돌린다. 크레딧 = 같은 길이 t2v(Omni 4초 7).
10. **CAT(r2v)** [관측 값]: `abra_r2v_{4,6,8,10}s[_360p]`, `veo_3_1_r2v_fast_{portrait,landscape}[_ultra[_relaxed]]`, `veo_3_1_r2v_lite`; Veo Quality r2v 키는 잘린 범위 안에 없다. 모델 항목 `[9]` = abra r2v 7, veo r2v 3, t2v `null` [추정: 레퍼런스 상한].
11. **클립보드 형식** [관측 PR P1d]: 앱 텍스트창 `text/plain, text/html, application/x-lexical-editor` · 웹 서식 텍스트 `text/plain, text/html` · 미리보기 이미지 `image/png` · Finder 파일 `text/plain, text/uri-list`(+아이콘 이미지).

---

## 2. 설계 결정

### D1. 디스패치와 게이트
- **엔진**(`engineFlow.js`): `flowInputGate`(`:182-189`)는 업스케일 검사만 남긴다. `callOpts.purpose === 'reference'` + ref 이미지 → `flow-references-unsupported`(범위 밖). **`generateImage`(동기)와 `submitGeneration`(배치·MCP 비동기, `asyncMode:true` `:446`) 둘 다** D3 계획 → D2 바이트 해석 → IPC 페이로드 `{prompt, refs:[{base64, mime}], plan:{segments, attach}, referenceImages:[]}`(asyncMode 만 다르다). 캐릭터 ref 생성 분기(`:369`, `:405-422`)는 그대로. 호출자가 0 이 되는 `planMentionRouting`·`planUnresolvedMentionFallback`·`computeSceneGapReferences`(`:56-146`)는 grep 확인 뒤 테스트와 함께 지운다.
- **main**: `generateImage`/`generateVideoT2V` 가 `refs`·`plan` 을 받는다. 옛 필드(`referenceImages` 비어 있지 않음 `flow-angular.js:364`, `segments` `:555`)는 계속 거부(이중 방어). `video.js:122-125` 구조분해에 `refs, plan`.
- **공통 사전 검사 = 이름 붙은 헬퍼 하나** `referencePreflight(flowView, {refs, plan})`(`flow-angular.js`) — `ensureOnProjectComposer` 뒤·DOM 단계 전에 두 핸들러가 부르고, 결과의 `timeoutMs` 를 각자의 `withAutomationViewport` 호출(이미지 `:378`, 영상 `:576` — 서로 다른 호출 자리)에 넘긴다: ① `plan` 모양(세그먼트 타입·인덱스 범위·문자열·개수 ≤ 64) → 아니면 `flow-reference-attach-failed` reason `bad-plan` ② `projectIdFromFlowUrl` → null 이면 `no-project-id` ③ `timeoutMs = DOM_STAGE_TIMEOUT_MS + 120s × 유일 ref 수`(D4). 레퍼런스가 없으면 ③ 만(= 기존 120s).
- 영상 + refs: 모델이 r2v 지원 표(D11) 밖이면 `flow-references-model-unsupported {model}`, 유일 ref 가 `FLOW_R2V_REFERENCE_LIMIT`(D13) 초과면 `flow-references-too-many {max}` — 둘 다 세션 게이트 뒤·DOM 전.

### D2. 레퍼런스의 정체성 = 로컬 이미지 바이트(sha256)
- `ref.mediaId`·`entityId` 는 쓰지 않는다(§1-2). 레퍼런스는 로컬 이미지 바이트이고 그 sha256 이 세션 캐시 키의 일부다(D6).
- 엔진이 **ref 하나씩** `resolveReferenceImages([ref], {projectName, strictMime:true})` — 결과가 비면 `flow-reference-source-missing`(IPC 없음). 한 번에 부르면 못 읽은 것이 조용히 빠진다(`referenceResolver.js:90-93`).
- IPC 로는 **경로가 아니라 base64** — main 이 렌더러가 준 경로를 읽는 표면을 만들지 않는다. main 이 `sha256(Buffer.from(base64,'base64'))`.
- 형식 판정은 main 의 `nativeImage.createFromBuffer(buf).isEmpty()` 하나 — 비면 `flow-reference-attach-failed` reason `image-decode-failed`(webp·gif 등; 변환은 범위 밖).

### D3. 멘션·첨부 계획 — 렌더러 순수 함수 `planFlowReferenceComposition` (`src/utils/flowReferencePlan.js`, 새 파일)
호출자: `generateImage`·`submitGeneration`(이미지)·`generateVideoT2V`(영상). 입력: `prompt`(스타일 적용 뒤) · `attached`(훅이 넘긴 매칭 ref) · `pool`(`callOpts.references`, 프로젝트 전체; 영상은 `referenceImages`) · `mode`('image'|'video').
1. 토큰은 `iterateMentions`(`mentionParser.js:45-64`), 해석은 braced 정확 일치 / plain `resolveMentionPrefix`(`:106-116`) — `pool` 의 이름 있는 ref 전체(타입 무관). 맞은 접두만 멘션이고 남은 글자(한글 조사 `이`)는 텍스트.
2. 해석 안 된 토큰: `pool` 에 이름 있는 ref 가 하나라도 있으면 기존 kind `unresolved-mentions` + `unresolvedNames`(옛 규칙 `sceneMentions.js:71-74` 를 타입 무관으로), 없으면 텍스트.
3. 해석된 ref 에 이미지 원천이 없으면 `flow-reference-source-missing`.
4. 같은 ref 를 여러 번 멘션해도 **등장마다 멘션** — [관측] 편집기(P3: 노드 여럿·칩 하나)와 요청(PR §4: 레퍼런스 1개, 멘션 세그먼트 등장마다) 모두.
5. `attach` = `attached` 중 멘션되지 않은 것(정체성: `id`, 없으면 소문자 이름), 중복 제거. 원천 없는 첨부 ref → `flow-reference-source-missing`(배치는 D15 의 M1 제외 가드가 먼저 뺀다).
6. `refs` = 유일 ref(멘션 첫 등장 순 → 첨부 순). 세그먼트는 인덱스로: `[{t:'text', text} | {t:'mention', ref:i}]`. 기대값: 칩 집합 = 모든 `refs`의 id, 멘션 순서열 = 멘션 세그먼트의 id(중복 포함).
7. 영상: `refs.length > FLOW_R2V_REFERENCE_LIMIT` → `flow-references-too-many {max}`. 절차는 이미지와 같다(P9).
8. 스타일 텍스트는 평문 세그먼트.

### D4. 업로드 드라이버 — 클립보드 이미지 + `flowView.webContents.paste()`
**왜 이 길뿐인가**: `maseQ` 는 reCAPTCHA 토큰을 싣고(S3#2·#4), 문서에 파일 입력이 없어 "미디어 업로드" 대화상자는 CDP·OS 자동화 없이는 못 쓴다. 편집기 붙여넣기는 관측된 신뢰 경로이고(C §1 d, PR P1), 포커스 없음·숨은 뷰에서도 된다.

절차(DOM 단계 안, 캐럿 신뢰 클릭 뒤 — 키 잠금·방패 그대로):
1. **사전 판독** 한 번(`READ_COMPOSER_STATE_JS`, D9): `activeElement` ⊂ `div.ProseMirror[contenteditable=true]` · 애셋 창 닫힘 · 바쁜 칩 없음 · 칩 목록 L0. 아니면 reason `focus-not-editor`·`picker-open`·`chip-busy` — **클립보드에 손대기 전**.
2. **클립보드 스냅샷**(D4-c). `text/uri-list` 가 있으면 `flow-reference-clipboard-busy`(쓰기·붙여넣기 없음).
3. `nativeImage.createFromBuffer(bytes)` — 비면 `image-decode-failed`.
4. **업로드 gen arm**: `{rpc:'maseQ', normPrompt:'', setAt, doc:null, …}` 를 `pendingGenerations` 에(붙여넣기 전).
5. 붙여넣기 관찰 주입(`FLOW_PASTE_OBSERVER_INJECTION`, 새 — 문서 capture 단계 `paste` 리스너가 카운터·대상이 편집기 안인지·`clipboardData.files.length` 만 적는다. `preventDefault`/`stopPropagation` 없음, 멱등) → 카운터 n0.
6. `clipboard.writeImage(img)` → 서명 `sig = sha256(clipboard.readImage().toPNG())`.
7. `flowView.webContents.paste()`.
8. 관찰(카운터 > n0)을 ≤3s 폴 — exec 마다 1s 타임아웃 race(죽은 문서의 exec 는 영영 settle 하지 않는다, H2 §5).
9. **관찰 즉시 클립보드 복원**(D4-c) — `finally` 에 두어 관찰 실패·exec 매달림에도 붙여넣기 뒤 ≤5s 안에 반드시(페이지 exec 와 무관한 타이머).
10. 관찰 실패 → gen `settleGen`·삭제, reason `paste-not-observed`; 대상이 편집기 밖 → `paste-wrong-target`.
11. send 마감(15s)은 붙여넣기 뒤 arm, loadend 100s(라우터 기본값 — 6000² 도 7–9s, P8).
12. gen 오류 → reason `upload-not-sent`·`upload-lost`·`upload-rpc-error`·`upload-shape`.
13. **칩 검증**: loadend 뒤 ≤15s 동안 `img.chip-image` 의 id == `maseQ` 응답 id 인 칩이 생기고, 칩 수 = L0 + 1 이어야 한다. **`aria-busy="false"` 만으로는 안 된다**(P1a: busy 해제 뒤 ~2s 동안 img 가 없다). 아니면 `chip-no-id` / `chip-mismatch`.
14. 세션 캐시 기록(D6) — 13 을 통과한 뒤에만.

규칙: 업로드는 한 번에 하나(DOM 단계 자체가 `lastDomStage` 로 전역 직렬화 `flow-angular.js:92,228-238`). 워치독 예산 = `DOM_STAGE_TIMEOUT_MS`(`:83`, 120s) + 120s × 유일 ref 수 — `referencePreflight`(D1)가 계산해 `withAutomationViewport` 의 `timeoutMs` 인자로. `isAborted()` 는 2·6·7 앞과 애셋 창 클릭마다 본다(좀비는 클립보드·붙여넣기를 하지 않는다). 업로드 실패는 전부 **클릭 전**(0크레딧, `postClick` 없음).

**D4-c 클립보드 정책**(사용자 결정 4)
- 스냅샷: `availableFormats()` 에 `text/uri-list` 가 있으면 **올리지 않는다**(파일 복사는 복원할 수 없다). 그 밖엔 `readText`·`readHTML`·`readRTF`·`readImage()`(비지 않으면 `toPNG()`) 중 있는 것만 보관 — 앱 전용 형식(`application/x-lexical-editor` 등)은 보관하지 않고, 멈추지도 않는다. 결과: 앱 텍스트창에서 복사한 것을 다시 앱에 붙이면 Lexical 서식 대신 text/html 로 붙는다(§6 #11).
- 복원: 지금 클립보드의 형식·이미지 서명이 6 에서 쓴 것과 같을 때만 `clear()` 뒤 `write({text?, html?, rtf?, image?})`(빈 스냅샷이면 `clear()`). 다르면 사용자가 그 사이 복사한 것 — 건드리지 않는다(`clipboard changed during upload — not restored`). 복원이 throw 하면 로그만 — 업로드·항목은 계속.
- 노출 창 = 쓰기 → 관찰 → 복원 ≈ 수 ms(P1a).
- 로그: 개수·불리언만(`formats=<n> fileCopy=<bool> restored|skipped|failed`).

### D5. 업로드 응답 캡처·바인딩
- 캡처 허용 목록에 `maseQ`(XHR 로 나간다 — §1-4 ①). send 이벤트 `{kind:'batchexecute-send', doc, rpcid:'maseQ', rpcids, seq, prompts:[], sentAt}` — **본문을 디코드하지 않는다**(수 MB base64·파일명이 이벤트에 들어갈 길이 없다). loadend 는 기존대로 `responseText`(~600B, 페이지가 붙인 `image.png` 포함 — main 이 파싱만).
- `parseUploadResponse(payload)` → `{mediaId}`: `[0][0]` 은 `isFlowMediaId`(UUID), `[1][3][4]` 가 있으면 같아야 한다. 아니면 `FlowRpcShapeError('maseQ … @[0][0]')`. 결과에 파일명 없음.
- 라우터: `maseQ` gen 은 같은 규칙으로 바인딩(업로드 직렬 → 후보 1개), loadend → `settleGen({mediaId})`, 실패 프레임 → 매핑된 오류. 미바인딩 `maseQ`(사용자의 손 업로드)는 조용히 버린다.
- `callFlowRpc` 허용 목록(`electron/flow-rpc-client.js:21` `{nzlxg, jwpduf, as29s}`) 그대로 — `maseQ`·`MZZa6b` 를 앱이 만들 수 없음을 핀.

### D6. mediaId 캐시 — 페이지 세션(문서) 범위, 메모리 전용
- **키** `${doc}|${projectId}|${sha256}`. `doc` = 캡처 주입의 문서 nonce(`window.__autoflowcut_rpc_doc__`, `flow-rpc-capture.js:45-55` — 문서마다 새 값, SPA 내 이동에는 유지)를 컴포즈 전에 한 번 읽는다(없으면 캐시를 안 쓴다 = 업로드). 업로드 기록은 바인딩된 `maseQ` gen 의 `gen.doc` 으로 한다. `projectId` = 새 `projectIdFromFlowUrl(flowView.webContents.getURL())`(`electron/flowUrl.js`, `onProjectComposerUrl` `:96` 과 같은 경계) — `ensureOnProjectComposer` 뒤에 읽는다(페이로드 projectId 는 null 일 수 있다 `shared.js:1237`); null → `flow-reference-attach-failed` reason `no-project-id`(DOM 단계 전).
- **무효화는 키가 한다**: 페이지 로드·내비게이션 커밋이면 `doc` 이 바뀌어 전부 miss(앞 세션 업로드는 썸네일이 불투명해 쓸 수 없다 — P5). 이벤트 배선이 필요 없다.
- **저장**: main 모듈 메모리(`Map`, 상한 200 — 가장 오래된 것부터 버림). **디스크에 쓰지 않는다** — 세션을 넘는 재사용이 불가능하므로 영속은 얻는 것이 없다.
- 캐시는 **힌트**: 항목마다 애셋 창 사전 스캔(D7)이 그 id 의 id 썸네일 항목을 확인한다. 없으면 창을 한 번 다시 열고, 그래도 없으면 항목을 지우고 다시 올린다(사용자 결정 2).

### D7. 애셋 창에서 mediaId 로 고르기
- **열기(＋)**: `button.add-menu-trigger`(컴포저 안 정확히 하나) 신뢰 클릭 → ≤3s: `aria-expanded="true"` ∧ `button.asset-item[role=option]` ≥ 1. 열림 흔적이 전혀 없으면 1회 재클릭(P2 §12 #117 N5 와 같은 조건) → 그래도면 `picker-not-open`.
- **탭**: 리거처 `drive_folder_upload` 의 `[role=tab]`(이미 `aria-selected=true` 면 생략) 신뢰 클릭 → 목록 교체 대기. 없으면 현재 탭(`tab=all`).
- **검색 오염**: 애셋 창의 `input.search-input` 값이 `''` 가 아니면 `picker-search-dirty` — ＋ 창은 검색창이 포커스를 가져가므로 한글 IME 가 키 잠금을 우회해 거기 글자를 넣을 수 있다(가짜 "없음 → 재업로드"를 막는다).
- **항목**: `button.asset-item` 중 자손 `img` 의 src 가 `^https://flow-content\.google/image/<mediaId>(\?|$)` 인 것이 **정확히 하나** → 신뢰 클릭(측정이 `scrollIntoView` 한다 `shared.js:190`). **불투명 항목(`lh3…/asb/…`)은 절대 시도하지 않는다.**
- **미리보기**: `img.detail-preview-image` 의 src 에 id 가 보이면 원하는 id 와 같아야 한다(아니면 `preview-mismatch`, 추가 없음). 불투명이면 이 검사는 건너뛰고 추가 뒤 칩 id 확인에 맡긴다.
- **추가**: `button.detail-add-to-prompt-btn`(정확히 하나) 신뢰 클릭 → 창이 저절로 닫힌다(≤3s 확인) → **칩 id 로 확정**(원하는 id 의 칩이 있어야 한다, 아니면 `chip-mismatch`).
- **사전 스캔**(컴포즈 전 한 번, D9): ＋ → 업로드 탭 → id 썸네일 항목 id 수집 → 세션 캐시에 있는데 목록에 없는 ref 가 있으면 닫고 **한 번 다시 열어** 재수집(앱 재시작 뒤 첫 창의 누락, P5) → 그래도 없으면 캐시에서 지우고 업로드 대상. 이 스캔이 창을 "데운다" — 컴포즈 때 여는 창은 첫 창이 아니다.
- **추가 없이 닫기**(스캔·실패 정리): 트리거 신뢰 클릭 → 닫힘 확인 → 안 닫혔으면(`@` 로 연 창은 트리거로 안 닫힌다, P4) 문서 `body` 에 합성 Escape(keyCode 27 — M2 설정 드라이버와 같은 방식 P2 §11.1 #22, 키 이벤트를 Flow 뷰에 보내지 않는다) → 확인, 아니면 `picker-not-closed`. 다음 ＋ 열기는 위 1회 재클릭 규칙이 헛클릭을 흡수한다.
- 컴포즈 도중 원하는 id 가 안 보이면(사전 스캔 뒤라 드물다) 재업로드하지 않고 `asset-not-found`(클릭 전) + 캐시 항목 삭제 — 다음 항목이 다시 올린다(컴포즈 중 붙여넣기로 편집기를 흐트러뜨리지 않는다).

### D8. 인라인 멘션·텍스트 삽입 — `execCommand('insertText')` 만
1. **텍스트 세그먼트**: `APPEND_EDITOR_TEXT_JS(text)` = 캐럿을 끝으로(`editor.focus()` + 마지막 문단 끝 접힌 선택) + 세그먼트 **통째로** `execCommand('insertText')`(M2 의 `SET_EDITOR_TEXT_JS` `flow-angular.js:49-72` 에서 전체 선택·삭제만 뺀 것) → 편집기 텍스트가 그만큼 늘었는지 확인 → **애셋 창이 닫혀 있어야 한다**. 열렸으면(그 텍스트의 `@` 가 창을 연 것) 클릭 전 거부 reason `at-sign-opened-picker`. 렌더러는 텍스트의 `@` 를 미리 거르지 않는다 — 관측상 단어 안의 `@`·뒤에 글자가 이어지는 `@` 는 창을 열지 않고(P4), 여는 경우는 이 DOM 확인이 잡는다(단순·fail-closed).
2. **멘션**: 캐럿 끝 → `execCommand('insertText','@')` → ≤3s: 편집기가 `@` 로 끝남 ∧ 애셋 창 열림 — 아니면 `mention-trigger-not-working`. 업로드 탭 → 검색 검사(＋ 창과 같은 함수) → 항목 → 미리보기 → 추가(창이 닫힌다). 검증: 끝의 `@` 가 사라지고 `span.mention-chip[data-mention-id="<id>"]` 가 하나 늘었으며 칩 집합에 id 가 있다. 실패 정리는 D7 "추가 없이 닫기"(이 창은 Escape 로만 닫히고 Escape 가 `@` 뒤 입력을 지운다).
3. 멘션 뒤 자동 공백(P3)은 그대로 둔다 — 다음 텍스트 앞 공백이 두 칸이 되거나 조사 앞에 공백이 생기지만(`@king이` → `[king] 이`) 비교는 정규화(공백 압축)로 한다(D9).
- **키 이벤트 없음**: `sendInputEvent` 키·키 잠금 예외·`sendMentionTrigger` 는 만들지 않는다. `insertText` 는 한글 입력기와 무관하다. 편집기 명령(ProseMirror 뷰 인스턴스)은 쓰지 않는다 — 페이지 내부를 뒤지는 것은 사실상 변조이고, 신뢰 UI 경로는 사용자가 한 그대로다.

### D9. 컴포저 정리와 클릭 전 게이트
- **정리**: 컴포저 단계 시작(레퍼런스 없는 M1·M2 경로 포함)과 업로드 뒤. 먼저 애셋 창이 열려 있으면 D7 방식으로 닫는다(지우기는 창이 열린 동안 먹지 않는다, P2). 그다음 칩이나 텍스트가 있으면 `button.clear-button` 신뢰 클릭 → ≤2s 칩 0 ∧ 편집기 빈 것 확인; 칩이 남으면 칩마다 hover(mouseMove)+신뢰 클릭; 그래도면 `composer-not-clear`. 레퍼런스 없는 경로는 기존 `SET_EDITOR_TEXT_JS` 가 텍스트를 지우므로 칩만 본다.
- **순서**: 정리 → 사전 스캔(D7) → 필요한 업로드(D4) → 정리 → 세그먼트 순서대로 텍스트/멘션(D8) → 첨부 ref 마다 ＋ 추가(D7) → 게이트.
- **게이트**(한 번의 `READ_COMPOSER_STATE_JS`, 전부 클릭 전 = 0크레딧): (1) 애셋 창 닫힘 (2) 바쁜 칩 없음 (3) 칩 id 에 null·중복 없음, 집합 == 기대 집합 (4) `data-mention-id` 순서열 == 기대 멘션 순서열(중복 포함) (5) 텍스트 부분(멘션 노드를 뺀 텍스트 노드들, `' '` 결합)의 `normalizePrompt` == `normalizePrompt(plan 텍스트 세그먼트)` — 공백 압축이 멘션 뒤 자동 공백을 흡수한다 (6) 닫힌 설정 요약(`READ_SETTINGS_SUMMARY_JS` `flow-composer-dom.js:72`) == 설정 단계 직후 판독값. 실패 사유는 `flow-reference-attach-failed` 의 `reason`.
- **이후 가드**: 게이트 통과 때의 `normalizePrompt(readEditorText)`(라벨·자동 공백 포함)를 `editorExpected` 로 적고, `editorChangedBeforeClick`(`flow-angular.js:176-184`)·`makeDispatchGuard`(`:155-163`)는 프롬프트 대신 `editorExpected` **와 칩 집합**을 비교한다. 재판독~mouseDown 사이의 변화는 기존 Q1 경로(`:457`)로 클릭 전 실패.
- **gen 필드**: `normPrompt = normalizePrompt(plan 텍스트 세그먼트 배열)` — 캡처의 `extractSubmitPrompts` 가 멘션 세그먼트를 건너뛰고 텍스트만 `' '` 로 잇는 값과 같다(`flow-rpc-protocol.js:356-365`). `expectedRefs`(집합) · `expectedMentions`(순서열).

### D10. 제출 RPC 라우팅 — `MZZa6b`
- 이미지: 항상 `ogiZ0b`. 영상: refs 있음 → `gen.rpc='MZZa6b', altRpcs:['YhhmEf']`; 없음 → `gen.rpc='YhhmEf', altRpcs:['MZZa6b']`. 라우터는 `rpc ∪ altRpcs` 로 후보를 잡고(`flow-rpc-router.js:138` 확장) `gen.boundRpc` 를 적는다; 파싱은 `boundRpc` 로. 핸들러: `boundRpc ≠ gen.rpc` → 클릭 뒤 `flow-references-mismatch`(+`rejectedMediaId`, `postClick`) — 과금은 됐고 새 제출만 멈춘다.
- 유예(`SEND_GRACE_RPCS` `:42`)·미바인딩 보고(`:179-183`, `noteUnboundClose` `:50-54`)를 `MZZa6b` 로 넓힌다.
- 캡처 send 이벤트에 `refs`·`mentions`(id 만): `ogiZ0b` 는 `inner[1][i][2][j][0]`·`inner[1][i][8][0][k][1][0][0]`(멘션 세그먼트 `seg[0]===null`), `MZZa6b` 는 `inner[0][i][1][j][1]`·`inner[0][i][0][2][0][k][1][0][0]`(P9). UUID 가 아니거나 모양이 다르면 `null`(= 검증 불가, D12); 항목이 여럿(x2~x4)이면 항목마다 같아야 하고 다르면 `null`. `extractSubmitPrompts` 에 `MZZa6b`(경로는 `YhhmEf` 와 같은 `inner[0][i][0][2][0]`).

### D11. 모델키 검증 확장
- `modelKeyMatches(key, want)` 에 `want.kind`('t2v' 기본 | 'r2v') — 키의 둘째 토큰이 `kind` 와 같아야 한다. 기존 t2v 진리표(P2 M2-1) 무변경.
- r2v 표(CAT): `abra_r2v_{4,6,8,10}s[_360p]` ↔ Omni Flash(길이·해상도 규칙은 t2v 와 같다) · `veo_3_1_r2v_fast_{portrait|landscape}[_ultra|_relaxed…]` ↔ Veo 3.1 Fast, 8초, **방향 토큰 필수** — 9:16 ↔ `_portrait`, 16:9 ↔ `_landscape`. `veo_3_1_r2v_lite` 는 false(패널 미관측), Veo Quality r2v 는 CAT 에 없음 → false.
- **클릭 전 지원 표** `R2V_MODELS` = {Omni Flash, Veo 3.1 Fast}(실기 관측 S3#10·#15) — 밖이면 D1 의 `flow-references-model-unsupported`. 모델키 문법(`flow-rpc-protocol.js:174`)은 그대로.
- `parseVideoSubmitResponse(payload, rpcid)` — shape 경로 문구가 rpcid 를 쓴다(`:178` 의 고정 제거). `describeWant` 에 `kind`.

### D12. 클릭 뒤 레퍼런스 검증
- 근거 둘: **요청**(캡처 send 의 `refs`·`mentions`) · **응답 되돌림**(이미지 `[0][i][6][0][15][3][0][j][2]`, 영상 `[3][0][5][6][1][1][j][2]`).
- 있는 근거는 전부 기대와 같아야 한다(레퍼런스 = 집합·개수, 멘션 = 중복을 보존한 순서열 — 같은 미디어 두 번 멘션이면 레퍼런스 1개·멘션 2개, [관측] PR §4). **하나라도 어긋나면 거부**. 근거가 하나도 없으면(모양 드리프트) **수용 + warn + `reportDomFailure('rpc-shape:<rpc>@refs')`** — 클릭 뒤라 돈은 이미 나갔고 클릭 전 게이트(D9)가 칩·멘션을 증명했다.
- 이미지 거부: `{success:false, errorKind:'flow-references-mismatch', postClick:true}`, **다운로드 없음**(0크레딧).
- 영상 거부: `+ rejectedMediaId`·`postClick:true`·`errorParams:{}`, `mediaId`/`generationId` 키 없음(P2 D8-6) → 훅의 `submitHalt` 가 새 제출만 멈춘다.
- 로그(개수만): `refs verified request=<n> echo=<n>` / `refs mismatch request=<got>/<want> echo=<got>/<want>`.

### D13. 레퍼런스 개수 상한
- 영상: Flow 전용 상수 **`FLOW_R2V_REFERENCE_LIMIT = 3`**(`src/utils/flowReferencePlan.js` 에서 export — main 은 `src/utils` 를 import 하는 선례(`flow-rpc-protocol.js:22`)대로 같은 값을 쓴다). 근거: CAT `[9]` 이 veo r2v 3·abra r2v 7, 영상 다중 레퍼런스는 미관측. API 모드 상수 `VIDEO_REFERENCE_IMAGE_LIMIT`(`genModels.js:43`)와 묶지 않는다. 렌더러 계획(D3-7)과 main(D1)이 둘 다 막는다.
- 이미지: 앱 상한 없음. UI 가 칩을 안 받으면 게이트(D9-3)가 클릭 전에, 서버가 거부하면 실패 프레임(`flow-rpc-error`, 0크레딧)이 닫는다.

### D14. 결과 계약 · 새 kind · 문구 · 로그
결과 계약은 P2 §3 그대로(이미지 `{success, images}`, 영상 `{success, generationId, creditsLeft}`). 새 kind(ko/en `errorSection.kind.*`, params 는 이 표만):

| kind | 언제 | params | ko | en |
|---|---|---|---|---|
| `flow-reference-attach-failed` | 업로드·애셋 창·멘션·칩·게이트 실패(클릭 전). `reason` 필드(렌더 안 함) | `{}` | Flow 에 레퍼런스를 붙이지 못해 생성하지 않았습니다(크레딧 사용 없음). 다시 시도해 주세요. | Couldn't attach the references in Flow, so nothing was generated (no credits used). Please try again. |
| `flow-reference-source-missing` | ref 이미지 바이트를 못 읽음(렌더러, IPC 전) | `{}` | 레퍼런스 이미지 파일을 읽을 수 없어 생성하지 않았습니다. 레퍼런스 탭에서 이미지를 다시 지정해 주세요. | Couldn't read a reference image file, so nothing was generated. Re-select the image in the References tab. |
| `flow-reference-clipboard-busy` | 클립보드에 `text/uri-list`(D4-c) | `{}` | 클립보드에 Finder 에서 복사한 파일이 있어 레퍼런스 업로드를 멈췄습니다. 텍스트를 한 번 복사한 뒤 다시 시도해 주세요. | Your clipboard holds a file copied in Finder, so the reference upload was stopped. Copy any text once and try again. |
| `flow-references-mismatch` | 클릭 뒤 레퍼런스 불일치(D10·D12) | `{}` | Flow 가 요청과 다른 레퍼런스로 생성해 결과를 쓰지 않았습니다. 영상이라면 Flow 에는 남아 있습니다(크레딧 사용됨). | Flow generated with different references than requested, so the result was not used. A video stays in Flow (credits were used). |
| `flow-references-model-unsupported` | refs + r2v 미지원 모델(D11) | `{model}` | {model} 은(는) Flow 에서 레퍼런스 영상을 지원하지 않습니다. Omni Flash 또는 Veo 3.1 Fast 를 선택해 주세요. | {model} doesn't support reference-to-video in Flow. Choose Omni Flash or Veo 3.1 Fast. |
| `flow-references-too-many` | 영상 ref > 상한(D13) | `{max}` | Flow 레퍼런스 영상은 레퍼런스를 최대 {max}개까지 쓸 수 있습니다. | Flow reference-to-video accepts at most {max} references. |

- `flow-references-unsupported` 문구는 남는 경우(레퍼런스 생성의 스타일 ref, 옛 모양 페이로드)에 맞게 고친다. `flow-mention-chips-unsupported`·`flow-t2v-reference-images-unsupported` 는 생산자가 사라지지만 저장된 옛 항목 표시용으로 문구를 둔다.
- `flow-reference-attach-failed` 의 `reason` 어휘: `bad-plan`·`no-project-id`·`focus-not-editor`·`picker-open`·`chip-busy`·`image-decode-failed`·`paste-not-observed`·`paste-wrong-target`·`upload-not-sent`·`upload-lost`·`upload-rpc-error`·`upload-shape`·`chip-no-id`·`chip-mismatch`·`picker-not-open`·`picker-not-closed`·`picker-search-dirty`·`preview-mismatch`·`asset-not-found`·`mention-trigger-not-working`·`at-sign-opened-picker`·`composer-not-clear`·`chip-set-mismatch`·`mention-mismatch`·`text-mismatch`·`summary-changed`.
- **배치 중단**(P2 §3): 영상 훅 `REPEATABLE_PRECLICK_KINDS`(`src/hooks/useVideoAutomation.js:65`)에 `flow-references-model-unsupported`·`flow-reference-clipboard-busy`, 그리고 `flow-reference-attach-failed` 중 배치 전체 사유(`paste-not-observed`·`mention-trigger-not-working`·`picker-not-open`·`picker-not-closed`·`no-project-id`)만 — 같은 kind+reason 두 번 연속이면 종결. 나머지 attach 사유는 항목 사유. 이미지 배치는 기존 3연속 실패 규칙(`useAutomation.js:392-393`).
- **로그 접두**: `[Flow Refs]`(계획·캐시·애셋 창·멘션·게이트) · `[Flow Upload]`(클립보드·붙여넣기·maseQ). 진단 보고 스텝 `refs:<reason>` · `upload:<reason>` · `rpc-shape:maseQ@…`(내용 없음).

### D15. 렌더러 배관 · 동기화 게이트 퇴역
- `useAutomation.js:296` Flow 필터 `flowImageInjectable` → `sourceAvailable`(+`imagePath → filePath`), `:624-629` Flow 선행 업로드 없음(`refsToUpload = []`, 주석으로 이유) — 이 배치는 `submitGeneration` 으로 간다(D1).
- `useSceneGeneration.js:108-128` 은 이미 name/data/filePath 를 넘긴다 — 그대로(`generateImage`).
- `refImageGuard.js:80-136` `collectM1FlowReferenceExclusions`: Flow(M3) 에서 쓸 수 있음 = `sourceAvailable`(멘션·첨부 공통). mediaId 만 있는 ref 는 기존 제외 토스트로 빠진다(§6 #9).
- `mentionSyncTargets.js:22-41` → 항상 `[]`(새 Flow 엔 엔티티 동기화가 없고 엔진은 `parseSceneMentions` 를 안 쓴다 — "파서가 둘이면 어긋난다" `:8-10`). 그래서 `emptyRefGate.js:188-193`·`App.jsx:1796-1799`·`mentionSyncRequest.js:39` 가 모달 없이 통과하고 MCP 의 `nonInteractiveSyncGate` 가 멘션 배치를 취소하지 않는다. 옛 동기화 UI·코드 정리는 범위 밖.
- `videoPromptReferences.js:60-70` Flow 분기: `referenceImages` = 멘션된 원천 있는 ref(`toGenerationReference`, 자르지 않는다 — 상한은 D3 가 거부), `styledPrompt` 는 `@` 토큰 유지, `segments: null`, `missing` = 미해결 이름. `engineFlow.generateVideoT2V` 가 D3 → 바이트 → IPC `refs`·`plan`.

### D16. M2 함정 · 새 위험 대응표

| 함정/위험 | 대응 | 핀(작업) |
|---|---|---|
| 화면 밖 뷰는 재레이아웃 안 됨 | 붙여넣기·애셋 창도 기존 제자리 뷰포트+방패 안(`flow-angular.js:259-272`) — 숨은 뷰에서 붙여넣기 관측(P1c) | M3-9 숨은 뷰 |
| Escape 로 닫은 패널 → 다음 트리거 헛클릭 | 애셋 창은 추가(자동 닫힘)·트리거로 닫고, `@` 창 정리만 합성 Escape; 다음 열기는 1회 재클릭 규칙 | M3-8 |
| 한글 IME 가 키 잠금 우회 | `@` 는 `insertText`(입력기 무관). 편집기 오염은 게이트·`editorExpected`·칩 관문(Q1)이, ＋ 창 검색 오염은 `picker-search-dirty` 가 클릭 전에 | M3-8·M3-9 |
| 문서 이동을 넘긴 `executeJavaScript` 는 영영 settle 안 함 | 폴 exec 마다 1s race, 클립보드 복원은 exec 무관 5s 마감, `did-navigate` 의 `failBoundUnfinished` 가 바인딩된 `maseQ` gen 을 닫는다, 세션 캐시는 `doc` 키로 저절로 무효 | M3-6·M3-7 |
| 방패 focus 가 편집기로 포커스를 되돌림 | 컴포즈는 행선지 `'flow'`, 게이트·재판독 뒤 `focusMainWindow()`(`:147-150`) 그대로 | M3-9 순서 핀 |
| 사용자 클립보드 덮어쓰기 | D4-c — 관찰 즉시 조건부 복원, 파일 복사면 거부 | M3-5·M3-7 |
| 붙여넣기가 다른 입력란으로 | 사전 판독(`activeElement` ⊂ 편집기, 창 닫힘) + 관찰 리스너의 대상 확인 | M3-7 |
| 업로드 칩이 id 없이 한동안 남음 | busy 해제가 아니라 id img 까지 기다림(≤15s) | M3-7 |
| 중복 업로드 | 직렬 업로드 + 세션 캐시 + 항목 안 sha 중복 제거; 세션을 넘으면 ref 당 1장(결정 2) | M3-6·M3-8 |
| 멘션 삽입 중 편집기 오염(사용자 타이핑) | 키 잠금 + 삽입마다 검증 + 게이트 + mouseDown 직전 관문 | M3-8·M3-9 |
| 메뉴 "편집 → 붙여넣기" 클릭이 DOM 단계 중 사용자 클립보드를 Flow 뷰에 | 여분 칩 → 게이트(칩 집합 불일치) 클릭 전 | M3-8 |

---

## 3. M3-0 — 프로브 결과(완료, PR) → 설계 반영

| 프로브 | 결론 | 반영 |
|---|---|---|
| P1a·b·c | 포커스 없음·숨은 뷰에서 붙여넣기 업로드 됨, 관찰 즉시 복원 가능, 칩 id 는 busy 해제 ~2s 뒤 | D4(포커스 단계 없음, 복원 즉시, id img 대기) |
| P1d | 형식 목록(§1-4 ⑪) | D4-c(사용자 결정 4) |
| P2 | 칩 hover+클릭 = 한 칩 제거, 지우기 = 전부, 창 열리면 지우기 불가 | D9 |
| P3 | 멘션 노드 `span.mention-chip[data-mention-id]`, 칩 추가, 중복 멘션 허용, 자동 공백 | D3-4·D8·D9 |
| PR §4 | 같은 미디어 두 번 멘션의 요청(이미지·영상): 레퍼런스 1개, 멘션 세그먼트 등장마다, 되돌림 1개(S3#19·#20 — 버린 프로브 도구의 가드된 생성 단계로 채움, 영상 7크레딧) | D3-4·D10·D12 |
| P4 | `insertText('@')` 로 열림, 한 번에 넣은 텍스트 속 `@` 는 안 열림, `@` 창은 Escape 로만 닫힘 | D8·D7 |
| P5 | 탭 리거처·가상 스크롤·미리보기 클래스·추가 시 자동 닫힘·**세션 범위 id 썸네일**·첫 창 누락 | D6·D7(사용자 결정 2) |
| P6·P8 | 같은 이미지 = 새 id · 크기 무관 7–9s | D6·D4(전용 마감 없음) |
| P7 | 전환에도 칩·멘션 유지 | D9 순서 그대로 |
| P9 | 영상 인라인 멘션 = 이미지와 같은 세그먼트 | D3·D10(영상도 인라인) |

**구현 중 0크레딧으로 확인할 것**(설계는 모두 fail-closed 로 이미 닫혀 있다 — §6): `@` 창이 키 잠금 켠 상태에서 **문서 합성 Escape** 로 닫히는지(프로브는 잠금 없이 닫았다 — 정리 경로에만 쓰인다) · 문단 첫머리/`(` 바로 뒤의 단독 `insertText('@')` 가 창을 여는지.

---

## 4. TDD 작업 목록

### 구현자 공통 규칙 (P2 §3 의 규칙 전부 + M3 추가)
- P2 §3 그대로: 결과 계약 · kind→params 고정표(D14 로 확장) · 배치 중단 의미 · 마감·시각(초) · 주입 문자열 자기완결·멱등·minify 평가 · 로그 내용 금지 · 픽스처 재인코딩.
- **작업마다**: 실패 테스트(빨간 단언 확인) → 최소 구현 → 파일 초록 → 전체 스위트 초록(`env -u ELECTRON_RUN_AS_NODE npx vitest run`) → 뮤테이션 1회 이상(빨강 확인 후 `cmp` 복구). 새 소스 핀은 줄머리 앵커(`^\s*…/m`, P2 §12.11 관찰 6).
- **M3 픽스처**: 새 로더 `tests/fixtures/flow-m3-samples.js` — S3 를 `step`(+`rpcid`)로 고르고 `<uuid#n>` 을 `maskedUuid(n)`(`tests/fixtures/flow-batchexecute-samples.js:18-20`)로, 요청은 `reencodeRequestBody`(`:49-54`) 규칙으로. 영상 인라인 멘션은 S3#17, 같은 미디어 두 번 멘션은 S3#19(이미지)·S3#20(영상). DOM 픽스처 `tests/fixtures/flow-live-dom-m3.js` — RAW 칩 바·지우기·트리거 마크업(마스킹) + PR P3 멘션 span + P5 셀렉터(탭 리거처·`cdk-virtual-scroll-viewport`·`img.detail-preview-image`), **영어 변형**(탭 텍스트 "Uploads", 칩 aria-label "Ingredient")을 같이 — 파인더가 문구를 안 보는 증명.
- **가짜 페이지** `tests/helpers/fakeFlowComposer.js`(새) — jsdom 문서에 칩 바·편집기·애셋 창을 그리고 **프로브에서 본 대로** 동작한다: ＋ 트리거 토글 · 탭 필터 · 항목 클릭(active·미리보기) · 추가(창 자동 닫힘; ＋ 창 = 칩 추가, `@` 창 = 멘션 span + 뒤 공백 + 칩 추가, 같은 미디어면 칩 병합·끝으로) · 캐럿 끝 `insertText` 가 정확히 `'@'` 일 때만 `@` 창을 연다 · `@` 창은 트리거 클릭 무반응·body 합성 Escape 로 닫힘(`@` 뒤 입력 삭제) · 지우기 버튼(창이 열려 있으면 무반응) · 칩 hover+클릭 제거 · 항목 썸네일: `sessionIds` 는 id img, 나머지 불투명 · `opts.firstOpenMissing`(첫 열기에 최신 업로드 누락) · 붙여넣기(관찰 리스너가 보는 `paste` + 새 칩: `busyMs` 동안 busy·img 없음 → `imgMs` 까지 busy 해제·img 없음 → id img) · 미리보기 id/불투명. 핸들러 하네스의 `executeJavaScript` 는 컴포저 스크립트를 이 문서의 `window.eval` 로 **실제로** 돌리고(P2 §12.3 #66·§12.7 #103 선례), 나머지(WIZ·캡처 프로브·설정 드라이버·에이전트)는 기존 하네스(`tests/electron/ipc/flowGenerateImageAngular.test.js:31-120`)처럼 마커로 라우팅한다. 신뢰 클릭 가짜는 표현식이 돌려준 요소에 mouseMove(hover)·click 을 보낸다.

**M3-1 프로토콜(순수)** — `tests/electron/flow-rpc-protocol.test.js` / `electron/flow-rpc-protocol.js`
- `extractSubmitRefs(rpcid, inner)`(새, 자기완결 — 캡처에 직렬화): S3#9 → `{refs:[U2,U3], mentions:[U2]}`; S3#3 → `{refs:[U2], mentions:[]}`; 09-24 S1(`[1][0][2]=null`) → `{refs:[], mentions:[]}`; S3#10 → `{refs:[U2], mentions:[]}`; S3#17 → `{refs:[U2], mentions:[U2]}`; **S3#19 → `{refs:[U46], mentions:[U46,U46]}`, S3#20 → `{refs:[U52], mentions:[U52,U52]}`**(중복 보존 — 집합으로 접는 구현은 빨갛다); S3#14 → `{refs:[], mentions:[]}`; `[1][0][2]` 가 문자열인 사본 · 비-UUID id · x2 항목 목록이 다른 사본 → `null`(빈 배열과 구분). `U<n>` = `maskedUuid(n)`.
- `extractSubmitPrompts('MZZa6b', S3#10)` → `['The king walks slowly toward the camera']`(지금은 `[]`); S3#17 → `[' walks toward the camera']`(텍스트만); `('ogiZ0b', S3#9)` 정규화 → `'and a queen in a garden'`; S3#19 정규화 → `'walks with in a garden'`.
- `parseUploadResponse`: S3#4 → `{mediaId:U3}`, S3#2 → `{mediaId:U2}`; `[1][3][4]` 가 다른 사본·`[0][0]` 비-UUID → `/maseQ response shape changed at \[0\]\[0\]/`; `JSON.stringify(결과)` 에 `image.png`·`king.jpg`·`image/` 없음.
- `parseVideoSubmitResponse(payload, 'MZZa6b')`: S3#10 → `{mediaId:U30, modelKey:'abra_r2v_4s', creditsLeft:904, refEcho:[U2]}`; S3#15 → `U40`·`veo_3_1_r2v_fast_portrait`·864; S3#20 → `U57`·850·`refEcho:[U52]`(하나); `[3][0][7][0][12]` 삭제 → 메시지 `MZZa6b response shape changed` + `rejectedMediaId:U30`; 되돌림 삭제 → 성공 + `refEcho:null`. 기존 `YhhmEf` 케이스 무변경.
- `parseImageGenerateResponse`: S3#9 `refEcho` = `[U2,U3]`, S3#3 = `[U2]`, S3#19 = `[U46]`, 09-24 S1 = `null`.
- `modelKeyMatches` r2v 진리표(CAT 키만): **true** `('abra_r2v_4s', Omni Flash,4,'9:16','720p',r2v)` · `('abra_r2v_6s_360p', Omni,6,'16:9','360p',r2v)` · `('veo_3_1_r2v_fast_portrait', Veo 3.1 - Fast,8,'9:16',r2v)` · `('veo_3_1_r2v_fast_landscape', Fast,8,'16:9',r2v)` · `('veo_3_1_r2v_fast_portrait_ultra_relaxed', Fast,8,'9:16',r2v)`; **false** `('abra_r2v_4s', …kind 생략)` · `('abra_t2v_4s', …r2v)` · `('veo_3_1_r2v_fast_portrait', Fast,8,'16:9',r2v)` · `('veo_3_1_r2v_fast_landscape', Fast,8,'9:16',r2v)` · `('veo_3_1_r2v_lite', Lite,8,r2v)` · `('abra_r2v_4s', Omni,6,r2v)` · `('abra_i2v_4s', …r2v)`. 기존 t2v 표 초록 유지. F12 핀(P2 §12.3 #72): 새 shape 경로 인덱스도 < 100.
- 뮤테이션: 방향 토큰 검사 삭제 → landscape/portrait 행 빨강; 멘션 세그먼트를 텍스트로 셈 → S3#9·#17 빨강; 멘션을 중복 제거 → S3#19·#20 빨강.

**M3-2 캡처 주입** — `tests/electron/flow-rpc-capture.test.js`, `tests/electron/flow-injections-minified.test.js` / `electron/flow-rpc-capture.js`
- vm+FakeXHR(`tests/electron/flow-xhr-capture.test.js:13-35` 방식): S3#10 재인코딩 → send `{rpcid:'MZZa6b', prompts:['The king…'], refs:[U2], mentions:[]}`; S3#17 → `mentions:[U2]`; S3#9 → `refs:[U2,U3], mentions:[U2]`; S3#19 → `refs:[U46], mentions:[U46,U46]`; S3#20 → `refs:[U52], mentions:[U52,U52]`; S3#4(`maseQ`) → `{rpcid:'maseQ', prompts:[]}` 이고 `JSON.stringify(ev).length < 400`, `<b64`·`image.png`·`image/png`·`SECRET` 없음; `maseQ` loadend 는 `responseText` 를 싣는다; 옛 ogiZ0b/YhhmEf 이벤트는 `refs` 추가 외 무변경; `send` body 불변(세 rpc).
- minified 번들에서 같은 페이로드. 뮤테이션: `maseQ` 도 디코드 → 길이·문자열 단언 빨강; 허용 목록에서 `MZZa6b` 제거 → 빨강.

**M3-3 라우터** — `tests/electron/flow-rpc-router.test.js` / `electron/flow-rpc-router.js`
- `{rpc:'MZZa6b', altRpcs:['YhhmEf']}` + `YhhmEf` send → 바인딩, `boundRpc==='YhhmEf'`; loadend 09-24 S2 → settle(파서 `YhhmEf`). `altRpcs` 없는 gen + 다른 rpc → 미바인딩(옛 동작).
- send `refs`/`mentions` → `gen.sentRefs`/`gen.sentMentions`(없으면 `null`).
- `maseQ` gen: 바인딩 → loadend S3#4 → `gen.mediaId===U3`, `gen.doc` 기록; 실패 프레임 → `flow-rpc-error`+`rpcCode`; 15s send 없음 → `flow-submit-not-sent`(유예 없음); 미바인딩 `maseQ` loadend → `{dropped:'unbound'}`, 보고 없음.
- `MZZa6b` send 마감 → 유예(`YhhmEf` 표에 행 추가); 최근 닫힌 `MZZa6b` gen 뒤 미바인딩 `MZZa6b` 200 → `media=<8>` 줄 + 보고.
- 뮤테이션: `SEND_GRACE_RPCS` 에서 `MZZa6b` 제거 → 빨강; `noteUnboundClose` 를 `YhhmEf` 만 → 빨강.

**M3-4 컴포저 레퍼런스 DOM 파인더** — `tests/electron/flow-composer-refs.test.js`(새) / `electron/flow-composer-refs.js`(새, 순수 + `*_JS` 단일 표현식)
- `readComposerState(doc)` → `{chips:[{mediaId, busy}], segments:[{t:'text', text}|{t:'mention', mediaId, label}], editorText, pickerOpen, searchDirty, activeInEditor}`: 칩 순서; `aria-busy="true"` → busy; **`aria-busy="false"` 인데 img 없음 → `mediaId:null`**(busy 아님); 서명 쿼리 붙은 src 에서 UUID 만; 멘션 = `span.mention-chip[data-mention-id]`(id·라벨 분리, 라벨은 텍스트 부분에서 빠진다); 영어 변형 픽스처에서 같은 결과.
- `findAssetItemByMediaId(doc, id)` → 정확한 요소; 같은 id 둘 → `null`; 불투명 썸네일 항목은 어떤 id 로도 안 잡힘; 접두 id 오매칭 없음(`(\?|$)`); `listIdAssetMediaIds(doc)` 는 id 썸네일 항목만.
- `findPickerTab(doc,'drive_folder_upload')` → 아이콘으로, 아이콘 없이 "업로드" 텍스트만 → `null`; `readPickerPreviewMediaId` → id 또는 불투명이면 `null`; `findAddMenuTrigger`·`findClearPromptButton`·`findAddToPromptButton`·`findChipByMediaId` 각각 정확히 하나일 때만.
- `noLocaleBoundDomAnchors`(무변경) 초록.

**M3-5 클립보드** — `tests/electron/flow-clipboard.test.js`(새) / `electron/flow-clipboard.js`(새; `clipboard`·`nativeImage` 주입)
- `snapshotClipboard`: `['text/plain','text/html','application/x-lexical-editor']` → 막지 않음, 복원 때 `write` 가 **정확히** `{text, html}`(Lexical 형식 없음); `['text/plain','text/uri-list']` → `fileCopy:true`(호출자가 거부); `['image/png']` → `write({image})`; rtf 보관·복원; 빈 클립보드 → 복원 = `clear()` 만.
- `writeUploadImage` → `writeImage` 1회 + 서명. `restoreClipboard`: 서명 같음 → `clear` 뒤 `write`; 우리가 쓴 뒤 다른 텍스트로 바뀜 → `{restored:false, reason:'changed-by-user'}`, **`write`·`clear` 미호출**; `write` throw → `{restored:false, reason:'restore-threw'}`, 다시 던지지 않음.
- 로그에 스냅샷 텍스트·html·rtf 없음. 뮤테이션: 서명 비교 삭제 → changed-by-user 빨강; `uri-list` 검사를 "표준 밖 형식 전부"로 → Lexical 케이스 빨강.

**M3-6 세션 캐시 + 프로젝트 id** — `tests/electron/flow-ref-media-cache.test.js`(새), `tests/electron/flowUrl.test.js` / `electron/flow-ref-media-cache.js`(새, 메모리 전용), `electron/flowUrl.js`
- `get/set/delete(doc, projectId, sha)`; **다른 `doc` → miss**(페이지 세션 범위); 다른 프로젝트 → miss; 상한 200+1 → 가장 오래된 것 삭제; 같은 바이트 다른 이름 → hit; 모듈이 `fs` 를 import 하지 않는다(소스 핀 — 영속 없음).
- `projectIdFromFlowUrl`: `https://flow.google.com/project/<id>` → id; `/project/<id>/character`·`?next=/project/<id>`·다른 호스트·옛 도메인 → `null`.

**M3-7 업로드 드라이버** — `tests/electron/flow-reference-upload.test.js`(새) / `electron/flow-reference-driver.js`(새) `uploadReferenceByPaste(ctx, ref)`, `FLOW_PASTE_OBSERVER_INJECTION`
- 하네스: `fakeFlowComposer` + 가짜 클립보드 + 실제 라우터 ctx(`routeReportResponse`·`buildReportCtx`) + `page.send/loadend('maseQ', S3#4)`, 가짜 타이머.
- 정상: trace `state-read → clipboard:snapshot → clipboard:writeImage → paste → paste-observed → clipboard:restore → maseQ:send → maseQ:loadend → chip-id → cache:set` — **복원이 send 보다 먼저**; 칩 수명 `busyMs:100, imgMs:9600` 에서 결과는 9.6s 이후에만 `{ok:true, mediaId:U3}` — **busy 해제(7.9s) 시점에 성공하는 구현은 빨갛다**; loadend 뒤 15s 안에 id img 가 없으면 `chip-no-id`.
- `activeElement` 가 애셋 검색창 → `availableFormats`·`writeImage`·`paste` 미호출, `focus-not-editor`. `uri-list` → `flow-reference-clipboard-busy`, `writeImage`·`paste` 미호출. Lexical 형식 → 진행.
- 관찰 exec 가 영영 settle 안 함 → 붙여넣기 뒤 5s 안에 `clipboard:restore`, `paste-not-observed`, gen 삭제, `cache:set` 없음. 관찰 대상이 편집기 밖 → `paste-wrong-target`. 사용자가 업로드 중 복사 → 복원 안 함, 업로드 성공.
- `maseQ` 실패 프레임 → `upload-rpc-error`; loadend id ≠ 칩 id → `chip-mismatch`, `cache:set` 없음; 새 칩 둘 → `chip-mismatch`. `isAborted()` 가 쓰기 전 true → 클립보드·붙여넣기 없음. 로그·보고에 base64·`image.png`·경로 없음.
- 뮤테이션: 복원을 성공 경로로만 → exec-hang 빨강; id img 대기를 busy 해제 대기로 → 칩 수명 케이스 빨강.

**M3-8 컴포즈 드라이버(사전 스캔·애셋 창·멘션·정리·게이트)** — `tests/electron/flow-reference-compose.test.js`(새) / `flow-reference-driver.js` `closePicker`·`clearComposer`·`scanUploadedAssets`·`attachAsset`·`insertMention`·`appendText`·`composeReferencePlan`·`readGate`
- 계획 `[text 'A ', mention r0, text ' walks with ', mention r1, text ' and ', mention r0]` + attach `[r2]`, 세 id 모두 세션 목록에 있음 → 최종 멘션 순서열 `[m0,m1,m0]`, 칩 집합 `{m0,m1,m2}`, **`paste` 0회**(재사용), 텍스트 정규화 일치(자동 공백 흡수).
- 세션 캐시 hit 인데 첫 스캔에 없음(`firstOpenMissing`) → 닫고 다시 열기 1회 → 찾음 → 업로드 0회; 두 번 다 없음 → 그 ref 만 업로드 1회 + 캐시 교체 + 업로드 뒤 정리.
- 앞 세션 업로드(불투명 항목)만 있는 ref → 불투명 항목 **클릭 없음**, 업로드.
- 텍스트 세그먼트 `'@'`(창을 여는 가짜) → `at-sign-opened-picker`, arm·제출 없음; `'mail a@b.com now'` → 정상.
- 검색창에 글자 → `picker-search-dirty`, 업로드·추가 없음. 미리보기 id 다름 → `preview-mismatch`; 미리보기 불투명 → 검사 생략·칩 id 로 확정.
- 추가 뒤 여분 칩 → `chip-set-mismatch`; **칩 개수는 같고 id 하나가 다름**(가짜가 m2 대신 m9 를 붙임) → `chip-set-mismatch`; 멘션 순서 뒤바뀜 → `mention-mismatch`; **멘션 순서열 길이는 같고 id 하나가 다름**(`[m0,m1,m9]`) → `mention-mismatch`. 넷 다 arm·제출 없음.
- 시작 때 `@` 창이 열려 있음 → 트리거 클릭 무반응 → 합성 Escape → 닫힘 → 지우기 → 비워짐(창을 먼저 닫지 않고 지우기를 누르는 구현은 빨갛다); 칩만 남는 픽스처 → 칩 hover+클릭.
- 애셋 창 첫 클릭 헛돔 → 1회 재클릭; 두 번 다 → `picker-not-open`. `@` 가 창을 안 엶 → `mention-trigger-not-working`. 같은 sha 두 ref → 업로드 1회.
- 뮤테이션: 게이트 집합 비교를 개수 비교로 → "같은 개수 다른 id" 칩 케이스 빨강; 멘션 비교를 길이 비교로 → "같은 길이 다른 id" 멘션 케이스 빨강; 다시 열기 삭제 → `firstOpenMissing` 이 업로드로 빨강; 텍스트 삽입 뒤 창 확인 삭제 → `'@'` 케이스 빨강.

**M3-9 이미지 핸들러** — `tests/electron/ipc/flowImageReferencesAngular.test.js`(새), `tests/electron/ipc/flowGenerateImageAngular.test.js`(칩 게이트·대체 경로 행) / `electron/ipc/flow-angular.js` `referencePreflight`·`generateImage`·`collectRpcGen`·`makeDispatchGuard`·`editorChangedBeforeClick`·`withAutomationViewport(…, {timeoutMs})`
- 순서: 세션 → 에이전트 → 캡처 → 설정 → 캐럿 → 정리 → 사전 스캔 → (업로드 → 정리) → 컴포즈 → 게이트 → `focusMainWindow` → 제출 가능 → 재판독(텍스트+칩) → arm(`expectedRefs`,`expectedMentions`,`normPrompt`) → 신뢰 클릭(`beforeDispatch` 가 칩도 본다).
- 동기·비동기(`asyncMode`) 둘 다: send(S3#9 이벤트) → loadend S3#9 → images, 로그 `refs verified request=2 echo=2`.
- **`@X … @X`**(같은 ref 두 번 멘션): 게이트의 멘션 순서열 2개·칩 집합 1개 → arm `expectedMentions:[U46,U46]`, `expectedRefs:[U46]` → send/loadend S3#19 → 성공(`refs verified request=1 echo=1`, 멘션 2/2). send `mentions:[U46]`(하나 빠짐) → mismatch.
- send `refs:[U9]` → `flow-references-mismatch`, `postClick:true`, **`sessionFetch` 미호출**; 되돌림만 어긋남 → 같음; 둘 다 `null` → 성공 + warn + `reportDomFailure('rpc-shape:ogiZ0b@refs')`.
- 레퍼런스 없는 요청 + 잔여 칩 → 정리 후 진행; 정리 실패 → attach-failed, 클릭 없음; send `refs:[U3]`(요청 안 함) → mismatch.
- mouseDown 직전 칩 +1 → 미디스패치 거부, gen 삭제, 클릭 전 실패(Q1).
- **`referencePreflight` 배선 핀**(M3-10 과 같은 둘): `plan` 범위 밖 → `bad-plan`, executeJavaScript 는 WIZ 뿐 · ref 2개 + 영영 안 끝나는 드라이버 → **359s 에 타임아웃 없음, 361s 에 `dom-stage-timeout`**(좀비는 클립보드·붙여넣기 없음). 헬퍼 자체는 `tests/electron/ipc/flowReferencePreflight.test.js`(새): `bad-plan`·`no-project-id` + 계산된 `timeoutMs` 를 **정확히** — ref 0개 120000 · 1개 240000 · 2개 360000 · 3개 480000(`120+60n`·refs 있으면 일률 360s 같은 식은 빨갛다).
- 숨은 뷰(0×0) → 제자리 확장+방패 안에서 붙여넣기·애셋 창(`bounds:` trace 가 붙여넣기보다 앞).
- 뮤테이션: `collectRpcGen` 레퍼런스 검증 삭제 → 빨강; `beforeDispatch` 칩 비교 삭제 → 빨강.

**M3-10 영상 핸들러(r2v)** — `tests/electron/ipc/flowVideoR2VAngular.test.js`(새), `tests/electron/ipc/flowVideoT2VAngular.test.js`(칩 게이트·대체 rpc 행), `tests/electron/ipc/flowAngularDispatch.test.js` / `flow-angular.js` `generateVideoT2V`·`finishVideoGen`, `electron/ipc/video.js:122-125`
- `@king` 1개 · Omni 4초 · 9:16: 인라인 멘션 컴포즈 → arm `rpc:'MZZa6b', altRpcs:['YhhmEf']`, `want.kind:'r2v'` → send/loadend S3#17 → `{success:true, generationId:U45, creditsLeft:857}`, 로그 `submitted media=00000045 creditsLeft=857 modelKey=abra_r2v_4s refs=1/1 mentions=1/1`.
- **`@X … @X`**: 게이트 순서열 2·칩 1 → send/loadend S3#20 → `{success:true, generationId:U57, creditsLeft:850}`, `refs=1/1 mentions=2/2`.
- 페이지가 `YhhmEf` 로 보냄 → `{success:false, errorKind:'flow-references-mismatch', rejectedMediaId, postClick:true}`, **`generationId`·`mediaId` 키 없음**. send `mentions:[]`(멘션이 빠짐) → mismatch.
- **클릭 뒤 레퍼런스 부정 케이스**(M3-9 와 대칭): S3#17 인데 send `refs:[U9]`(`boundRpc==='MZZa6b'`) → `flow-references-mismatch`·`postClick:true`·`rejectedMediaId:U45`, `generationId`·`mediaId` 키 없음, 폴·다운로드 미호출; send `refs:[U2]`(맞음)인데 응답 되돌림 `[3][0][5][6][1][1][0][2]` 를 U9 로 바꾼 사본 → 같은 결과.
- **중복 멘션 부정 케이스**: S3#20 인데 send `mentions:[U52]`(하나 빠짐) → mismatch — r2v 비교가 순서·중복을 보존한 동등 비교이지 집합·포함 비교가 아님을 증명.
- **`referencePreflight` 배선 핀**(B1 — 영상의 `withAutomationViewport` 는 `:576` 의 별도 호출 자리): `plan` 범위 밖 → `bad-plan`, WIZ 외 executeJavaScript 0회 · ref 2개 + 영영 안 끝나는 드라이버 → 359s 에 타임아웃 없음, 361s 에 `dom-stage-timeout`. 뮤테이션: 영상 호출 자리에서 `timeoutMs` 를 빼면 빨강(120s 에 끝난다).
- 모델키 `abra_t2v_4s` → `flow-video-settings-mismatch`; Veo Fast 16:9 에 `…_portrait` → 불일치.
- refs + `Veo 3.1 - Quality` → `flow-references-model-unsupported {model}`, WIZ 외 executeJavaScript 0회; ref 4개 → `flow-references-too-many {max:3}` 동일.
- 레퍼런스 없는 T2V(백스톱): arm `rpc:'YhhmEf', altRpcs:['MZZa6b']`; 페이지가 **S3#10**(칩만·멘션 없는 실제 제출 — 잔여 칩 사고와 같은 모양)을 보냄 → mismatch + `rejectedMediaId:U30`(§1-1 돈 구멍 — lost 대신 id 가 남는다). 1차 방어: 잔여 칩 → 정리 후 `YhhmEf`(실기 G7). 백스톱은 정리가 칩을 지우므로 실기로는 일으킬 수 없다 — 이 단위 테스트가 실제 S3#10 모양으로 덮는다.
- `MZZa6b` send 가 20s 에 옴 → 정상 바인딩(15s 훅은 크레딧 재판독만).
- `video.js` 가 `refs`·`plan` 을 넘긴다(진입 로그 `refs=<n>` — 구조분해 누락이면 빨강).
- 뮤테이션: `boundRpc` 비교 삭제 → 빨강; `altRpcs` 없이 arm → mismatch 케이스가 not-sent 로 빨강; 멘션 비교를 `Set` 으로 접음 → 중복 멘션 부정 케이스 빨강; 되돌림 검사 삭제 → 되돌림 케이스 빨강.

**M3-11 렌더러 계획·엔진** — `tests/utils/flowReferencePlan.test.js`(새), `tests/engine/engineFlow.test.jsx`(게이트 블록 교체), `tests/utils/videoPromptReferences.test.js` / `src/utils/flowReferencePlan.js`, `src/engine/engineFlow.js`, `src/utils/videoPromptReferences.js`
- 계획: `'@king이 웃는다'` + pool `[king]` → `[{t:'mention',ref:0},{t:'text',text:'이 웃는다'}]`; `'@{Alice Smith} runs'` 정확 매칭; `'@ghost'` + pool 비어 있지 않음 → `unresolved-mentions`+`unresolvedNames:['ghost']`, pool 비어 있음 → 텍스트; `'a@b.com'` → 텍스트; **`@king … @king` → 멘션 세그먼트 둘·`refs` 하나**; 멘션 ref 원천 없음 → `flow-reference-source-missing`; 태그 queen → `attach:[1]`, 멘션된 king 은 attach 에 없음; 영상 유일 ref 4개 → too-many(`FLOW_R2V_REFERENCE_LIMIT`), 같은 ref 멘션 4번은 1개로 통과.
- **`submitGeneration` 전용**(B1): 태그 ref 1개 → `flowGenerateImage` 페이로드 `{asyncMode:true, refs:[{base64,mime}], plan, referenceImages:[]}`, 결과 `{success, generationId}` 그대로; 두 ref 중 하나 못 읽음 → `flow-reference-source-missing`, **IPC 미호출**; `purpose:'reference'` + 스타일 ref → `flow-references-unsupported`; 업스케일 게이트 그대로; 캐릭터 ref 생성 분기(`:405-422`) 무변경.
- `generateImage` 같은 표(`asyncMode:false`). 영상 → `flowGenerateVideoT2V` 에 `refs`·`plan`(멘션 세그먼트), `segments` 없음.
- `videoPromptReferences` Flow 분기: `referenceImages` = 멘션된 원천 있는 ref, `segments:null`, `missing` = 미해결.
- 뮤테이션: `resolveReferenceImages(refs)` 한 번 호출 → "하나 못 읽음"이 IPC 로 가서 빨강; `submitGeneration` 만 옛 게이트 유지 → 빨강.

**M3-12 렌더러 훅·가드·동기화 퇴역** — `tests/utils/refImageGuard.test.js`, `tests/utils/mentionSyncTargets.test.js`, `tests/hooks/useAutomation.flowAngular.test.jsx`, `tests/hooks/useVideoAutomation.flowRejected.test.jsx` / `src/utils/refImageGuard.js`, `src/utils/mentionSyncTargets.js`, `src/hooks/useAutomation.js`, `src/hooks/useVideoAutomation.js`
- 가드: 태그만 걸린 캐릭터 ref(filePath, mediaId 없음) → 제외 **안 됨**(지금 제외); mediaId 만 있는 ref → 제외.
- 동기화 대상: 미동기화 캐릭터 멘션 → `[]`(지금 `[ref]`).
- `useAutomation` Flow: filePath 만 있는 ref → `submitGeneration` 의 `matchedRefs` 에 포함; 선행 `uploadReference` 미호출.
- 영상 훅: `flow-references-model-unsupported` 두 번 연속 → 종결(제출 2회); `flow-reference-attach-failed` `chip-mismatch` 두 번 → 종결 안 함; `paste-not-observed` 두 번 → 종결.

**M3-13 로케일·표시** — `tests/locales/flowSessionKeys.test.js`(`PARAMS` 에 `{model}`·`{max}`), `tests/utils/errorDisplay.test.js` / `src/locales/{ko,en}.js`
- 새 kind 6개 ko/en(D14 표 그대로), 코드 스캔 kind 전부 문구 있음; `resolveDisplayError(t,'flow-references-model-unsupported',err,{model:'Veo 3.1 - Quality'})` 렌더 텍스트에 **모델명이 있고** 리터럴 `{model}` 토큰은 남지 않는다(`too-many` 도 `{max:3}` → `3` 있음·`{max}` 없음); `flow-references-unsupported` 새 문구.

**M3-14 파이프라인 통합** — `tests/electron/flowRpcPipeline.test.js`(확장), `tests/hooks/useAutomation.flowAngularPipeline.test.jsx`(확장), `tests/hooks/useVideoAutomation.flowAngular.test.jsx`(확장)
- main: 실제 캡처 주입(vm+FakeXHR)이 S3#9 요청을 보내면 라우터가 `sentRefs`·`sentMentions` 로 바인딩 → loadend S3#9 → collect images; 기대를 `[U9]` 로 바꾸면 mismatch. S3#4 `maseQ` → 업로드 gen 완료(`gen.doc` = 주입 nonce).
- 렌더러: 태그 ref 씬 → 실제 `useFlowEngine`+`useAutomation`(→ `submitGeneration`)+`imageFinalize` → IPC 모킹이 images → 저장·done; 못 읽는 ref → 씬 error `flow-reference-source-missing`, 렌더 텍스트에 문구; 영상 3항목 #2 `flow-references-mismatch`(rejectedMediaId) → #1 다운로드 완료·#3 `flow-batch-halted {cause:'flow-references-mismatch'}`.

**M3-15 정책·배선·minify** — `tests/electron/noUserContentInLogs.test.js`, `tests/electron/mainInputShieldWiring.test.js`, `tests/electron/mainReferenceWiring.test.js`(새), `tests/electron/flow-injections-minified.test.js`, `tests/electron/preloadContract.test.js`(무변경 초록)
- `CONTENT_BEARING`(`noUserContentInLogs.test.js:32-46`)에 `base64|segments|plan|snapshot|rtf|mentionLabel|fileName|editorExpected|clip` 추가 후 초록(B2: `rtf`).
- "Angular 경로엔 키 `sendInputEvent` 없음" 핀(`mainInputShieldWiring.test.js:57-62`)의 파일 목록에 `electron/flow-reference-driver.js`·`electron/flow-composer-refs.js`·`electron/flow-clipboard.js` 추가; main.js 의 키 `sendInputEvent` 도 0개.
- main 배선(줄머리 앵커): `flowAPIDeps` 에 `clipboard`·`nativeImage`·`pasteIntoFlowView`(`() => getFlowView()?.webContents.paste()`).
- 붙여넣기 관찰 주입: 멱등, 리스너가 `defaultPrevented` 를 만들지 않음(뒤 리스너가 이벤트를 받는다), minified 평가 동일. 새 `*_JS` 전부 minified 번들에서 jsdom 결과 동일, 직렬화 헬퍼가 서로를 이름으로 부르지 않음.
- `callFlowRpc('maseQ')`·`('MZZa6b')` → `throws /rpcid not allowed/`.

**M3-16 실기 게이트** — §5.

---

## 5. 수용 게이트

**단위/통합**: `env -u ELECTRON_RUN_AS_NODE npx vitest run` 전체 초록(M3-14·M3-15 포함). 최종 판정은 오케스트레이터.

**실기**(앱은 K3 §4·H2 §3 절차, Flow 프로젝트 1개, 이미지 모델 Nano Banana 2, 업스케일 Off). 시작 전 사용자가 **AutoFlowCut 자신의 텍스트창**에서 `clipboard-sentinel` 을 복사해 둔다(Lexical 형식 포함 — 업로드를 막지 않아야 한다). 게이트마다 끝나고 `pbpaste` 가 그대로여야 한다.

- **G1 레퍼런스 이미지 1장(0크레딧, 세션 첫 사용)** — 캐릭터 태그 ref 1개(로컬 PNG), 멘션 없음.
  `[Flow API] [Angular] generate-image: {promptLen, model, aspectRatio, batchCount, asyncMode, refs:1, mentions:0}` → `ensureAgentOff: already OFF` → `[Flow Settings] image … ok=true` → `[Flow Refs] composer clear chips=0 editorLen=0` → `[Flow Refs] assets scan tab=upload idItems=<n> cached=0 found=0 missing=1 reopened=0` → `[Flow Upload] ref#0 bytes=<n> sha=<8> formats=<n> fileCopy=false` → `[Flow Upload] paste observed files=1 target=editor ms=<n>` → `[Flow Upload] clipboard restored` → `[Flow RPC] maseQ send doc=<8> seq=<n> bound=<8>` → `[Flow RPC] maseQ loadend seq=<n> status=200` → `[Flow Upload] ref#0 uploaded media=<8> chipIdAfter=<ms>` → `[Flow Refs] cache set media=<8>` → `[Flow Refs] composer clear chips=1→0` → `[Flow Refs] attach ref#0 media=<8> via=add-menu chip=ok` → `[Flow Refs] gate chips=1 mentions=0 text=ok summary=same ok=true` → `[Flow RPC] ogiZ0b send … bound=<8> refs=1 mentions=0` → `loadend … status=200` → `[Flow API] [Angular] refs verified request=1 echo=1` → `image …` → `download host=flow-content.google media=<8> bytes=<n>`. 씬 done, 크레딧 0 변화. **이 줄들이 프로덕션 캡처로 `maseQ` 를 본 증거다(A1).**
  **G1b**: 앱 모달로 Flow 뷰를 숨긴 채 — `view hidden … in-place shielded` 후 같은 결과.
- **G2 인라인 멘션 이미지(0크레딧, 같은 세션)** — `@king 이 정원에서 @queen 과 걷는다, @king 이 웃는다`. `[Flow Refs] mention ref#0 media=<8> ok` ×3(king 두 번) → `gate chips=2 mentions=3 … ok=true` → `ogiZ0b send … refs=2 mentions=3` → `refs verified`. 그림을 사용자 눈으로 확인.
- **G3 재사용(0크레딧, 앱 재시작 없이)** — G1 씬 재생성: `assets scan … cached=1 found=1 missing=0`, **`[Flow Upload]` 줄 0개**, NET_TRACE 의 `maseQ` 0건.
- **G3b 세션 경계(0크레딧)** — 앱 재시작 뒤 G1 씬: `cached=0 … missing=1` → 업로드 1회(결정 2 의 세션당 중복) → 같은 세션에서 한 번 더 → 업로드 0회.
- **G4 레퍼런스 영상(크레딧 — 매번 사용자 확인)** — Omni Flash · 4초 · 720p · 9:16, `@king` 인라인 1개(7크레딧). `generate-video-t2v: {…, refs:1, mentions:1}` → `credits before=<n>` → `[Flow Settings] video … ok=true` → 컴포즈 로그 → `[Flow RPC] MZZa6b send … refs=1 mentions=1` → `loadend status=200` → `submitted media=<8> creditsLeft=<n-7> modelKey=abra_r2v_4s refs=1/1 mentions=1/1` → 폴 → `complete` → `[Flow VideoDownload] … bytes=<n>`. mp4 720×1280.
- **G5 회귀(0크레딧)** — 레퍼런스 없는 이미지 씬인데 사용자가 미리 칩 하나를 손으로 붙여 둔다 → `composer clear chips=1→0` → `ogiZ0b send … refs=0` → 정상.
- **G6 클립보드 거부(0크레딧)** — Finder 에서 파일을 복사해 둔 채 새 ref 가 필요한 씬 → `flow-reference-clipboard-busy`, 붙여넣기 없음, 클립보드 그대로(Finder 에서 붙여넣기 가능).
- **G7 잔여 칩 영상(선택, 7크레딧 — 사용자 확인)** — 레퍼런스 없는 T2V 씬(Omni 4초)인데 사용자가 미리 칩 하나를 손으로 붙여 둔다 → `composer clear chips=1→0` → `[Flow RPC] YhhmEf send …` → 정상 성공(§1-1 돈 구멍의 1차 방어를 실기로 증명). 백스톱(`MZZa6b` 바인딩 → mismatch)은 정리가 칩을 지워 실기로 일으킬 수 없다 — M3-10 이 실제 S3#10 모양으로 덮는다.
- 전 게이트 공통: 로그에 프롬프트·파일명(`image.png` 포함)·경로·서명 URL·base64 0건; 실패 시 kind 는 D14 표 + `reason` 로그 한 줄.

---

## 6. 미지수 — 틀렸을 때 코드가 하는 일

| # | 미지수 | 틀렸을 때 |
|---|---|---|
| 1 | `@` 창이 키 잠금 켠 상태에서 문서 합성 Escape 로 닫히나(정리 경로만) | 안 닫히면 `picker-not-closed`(클릭 전) — 다음 항목도 같은 이유면 영상 배치는 2연속 종결, 사용자가 창을 닫는다 |
| 2 | 문단 첫머리·`(` 바로 뒤 단독 `insertText('@')` 가 창을 여나 | 안 열리면 `mention-trigger-not-working`(클릭 전, 문장은 고치지 않는다) |
| 3 | 이미지 레퍼런스 상한 | UI 거부 → 게이트 클릭 전, 서버 거부 → 실패 프레임(0크레딧) |
| 4 | 영상 다중 레퍼런스 요청 모양(1개만 관측) | `extractSubmitRefs` 가 목록을 돈다; 모양이 다르면 검증 불가 → 수용+warn(클릭 전 칩·멘션은 증명됨); 상한 3 |
| 5 | 업로드 탭 목록이 업로드 수백 개에서 가상화로 id 항목을 안 그리나 | 못 찾음 → 다시 열기 1회 → 재업로드(0크레딧 중복) |
| 6 | 영상 항목 썸네일 id 와 영상 mediaId 의 관계 | 영상은 레퍼런스로 안 쓴다 — 무관 |
| 7 | Veo Lite/Quality r2v 패널 | 클릭 전 `flow-references-model-unsupported` |
| 8 | `JJH6Ub`·`ogiZ0b [1][0][4]`(2/3) 의미 | 페이지가 만든다 — 앱은 읽지도 쓰지도 않는다 |
| 9 | mediaId 만 있고 로컬 이미지 없는 ref(옛 채택·옛 업로드) | 배치는 M1 제외 토스트로 빠지고, 단일 씬은 `flow-reference-source-missing` |
| 10 | 클립보드 쓰기~복원(수 ms) 사이 사용자의 다른 앱 붙여넣기 · 클립보드 관리자 기록 | 레퍼런스 이미지(사용자 자신의 것)가 그쪽으로 간다 — 잔여 위험, 문서화 |
| 11 | 앱 전용 클립보드 형식(Lexical 등) 손실 | 복원 뒤 앱 텍스트창에 붙이면 text/html 로 붙는다(결정 4 의 의도된 손실) |
| 12 | 업로드 중 문서 이동 | `failBoundUnfinished` 가 `maseQ` gen 을 lost 로 → `upload-lost`; 새 문서의 `doc` 이라 캐시는 저절로 miss |
| 13 | 세션 첫 사용 업로드 동안 제자리 뷰포트가 앱을 오래 덮음(업로드당 ~10s) | 기능 영향 없음; 재사용은 짧다. 사용자 눈 확인 항목 |

---

## 7. 범위 밖 — 전부 명시적 실패(fail-closed 유지)

| 것 | kind / 자리 |
|---|---|
| 캐릭터 엔티티(`C4BZMd`·`rzMKMb`)·Ref 탭 캐릭터 생성·엔티티 업로드·동기화 | `flow-feature-unsupported:generate-character`·`reroll-character`·`generate-scene`·`upload-character-entity`(`character.js:435,601,726,1236`) |
| i2v(시작 프레임) | `flow-feature-unsupported:generate-video-i2v`(`video.js:511`) |
| 업스케일(이미지·영상) | `flow-upscale-unsupported`(`engineFlow.js:183-185`) · `flow-feature-unsupported:upscale-image`(`flow-api.js:2156`)·`upscale-video`(`video.js:945`) |
| 레퍼런스 생성에 스타일 ref 이미지(`purpose:'reference'`) · 스타일 ref 선행 업로드(`useReferenceGeneration.js:152`) | `flow-references-unsupported` |
| 엔진 `uploadReference`(Ref 탭 '동기화') | `flow-references-unsupported`(`engineFlow.js:498`) · `flow-feature-unsupported:upload-reference`(`flow-api.js:1873`) |
| Veo 3.1 Lite/Quality·그 밖의 r2v 모델 | `flow-references-model-unsupported {model}` |
| 세션을 넘는 업로드 재사용·캐시 영속 | 없음 — 앞 세션 업로드는 썸네일이 불투명(P5), 세션마다 ref 당 1장 재업로드 |
| 파일 대화상자 업로드("미디어 업로드") | 쓰지 않음(파일 입력 없음 — CDP 없이는 불가) |
| webp·gif 변환 | `flow-reference-attach-failed` reason `image-decode-failed` |
| 영상의 태그 기반 레퍼런스(API 모드도 멘션만) | 붙이지 않음(동작 동일) |
| M2 브랜치에 돈 구멍 소급 | 없음(사용자 결정 5) |
| Flow 애셋 이름 변경·업로드 삭제 | — |
| 옛 코드 정리(`sceneMentions` 엔티티 경로·`flow-compose-mention`·`cdp-image-inject`·`flow-page-injection`·동기화 게이트 UI·P2 §11 #18 스킵 스위트) | 후속 |

---

## 8. 리뷰 처분

### 8.1 R0 리뷰 (A = Sonnet 5 설계 vs 증거 축 · B = Sonnet 5 테스트·배선·돈 축 — 저자와 다른 모델, 사본 분리)

| # | 리뷰 | 등급 | 요지 | 처분 | 반영 위치 |
|---|---|---|---|---|---|
| A1 | A | MAJOR | `maseQ`·`MZZa6b` 가 XHR 로 나간다는 것은 추론 — fetch 면 프로덕션 캡처가 못 본다 | **수정 수용** — 이미 관측(캡처 샘플 16건·프로브 업로드 6건 전부 `source=xhr` 훅); 프로브 추가 없음 | §1-4 ①, D5, G1 |
| B1 | B | BLOCKER | 배치·MCP 경로 `submitGeneration`(`engineFlow.js:400-451`)이 D1·D3·M3-11 에서 빠졌다 | **수용** | §1-1, D1, D3, D15, M3-11 전용 테스트, M3-14 |
| B2 | B | MINOR | 클립보드 스냅샷의 `rtf` 가 `CONTENT_BEARING` 에 없다 | **수용** | M3-15 |
| B3 | B | MINOR | r2v 상한을 API 모드 상수와 묶었다 | **수용** — `FLOW_R2V_REFERENCE_LIMIT = 3` | D13, D1, M3-11 |

### 8.2 R0 뒤 사용자 결정(2026-09-25)
1. **P9 실행(7크레딧)** — 영상 인라인 멘션 = 이미지와 같은 세그먼트 → 영상도 인라인(R0 의 칩 대체안 삭제).
2. **클립보드** — `text/uri-list` 일 때만 업로드 중단, 그 밖엔 text/html/rtf/image 복원·앱 전용 형식 버림(R0 의 되돌릴 수 있는 형식 화이트리스트를 대체. findings 문서의 "D4-c 그대로" 는 이 결정으로 바뀌었다).
3. **재사용은 같은 페이지 세션 안에서만** — 캐시는 문서 범위·메모리 전용, 없으면 다시 열기 1회 → 재업로드, 추가 뒤 칩 id 확정, 불투명 항목은 시도하지 않음.
4. **M2 돈 구멍은 M3 에서만** — M2 브랜치 소급 없음.

### 8.3 프로브가 바꾼 설계(R0 → R1)
D4(포커스 단계 삭제·관찰 즉시 복원·id img 대기) · D6(영속 JSON → 문서 범위 메모리) · D7(탭·가상 스크롤·미리보기 클래스·자동 닫힘·다시 열기·불투명 미시도·`@` 창 Escape 정리) · D8(신뢰 키·잠금 예외·`sendMentionTrigger` 삭제 → `insertText`, 텍스트 뒤 창 닫힘 확인) · D9(멘션 id 순서열 게이트·자동 공백 정규화·창 닫고 지우기·칩 hover 제거) · D3(중복 멘션 허용·영상 인라인) · §3 결과 표.

### 8.4 R1 리뷰 (A·B = Sonnet 5, 사본 분리 — 전부 수용)

| # | 리뷰 | 등급 | 요지 | 처분 | 반영 위치 |
|---|---|---|---|---|---|
| A1 | A | MAJOR | 같은 미디어 두 번 멘션(D3-4·D10·D12)의 요청 모양이 미관측 | **수용** — 추가 확인으로 관측(PR §4, S3#19·#20: 레퍼런스 1개·멘션 세그먼트 등장마다·되돌림 1개) | §1-4 ⑤⑨, D3-4, D12, §3, M3-1·M3-2 픽스처, M3-9·M3-10 `@X … @X` |
| B1 | B | MAJOR | M3-10 에 `bad-plan`·`no-project-id`·ref 수 비례 워치독 `timeoutMs` 가 M3-9 와 달리 없다(영상 `withAutomationViewport` 는 `:576` 별도 호출 자리) | **수용** — 이름 붙은 헬퍼 `referencePreflight` + 헬퍼 테스트 + 핸들러별 배선 핀 | D1, D4, M3-9, M3-10 |
| B2 | B | MAJOR | M3-13 의 "모델명·플레이스홀더 없음"이 D14 와 모순 | **수용** — 모델명 있음·`{model}` 토큰 없음 | M3-13 |
| B3 | B | MINOR | M3-8 게이트에 "같은 개수 다른 id" 케이스가 없어 개수 비교 구현이 통과 | **수용** — 칩·멘션 각각 같은 개수/길이·id 하나 다른 픽스처 | M3-8 |

### 8.5 R2 리뷰 (A·B = Sonnet 5, 사본 분리)

| # | 리뷰 | 등급 | 요지 | 처분 | 반영 위치 |
|---|---|---|---|---|---|
| A1 | A | MAJOR | §1-1 M2 돈 구멍이 [추정] — 실기 재현 없음 | **수정 수용** — 전제는 이미 관측(h1·h2b 는 칩만·멘션 없는 제출이고 `MZZa6b` 로 나갔다, S3#10·#15); 캡처가 `MZZa6b` 를 못 보는 부분은 코드 판독 사실. 선택 실기 G7 추가, 백스톱은 S3#10 단위 테스트로 | §1-1, M3-10, §5 G7 |
| B1 | B | MAJOR | M3-10 에 r2v 클릭 뒤 잘못된 레퍼런스(요청·되돌림) 부정 케이스가 없다 | **수용** — S3#17 기반 `sentRefs` 불일치·되돌림 불일치 → mismatch·rejectedMediaId·다운로드 없음 | M3-10 |
| B2 | B | MAJOR | M3-10 에 중복 멘션 부정 케이스가 없다 | **수용** — S3#20 + `mentions:[U52]` → mismatch, `Set` 접기 뮤테이션 | M3-10 |
| B3 | B | MINOR | 워치독 식이 n=0·n=2(121s/360s)로만 괄호쳐져 `120+60n`·일률 360s 가 통과 | **수용** — 헬퍼가 n=1/2/3 을 240/360/480s 로 정확히, 배선 핀은 359s/361s | M3-9, M3-10 |

### 8.6 R3 리뷰
| # | 리뷰 | 등급 | 처분 | 반영 위치 | 비고 |
|---|---|---|---|---|---|
