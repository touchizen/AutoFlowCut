# 계획 — M3 레퍼런스: 레퍼런스 이미지 · @인라인 멘션 · 레퍼런스 영상(r2v)을 flow.google.com 에서 (2026-09-25, R0)

레포: `~/workspace/AutoFlowCut-bugfix` (worktree, 브랜치 `feat/flow-m3-references` — M2 `fix/flow-batchexecute` 위, 캡처 증거 커밋 `432b2a89`)
상태: **PLAN R0. 코드 변경 0.** 저자 Opus 5.5(Fable 5.1 사용량 소진). 리뷰는 저자와 다른 모델 독립 2인. **구현 전에 §3 M3-0 프로브(0크레딧 · P9 만 7크레딧·사용자 확인)를 먼저 돌린다** — §2 에서 `[분기 Pn]` 이 붙은 결정은 기본값이고, 프로브 결과가 기본값과 다르면 그 D 를 고친 R1 을 먼저 리뷰한다.
증거: `docs/handoffs/evidence/2026-09-25-m3-references-capture.md`(**C**), `…-m3-samples.masked.jsonl`(**S3#n**, 행 번호 1–16: 1 JJH6Ub · 2 maseQ(파일 대화상자) · 3 ogiZ0b ref1 · 4 maseQ(붙여넣기) · 9 ogiZ0b ref2+멘션 · 10 MZZa6b Omni · 14 YhhmEf 대조군 · 15 MZZa6b Veo), `…-m3-dom-<단계>.elements.json`(**D3:<단계>**), M2 계획서 `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md`(**P2**, § 와 행 번호 #n), M2 핸드오프 `docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md`(**H2**), 킥오프 `docs/handoffs/2026-09-25-flow-M3-references-KICKOFF.md`(**K3**), HTrJv 모델 카탈로그 = 09-24 샘플 11행(**CAT**, 20000자에서 잘림).
**RAW** = 캡처 때 바탕화면에 남은 원본 DOM 덤프(`flow-dom-dump-20260925-150356…161734.json`, 저장소 밖 — 계정·서명 URL 이 섞여 있어 커밋하지 않는다). 이 계획서 작성 중 id·서명을 마스킹해서 읽은 사실만 인용한다(§1-4). M3-0 이 그 요약을 증거 문서로 남긴다.
표기: **[관측]** 캡처·덤프에 있는 사실 · **[추정]** 관측에서 끌어낸 추론 · **[미상]** 아무도 본 적 없음(→ 프로브).

---

## 0. 목표·범위

사용자 결정(2026-09-25, 바꾸지 않는다):
1. **@멘션 = Flow 인라인 멘션 재현** — 씬 프롬프트의 `@이름` 자리에 편집기 인라인 멘션 노드(편집기에서 `@` → 애셋 창 → 미디어 선택 → "프롬프트에 추가"). 캐릭터 엔티티(`C4BZMd`)는 쓰지 않는다.
2. **업로드 = Flow 프로젝트당 1회 + mediaId 재사용** — 처음 쓸 때 편집기에 클립보드 이미지를 붙여넣어 올리고 mediaId 를 기억한다. 다음부터는 애셋 창 항목 썸네일(`flow-content.google/image/<mediaId>`)로 찾아 붙이고, 못 찾으면 다시 올린다.
3. **범위 = 이미지(`ogiZ0b`) + 레퍼런스 영상(`MZZa6b`, r2v)**. i2v·업스케일·캐릭터 엔티티는 범위 밖(fail-closed 유지).

| 경로 | 지금(M2 끝) | M3 뒤 |
|---|---|---|
| 이미지 씬(배치 `useAutomation` · 단일 `useSceneGeneration` · MCP) — 캐릭터/장소/스타일 태그 ref | `flow-references-unsupported`(클릭 전) | 애셋 창 "＋" 로 칩 첨부 → `ogiZ0b [1][0][2]` |
| 이미지 씬 프롬프트의 `@이름` | 같음 | 인라인 멘션 → `ogiZ0b [1][0][8]` 멘션 세그먼트 + 칩 |
| 영상 T2V 프롬프트의 `@이름` | `flow-mention-chips-unsupported` | `MZZa6b`(r2v) — 인라인 멘션 또는 칩 `[분기 P9]` |
| 레퍼런스 **생성**(Ref 탭, `purpose:'reference'`) + 스타일 ref 이미지 | `flow-references-unsupported` | 그대로(범위 밖 §7) |

**불변(위반은 BLOCKER, P2 §3·H2 §2 그대로)**: 돈 규칙(`generationId` 있고 `videoPath` 없으면 상태 무관 재제출 금지 — r2v 도 같다, `MZZa6b` 200 = 과금) · 클릭 전 fail-closed · 제출은 신뢰 클릭만(`sendInputEvent`) · 요청 본문 변조 금지(레퍼런스·멘션도 UI 로 붙여 페이지가 요청을 만든다) · CDP 금지(`webContents.debugger`·`Page.*`·`Fetch.*`·파일 선택 가로채기 전부) · 앱은 `maseQ`·제출 RPC 를 만들지 않고 reCAPTCHA 를 부르지 않는다 · 로그·Sentry 에 내용 금지(프롬프트·파일 경로·파일명·URL·본문·토큰·base64·멘션 라벨) — 길이·id 앞 8자·상태어만.

---

## 1. 고고학 — 지금 어디서 막히고, 옛 경로 중 무엇이 살아 있나

### 1-1. 막는 자리 (M1-10 게이트와 그 주변)

| 자리 | 코드 | 지금 결과 | M3 |
|---|---|---|---|
| 엔진 입력 게이트 | `src/engine/engineFlow.js:182-189` `flowInputGate` — `matchedRefCount>0`(`:186`)·`referenceImages.length>0`(`:187`) | `flow-references-unsupported` | 업스케일 검사(`:183-185`)만 남기고 D1 의 새 게이트로 |
| 엔진 멘션 라우팅 뒤 | `engineFlow.js:374`(`planMentionRouting`) → `:381`/`:434`(scene 라우팅·폴백 ref 주입 거부) | 같음 | Flow 경로는 `planFlowReferenceComposition`(D3)으로 교체 |
| 멘션 해석(옛 엔티티 전제) | `src/utils/sceneMentions.js:22-24` — 후보 = `type==='character' && entityId && flowNameSyncStatus==='synced'` | 새 사이트엔 엔티티 동기화가 없어 사실상 전부 미해결 | 쓰지 않는다(D3) |
| 영상 엔진 | `engineFlow.js:515-517`(`segments` → `flow-mention-chips-unsupported`), `:520-526`(ref 이미지 → `flow-t2v-reference-images-unsupported`) | 클릭 전 거부 | D1 |
| 영상 프롬프트 빌더 | `src/utils/videoPromptReferences.js:60-70` — Flow 분기가 `parseSceneMentions` 로 `segments` 를 만든다 | 위 거부로 간다 | D15 |
| 이미지 핸들러 | `electron/ipc/flow-angular.js:364` — `referenceImages` 비어 있지 않으면 | `flow-references-unsupported` | 옛 필드는 계속 거부, 새 필드 `refs`/`plan`(D1) |
| 영상 핸들러 | `flow-angular.js:555` — `segments` | `flow-mention-chips-unsupported` | 같음(옛 필드), 새 필드 `refs`/`plan` |
| 영상 IPC 구조분해 | `electron/ipc/video.js:122-125` — 필드를 나열해 받는다 | 새 필드는 버려진다 | `refs, plan` 추가(M2-3 의 `resolution` 선례) |
| 배치 ref 필터 | `src/hooks/useAutomation.js:293-300` — Flow 는 `flowImageInjectable`(= 옛 `mediaId`, `refImageGuard.js:9-11`)로 거른다 | 파일만 있는 ref 가 엔진에 도달조차 못 한다(게이트는 `matchedRefCount` 로 거부) | `sourceAvailable`(`refImageGuard.js:5-7`, D15) |
| 배치 선행 업로드 | `useAutomation.js:624-629` — Flow 에서 비-캐릭터 ref 를 `uploadReference` 로 올린다 → 엔진 `:498` 이 즉시 거부 | 경고만 쌓이고 진행 | Flow 에선 선행 업로드 없음(D15) |
| 동기화 게이트(프리플라이트) | `src/utils/mentionSyncTargets.js:22-41`(`:27` 이 `parseSceneMentions`) → `emptyRefGate.js:188-193`·`App.jsx:1796-1799`·`mentionSyncRequest.js:39` | 미동기화 캐릭터 멘션이면 옛 엔티티 동기화 모달 — MCP 는 `nonInteractiveSyncGate`(`emptyRefGate.js:21`)가 배치를 취소 | 퇴역(D15) |
| M1 제외 가드 | `src/utils/refImageGuard.js:80-136` — 쓸 수 있음 = 옛 mediaId·엔티티·`flowSyncable`(`:108-116`); 태그만 걸린 **캐릭터** ref 는 mediaId 없으면 제외 | 로컬 이미지가 있어도 제외 | 쓸 수 있음 = 로컬 이미지(D15) |
| 모델키 검증 | `electron/flow-rpc-protocol.js:292` — `m[2] !== 't2v'` 면 false | r2v 키는 전부 불일치 | D11 |
| 제출 프롬프트 추출 | `flow-rpc-protocol.js:350-351` — `ogiZ0b`/`YhhmEf` 만 | `MZZa6b` 는 `[]` | D10 |
| 영상 응답 파서 | `flow-rpc-protocol.js:178` — `RPC = 'YhhmEf'` 고정(shape 경로 문구) | — | rpcid 인자 |
| 캡처 허용 목록 | `electron/flow-rpc-capture.js:24,30` — `{ogiZ0b, YhhmEf}` | **`MZZa6b`·`maseQ` 는 보이지 않는다** | D5·D10 |
| 라우터 | `electron/flow-rpc-router.js:138`(rpc 동일만 후보) · `:42`(유예는 `YhhmEf` 만) · `:50-54`·`:179-183`(미바인딩 보고는 `YhhmEf` 만) · `:219-243`(파서 분기 ogiZ0b/YhhmEf) | — | D5·D10 |

**지금 이미 있는 돈 구멍(M3 가 닫는다)** [추정 — 코드 경로로 판정, 실기 미재현]: 컴포저에 칩이 남아 있는 채로(사용자가 손으로 붙였거나 실패한 런의 잔여) M2 T2V 가 제출되면 페이지는 `YhhmEf` 대신 `MZZa6b` 를 보낸다(C §2: 레퍼런스가 있으면 `MZZa6b`). 캡처는 `MZZa6b` 를 모르므로(`flow-rpc-capture.js:30`) gen(`rpc:'YhhmEf'`)은 바인딩되지 않고 15s 훅의 크레딧 재판독(`flow-angular.js:700-708`)이 감소를 보고 `flow-submit-lost` 로 닫는다 — 과금된 영상은 id 도 없이 사라지고 미바인딩 보고(`flow-rpc-router.js:179-183`)도 `YhhmEf` 만 본다. 이미지(`ogiZ0b`)는 잔여 칩이 그대로 레퍼런스로 실려 엉뚱한 그림이 된다(0크레딧). → D9 의 "칩 없음" 게이트를 **레퍼런스 없는 M1·M2 경로에도** 건다.

### 1-2. 옛 레퍼런스 경로 — 재사용 / 사망

| 것 | 위치 | 판정 | 이유 |
|---|---|---|---|
| 옛 @멘션 주입(Slate·Radix 다이얼로그·캐릭터 탭·이름 매칭) | `electron/flow-compose-mention.js`, `electron/flow-mention-dom.js` | **사망**(셀렉터·구조) | 새 편집기는 ProseMirror, 애셋 창은 Material. 단 **교훈 둘은 산다**: "execCommand 로는 `@` 피커가 안 열린다(isTrusted 필요)" — `flow-compose-mention.js:104`, 그래서 `keyDown/char/keyUp '@'` 신뢰 키(`:105-109`) → D8 의 기본값. 로케일 문구 앵커 금지(`flow-mention-dom.js` 머리말, `tests/electron/noLocaleBoundDomAnchors.test.js:11-20`) |
| 캐릭터 엔티티 생성·등록(aisandbox REST) | `electron/flow-character-api.js`, `electron/ipc/character.js` | **사망 + 단락됨** | `character.js:435,601,726,1236` 가 `unsupportedOnAngular`. 새 사이트 엔티티(`C4BZMd`/`rzMKMb`)는 사용자 결정으로 안 쓴다 |
| 옛 레퍼런스 업로드(`UPLOAD_URL` REST) | `electron/main.js:171`, `electron/ipc/flow-api.js:1873` | **사망 + 단락됨** | 새 업로드는 `maseQ`(reCAPTCHA 토큰 `[0][10][0]`, S3#2·#4) — 앱이 부를 수 없다 |
| 요청 본문 주입(fetch 몽키패치·CDP Fetch) | `electron/flow-page-injection.js:109-201`(`injectImageBatchBody`), `electron/cdp-image-inject.js:22` | **사망 + 금지** | 본문 변조·CDP. 새 사이트는 XHR 이라 무효이기도 하다(P2 §1-2 #4) |
| `ref.mediaId`(옛 업로드·생성물 id) | `refImageGuard.js:9-11` 등 | **레퍼런스 정체성으로 안 쓴다**(D2) | 옛 사이트/다른 프로젝트 id 일 수 있고, 생성 이미지의 애셋 창 썸네일은 mediaId 가 없는 불투명 URL 이라(§1-4 ①) 존재를 검증할 수 없다 |
| 멘션 문법·해석 | `src/utils/mentionParser.js:24`(`MENTION_RE`), `:45-64`(`iterateMentions`), `:106-116`(`resolveMentionPrefix` — 한글 조사), `:205-214`(`stripMentionPrefixes`) | **재사용** | 타입 무관 해석(=`getMatchingReferences` `useScenes.js:672-681` 와 같은 규칙) |
| 레퍼런스 바이트 해석 | `src/utils/referenceResolver.js:57-103` | **재사용(엄격 모드로)** | 못 읽은 ref 는 경고 후 **건너뛴다**(`:90-93`) → M3 는 ref 하나씩 불러 빈 결과면 실패(D2) |
| 신뢰 클릭·뷰포트·방패·키 잠금·DOM 단계 직렬화·워치독 | `electron/ipc/shared.js:132-163`(측정 시 `scrollIntoView` `:190`, `beforeDispatch` `:308`), `flow-angular.js:226-304`, `main.js:366,372-392,407` | **재사용** | 애셋 창 항목·탭·추가 버튼도 같은 신뢰 클릭 |
| 캡처·라우터·프로토콜 | `flow-rpc-capture.js`, `flow-rpc-router.js`, `flow-rpc-protocol.js` | **확장** | D5·D10·D11·D12 |

### 1-3. 레퍼런스 데이터 모델 — 로컬 이미지를 어떻게 얻나

- ref 필드(렌더러 references 상태): `id, type(character|scene|style…), name, category, caption, data(메모리 base64/data URL), filePath, imagePath(프로젝트 상대), mediaId(옛), entityId/workflowId/flowNameSyncStatus(옛 엔티티 동기화)`. 이미지 원천 판정은 `sourceAvailable = data || filePath || imagePath`(`refImageGuard.js:5-7`).
- 씬에 걸린 ref = `getMatchingReferences(scene)`(`src/hooks/useScenes.js:636-686`): 캐릭터 태그 · 장소 태그 · 스타일 태그 · 프롬프트의 `@name`(타입 무관, `:672-681`). 스타일 ref 이미지는 `resolveSceneStyle` 이 `matchedRefs` 에 밀어 넣는다(`useSceneGeneration.js:102-104` 주석).
- 바이트: `resolveReferenceImages(refs, {projectName, strictMime})`(`referenceResolver.js:57`) — `data` → `filePath`(`fs.readFileByPath`) → 프로젝트 `references/{name}`(`fs.readReference`). Flow 엔진은 `getProjectName` 을 받는다(`useGenerationEngine.js:20` 이 `genApiOptions` 를 그대로 넘기고 `useGenAPI.js:70-83` 이 같은 옵션을 쓴다).
- 영상 ref 는 태그가 아니라 **멘션만**(API 모드 `videoPromptReferences.js:73-90` 와 같은 규칙).

### 1-4. 관측 요약(설계 입력) — C 에 없는 것은 RAW 에서 새로 읽었다

1. **애셋 창 썸네일** [관측 RAW 15:03:56·15:07:39·15:37:50]: 업로드한 이미지(king.jpg · 붙여넣은 image.png) 항목의 썸네일 `img` = `flow-content.google/image/<mediaId>` 이고 그 id 가 칩의 id 와 같다. **생성된 이미지 항목**의 썸네일은 대부분 `lh3.googleusercontent.com/asb/<불투명>`(mediaId 없음)이고, 같은 세션에 방금 만든 이미지 하나만 `flow-content` id 였다. 영상 항목은 `flow-content.google/image/<uuid>`(720×1280 — 그 id 와 영상 mediaId 의 관계 [미상]). 썸네일 `img` 가 `button.asset-item` 의 **자손**인지는 rect 포함으로만 봤다(x 231 ⊂ 227..459) [추정] — 덤프의 `bodyHtml` 이 40000자에서 잘려(`electron/flow-dom-dump.js:126`) 애셋 창 마크업이 없다.
2. **미리보기** [관측 RAW b1·g]: 항목을 고르면 오른쪽 상세의 `img`(alt "<이름> 미리보기" — 로케일 문구) src 가 같은 `flow-content.google/image/<mediaId>`. 컨테이너 클래스 [미상].
3. **`@` 입력** [관측 RAW 15:37:50 → 15:38:56]: 애셋 창이 열린 동안 편집기 텍스트는 `@` 그대로, "프롬프트에 추가" 뒤엔 `king.jpg` — `@` 가 **애셋 이름을 라벨로 단 멘션 노드**로 바뀐다. 붙여넣은 업로드의 이름은 전부 `image.png`(S3#4 `[8]`).
4. **멘션과 칩** [관측 D3:g → D3:g2-inline-mention-chip]: `@` 전 칩 = [#3 queen], 멘션 추가 뒤 칩 = [#2 king] **하나뿐**. 멘션 삽입이 기존 칩을 대체했는지, 사용자가 지웠는지 [미상](C 의 g2 설명은 사용자가 ＋로 queen 을 다시 붙였다). 그 뒤 ＋→queen 은 **추가**였다(D3:g2-two-chips-before-submit: [#2, #3]).
5. **칩 마크업** [관측 RAW bodyHtml]: `flow-ingredient-bar > div.ingredient-bar-container > flow-ingredient-chip > flow-image-ingredient-chip > button.chip-container[aria-busy] > div.chip-image-wrapper > img.chip-image` + `div.hover-icon-overlay > mat-icon(cancel)`. 프롬프트 상자 오른쪽 위 `div.top-right-actions > button.clear-button`(아이콘 `close`, "프롬프트 지우기") [관측 D3:g #25]. 칩·텍스트를 둘 다 지우는지 [미상].
6. **애셋 창** [관측 D3:a·D3:g]: 트리거 `button.add-menu-trigger`(열리면 `aria-expanded="true"`, 아이콘 `close`), 탭 `[role=tab]` 아이콘 리거처 `dashboard`(전체)·`image`·`videocam`·`voice_selection`·`accessibility_new`·`face`·**`drive_folder_upload`(업로드)**, 검색 `input.search-input`(`cdkfocusinitial` — 열리면 포커스를 가져간다), 항목 `button.asset-item[role=option]`(첫 항목이 `asset-item-active`), `button.detail-add-to-prompt-btn`. `@` 로 열어도 같은 창·같은 트리거 상태.
7. **멘션 노드 마크업** [미상] — 위 잘림 때문에 어떤 덤프에도 없다.
8. **CAT(r2v)** [관측 값]: 키 `abra_r2v_{4,6,8,10}s[_360p]`, `veo_3_1_r2v_fast_{portrait,landscape}[_ultra[_relaxed]]`, `veo_3_1_r2v_lite`(+`veo_2_*`·`veo_3_0_*`); **Veo Quality r2v 키는 잘린 범위 안에 없다**. 크레딧 abra r2v 4/6/8/10초 = 7/10/12/15, veo fast r2v 20, lite r2v 10. 모델 항목 `[9]` = abra r2v **7**, veo r2v **3**, t2v 는 `null` [추정: 레퍼런스 상한].
9. **업로드** [관측 S3#2·#4, C §1]: `maseQ` 요청 `[0][10][0]` reCAPTCHA · `[1]` base64 · `[2]` mime · `[8]` 파일명; 응답 `[0][0]` = 새 mediaId = `[1][3][4]`. 붙여넣기는 PNG(`image/png`, `image.png`, 2.6MB base64)로 가고 10.3s(send→loadend). 파일 입력(`input[type=file]`)은 모든 덤프에 0개.
10. **이미지 요청** [관측 S3#3·#9 · 09-24 S 1행]: `[1][0][2]` 레퍼런스 목록(`[id,null,null,null,1]`, 칩 순서), 없으면 `null`; `[1][0][8]` 세그먼트 — 멘션은 `[null,[[id,"<이름>"]]]`, 텍스트는 `["…"]`. 응답 `[0][0][6][0][15][3][0][i][2]` 가 레퍼런스를 되돌린다(`[null,1,id]`). 레퍼런스 있을 때 27·33s.
11. **영상 요청** [관측 S3#10·#15·#14]: `MZZa6b [0][0]` = `[[null,null,<프롬프트>], [[null,id]…], <모델키>, 1, null, […]]` — `YhhmEf` 와 비교해 `[1]` 에 레퍼런스가 끼어 모델키가 `[2]` 로 밀렸다. 응답 모양은 `YhhmEf` 와 같고 `[3][0][5][6][1][1][i][2]` 가 레퍼런스를 되돌린다(`[null,4,id]`). 레퍼런스 2개 이상 영상·영상 인라인 멘션 [미상].

---

## 2. 설계 결정

### D1. 디스패치와 게이트 — 무엇이 어디서 거부되나
- **엔진**(`engineFlow.js`): `flowInputGate`(`:182-189`) 는 업스케일 검사만 남긴다. `callOpts.purpose === 'reference'` 이면서 ref 이미지가 있으면 `flow-references-unsupported`(범위 밖, §7). 씬 생성은 D3 계획 → D2 바이트 해석 → IPC 페이로드 `{prompt, refs:[{base64, mime}], plan:{segments, attach}, referenceImages:[]}`. Flow 경로에서 호출자가 0 이 되는 `planMentionRouting`·`planUnresolvedMentionFallback`·`computeSceneGapReferences`(`:56-146`)는 grep 으로 확인한 뒤 테스트와 함께 지운다(내 변경이 만든 dead code 만).
- **main**: `generateImage`/`generateVideoT2V` 가 `refs`·`plan` 을 받는다. 옛 필드(`referenceImages` 비어 있지 않음 `flow-angular.js:364`, `segments` `:555`)는 그대로 거부(엔진은 더 이상 보내지 않는다 — 이중 방어). `plan` 모양 검사(세그먼트 타입·인덱스 범위·문자열·개수 ≤ 64)는 **DOM 조작 전** — 틀리면 `flow-reference-attach-failed` reason `bad-plan`. `video.js:122-125` 구조분해에 `refs, plan` 추가.
- 영상 + refs: 모델이 r2v 지원 표(D11) 밖이면 `flow-references-model-unsupported {model}`, ref 가 3개 초과면 `flow-references-too-many {max:3}` — 둘 다 **DOM 조작 전**(세션 게이트 뒤).

### D2. 레퍼런스의 정체성 = 로컬 이미지 바이트(sha256)
- Flow M3 는 `ref.mediaId`·`entityId` 를 레퍼런스로 쓰지 않는다(§1-2). 레퍼런스는 **로컬 이미지 바이트**이고 그 sha256 이 캐시 키의 절반이다(D6).
- 렌더러(엔진)가 **ref 하나씩** `resolveReferenceImages([ref], {projectName, strictMime:true})` — 결과가 비면 `flow-reference-source-missing`(IPC 없음). 여러 ref 를 한 번에 부르면 못 읽은 것이 조용히 빠진다(`referenceResolver.js:90-93`).
- IPC 로는 **경로가 아니라 base64** 를 보낸다 — main 이 렌더러가 준 경로를 읽는 표면을 만들지 않는다. main 이 `sha256(Buffer.from(base64,'base64'))` 를 계산한다.
- 이미지 형식 판정은 main 의 `nativeImage.createFromBuffer(buf).isEmpty()` 하나 — 비면 `flow-reference-attach-failed` reason `image-decode-failed`(webp·gif 등; 변환은 범위 밖).

### D3. 멘션·첨부 계획 — 렌더러 순수 함수 `planFlowReferenceComposition` (`src/utils/flowReferencePlan.js`, 새 파일)
입력: `prompt`(스타일 적용 뒤 문자열) · `attached`(훅이 넘긴 매칭 ref: 태그·스타일·멘션 합집합) · `pool`(`callOpts.references`, 프로젝트 전체 ref) · `mode`('image'|'video') · `videoMentions`('inline'|'chips', `[분기 P9]`).
1. 토큰은 `iterateMentions`(`mentionParser.js:45-64`), 해석은 braced 는 정확 일치, plain 은 `resolveMentionPrefix`(`:106-116`) — `pool` 의 이름 있는 ref 전체(타입 무관, `getMatchingReferences` 와 같은 규칙). 맞은 접두만 멘션이고 남은 글자(한글 조사 `이`)는 텍스트.
2. 해석 안 된 토큰: `pool` 에 이름 있는 ref 가 하나라도 있으면 기존 kind `unresolved-mentions` + `unresolvedNames`(옛 규칙 `sceneMentions.js:71-74` 의 "캐릭터가 있으면 `@` 는 멘션 sigil" 을 타입 무관으로 넓힌 것); 없으면 텍스트.
3. 해석된 ref 에 이미지 원천이 없으면(`sourceAvailable` false) `flow-reference-source-missing`.
4. 같은 ref 를 두 번 멘션하면 **첫 등장만 멘션**, 뒤는 이름 평문(`@` 없이) — 반복 멘션의 칩 동작이 [미상](P3)이라 한 번만 넣는다.
5. `attach` = `attached` 중 이미지 원천이 있고 멘션되지 않은 것(정체성: `id`, 없으면 소문자 이름), 중복 제거. 원천 없는 첨부 ref → `flow-reference-source-missing`(배치는 D15 의 M1 제외 가드가 이미 뺐으므로 여기 오는 건 단일 씬 경로).
6. `refs` 순서 = 멘션 첫 등장 순 → 첨부 순. 세그먼트는 인덱스로 가리킨다: `[{t:'text', text} | {t:'mention', ref:i}]`.
7. 영상: `refs.length > 3` → `flow-references-too-many {max:3}`. `videoMentions === 'chips'` 이면 멘션을 첨부로 옮기고 텍스트는 `stripMentionPrefixes` 의미(이름 평문) — 관측된 모양(S3#10·#15 는 칩만)이다. `[분기 P9]`: P9 로 영상 인라인 멘션 요청 모양을 보면 `'inline'`(이미지와 같은 절차). **사용자 결정 1 과의 차이**: P9 를 돌리지 않으면 영상만 칩 방식이 된다 — 리뷰·사용자 확인 대상.
8. 스타일 텍스트(`resolveSceneStyle`)는 평문 세그먼트다.

### D4. 업로드 드라이버 — 클립보드 이미지 + `flowView.webContents.paste()`
**왜 이 길뿐인가**: `maseQ` 는 reCAPTCHA 토큰을 싣는다(S3#2·#4 `[0][10][0]`) → 앱이 부를 수 없다. "미디어 업로드" 버튼은 OS 파일 대화상자를 여는데 문서에 파일 입력이 없다(D3 전부 0개) → 대화상자를 조종하려면 CDP(`DOM.setFileInputFiles`)나 OS 자동화가 필요하다(금지·범위 밖). 편집기 붙여넣기는 관측된 신뢰 경로다(C §1 d: 앱 메뉴 `role:'paste'` = `electron/updater.js:274` → 포커스된 webContents 의 붙여넣기 명령).

절차(DOM 단계 안, 캐럿 신뢰 클릭 뒤 — Flow 뷰가 포커스를 가진 상태, 키 잠금·방패 그대로):
1. **사전 판독** 한 번(`READ_COMPOSER_STATE_JS`, D9): `document.activeElement` 가 `div.ProseMirror[contenteditable=true]` 안 · 애셋 창 닫힘 · 바쁜 칩 없음 · 현재 칩 목록 L0. 아니면 각각 reason `focus-not-editor`·`picker-open`·`chip-busy` — **클립보드에 손대기 전**.
2. **클립보드 스냅샷**(D4-c). 되돌릴 수 없는 형식이면 `flow-reference-clipboard-busy`(쓰기·붙여넣기 없음).
3. `nativeImage.createFromBuffer(bytes)` — 비면 `image-decode-failed`.
4. **업로드 gen arm**: `{rpc:'maseQ', normPrompt:'', setAt, doc:null, …}` 를 `pendingGenerations` 에(붙여넣기 전 — send 가 빨리 올 수 있다).
5. 붙여넣기 관찰 주입(`FLOW_PASTE_OBSERVER_INJECTION`, 새 — 문서 capture 단계 `paste` 리스너가 카운터·`e.target` 이 편집기 안인지·`clipboardData.files.length` 만 적는다. `preventDefault`/`stopPropagation` 없음, 멱등) → 카운터 n0 판독.
6. `clipboard.writeImage(img)` → 서명 `sig = sha256(clipboard.readImage().toPNG())`.
7. `flowView.webContents.paste()`.
8. 붙여넣기 관찰(카운터 > n0)을 ≤3s 폴 — **exec 호출마다 1s 타임아웃 race**(문서가 죽으면 exec 가 영영 settle 하지 않는다, H2 §5).
9. `finally`: **클립보드 복원**(D4-c) — 붙여넣기 뒤 ≤5s 안에 반드시, 페이지 exec 의 settle 과 무관하게.
10. 관찰 실패 → gen 을 `settleGen`·삭제, reason `paste-not-observed`; 관찰됐으나 대상이 편집기 밖 → `paste-wrong-target`.
11. send 마감(15s)은 붙여넣기 뒤 arm, loadend 100s(라우터 기본값 그대로 — 새 상수 없음).
12. gen 오류 → reason `upload-not-sent`·`upload-lost`·`upload-rpc-error`·`upload-shape`.
13. **칩 검증**(≤10s 폴): 칩 = L0 + 정확히 하나의 새 칩, `aria-busy="false"`, 그 id == `maseQ` 응답 id. 아니면 `chip-mismatch`.
14. 캐시 기록(D6) — **13 을 통과한 뒤에만**.

규칙: 업로드는 한 번에 하나(DOM 단계 자체가 `lastDomStage` 로 전역 직렬화 `flow-angular.js:92,228-238`). 워치독 예산은 `DOM_STAGE_TIMEOUT_MS`(`:83`, 120s) + 120s × (유일 ref 수) — `withAutomationViewport` 에 `timeoutMs` 인자. `isAborted()` 는 2·6·7 앞과 애셋 창 클릭마다 본다(좀비는 클립보드·붙여넣기를 하지 않는다). 업로드 실패는 전부 **클릭 전**(0크레딧) — `postClick` 없음.

**D4-c 클립보드 정책**
- 스냅샷: `clipboard.availableFormats()` 가 전부 `RESTORABLE_FORMATS`(기본값 `text/plain`·`text/html`·`text/rtf`·`image/png`·`image/jpeg`·`image/tiff`, `[분기 P1d]` 실측으로 확정) 안이면 되돌릴 수 있음 — `readText/readHTML/readRTF/readImage().toPNG()` 중 있는 것만 보관. 밖의 형식(Finder 파일 복사 `text/uri-list` 등)이 있으면 **올리지 않는다**(`flow-reference-clipboard-busy`, 사용자가 텍스트를 한 번 복사하면 풀린다). 이유: 사용자 데이터를 조용히 잃는 것보다 한 항목을 멈추는 편이 낫다.
- 복원: 지금 클립보드의 형식·이미지 서명이 6 에서 쓴 것과 같을 때만 `clear()` 뒤 `write({text?, html?, rtf?, image?})`(빈 스냅샷이면 `clear()`). 다르면 **사용자가 그 사이 복사한 것** — 건드리지 않는다(로그 `clipboard changed during upload — not restored`). 복원이 throw 하면 로그만(`clipboard restore failed`) — 업로드·항목은 계속(복원 실패로 과금이 생기지 않는다).
- 노출 창 = 쓰기 → 복원 ≈ 붙여넣기 관찰 지연(P1 이 잰다, 1s 미만 기대). 그 사이 사용자가 다른 앱에서 붙여넣으면 레퍼런스 이미지가 나간다 — 잔여 위험(§6 #17). 클립보드 관리자 앱이 이미지를 기록하는 것도 잔여 위험.
- 로그: 개수·불리언만(`formats=<n> restorable=<bool> restored|skipped|failed`).

### D5. 업로드 응답 캡처·바인딩
- 캡처 허용 목록에 `maseQ`. send 이벤트는 `{kind:'batchexecute-send', doc, rpcid:'maseQ', rpcids, seq, prompts:[], sentAt}` — **본문을 디코드하지 않는다**(수 MB base64·파일명이 이벤트에 들어갈 길이 없다). loadend 는 기존대로 `responseText`(~600B, 페이지가 붙인 이름 `image.png` 포함 — main 이 파싱만 하고 버린다).
- 프로토콜 `parseUploadResponse(payload)` → `{mediaId}`: `[0][0]` 은 `isFlowMediaId`(UUID, `src/utils/flowMediaId.js`), `[1][3][4]` 가 있으면 같아야 한다. 아니면 `FlowRpcShapeError('maseQ … @[0][0]')`. 결과에 파일명 없음.
- 라우터: `maseQ` gen 은 다른 rpc 와 같은 규칙으로 바인딩(업로드가 직렬이라 후보 1개), loadend → `settleGen({mediaId})`, 실패 프레임 → 매핑된 오류. **미바인딩 `maseQ`(사용자의 손 업로드)는 조용히 버린다**(보고 없음, 과금 무관).
- `callFlowRpc` 허용 목록(`electron/flow-rpc-client.js:21` `{nzlxg, jwpduf, as29s}`)은 그대로 — `maseQ`·`MZZa6b` 를 앱이 만들 수 없음을 테스트로 핀.

### D6. mediaId 캐시 — 키·저장·무효화·검증
- **키** `${projectId}:${sha256hex}`. `projectId` = 새 `projectIdFromFlowUrl(flowView.webContents.getURL())`(`electron/flowUrl.js`, `flow.google.com/project/<id>` 의 컴포저 경로만 — `onProjectComposerUrl` `:96` 과 같은 경계) — `ensureOnProjectComposer` 뒤에 읽는다(페이로드 projectId 는 null 일 수 있다, `shared.js:1237`). null → `flow-reference-attach-failed` reason `no-project-id`(DOM 단계 전).
- **저장** main 전용 JSON `app.getPath('userData')/flow-ref-media-cache.json` `{v:1, entries:{<key>:{m:<mediaId>, at:<epochS>}}}` — 임시 파일 + rename 으로 원자적 쓰기, 게으른 로드, 깨진 파일 → 빈 캐시 + warn(throw 없음), 상한 2000(가장 오래된 `at` 부터 버림), 검증된 사용마다 `at` 갱신. 내용 없음(프로젝트 id·해시·미디어 id).
- **왜 main 인가**: 업로드가 main 에서 일어나고, 경로(UI·MCP·배치·단일)와 무관하며, ref 카드는 복제·이름 변경이 되지만 바이트 해시는 정체성 그 자체다. 같은 Flow 프로젝트에 묶인 다른 앱 프로젝트도 공유한다.
- **검증**: 캐시는 **힌트**다. 항목마다 애셋 창 스캔(D7)에서 그 id 의 항목을 찾으면 쓰고, 못 찾으면 항목을 지우고 다시 올린다(사용자 결정 2).
- **무효화**: Flow 프로젝트 변경(키) · 이미지 파일 변경(키) · Flow 에서 삭제되었거나 목록에 안 그려짐(스캔 실패 → 재업로드, 0크레딧 중복 애셋) · 상한 축출. 수동 초기화 UI 없음(범위 밖).

### D7. 애셋 창에서 mediaId 로 고르기
- **열기**: `button.add-menu-trigger`(컴포저 안 정확히 하나) 신뢰 클릭 → ≤3s: `aria-expanded="true"` ∧ `button.asset-item[role=option]` ≥ 1. 안 열렸고 트리거도 닫힘이면 **한 번 더**(P2 §12 #117 N5 의 "헛클릭 뒤 1회 재시도"와 같은 조건 — 열림 흔적이 전혀 없을 때만) → 그래도면 `picker-not-open`.
- **탭**: 아이콘 리거처 `drive_folder_upload` 의 `[role=tab]`(이미 `aria-selected=true` 면 생략) 신뢰 클릭 → 목록 교체 대기. 탭이 없으면 현재 탭(`tab=all` 로그) — 우리 업로드는 전체 탭에서도 id 썸네일이다(§1-4 ①). `[분기 P5]`.
- **검색 오염 검사**: 애셋 창의 `input.search-input` 값이 `''` 가 아니면 `picker-search-dirty` — 검색창이 포커스를 가져가므로(`cdkfocusinitial`) 한글 IME 가 키 잠금을 우회해 거기 글자를 넣으면 목록이 걸러져 **가짜 "못 찾음 → 재업로드"** 가 된다.
- **항목 찾기**: `button.asset-item` 중 자손 `img` 의 src 가 `^https://flow-content\.google/image/<mediaId>(\?|$)` 인 것이 **정확히 하나** → 신뢰 클릭(측정이 `scrollIntoView` 한다 `shared.js:190`). 불투명 썸네일(`lh3…/asb/…`)은 절대 매칭되지 않는다 — 고를 수 있는 건 우리 업로드뿐.
- **미리보기 확인**: 상세 창 `img`(셀렉터 `[분기 P5]`)의 src id == 원하는 id — 아니면 `preview-mismatch`(추가 클릭 없음).
- **추가**: `button.detail-add-to-prompt-btn`(정확히 하나) 신뢰 클릭 → ≤3s: 애셋 창 닫힘 + 칩/멘션 변화.
- **추가 없이 닫기**(스캔만·실패): 트리거 신뢰 클릭(열린 동안 아이콘 `close`) — **Escape 는 쓰지 않는다**(H2 §5: Escape 로 닫은 패널은 다음 트리거 클릭이 헛돈다) → 닫힘 확인, 아니면 `picker-not-closed`.

### D8. 인라인 멘션 삽입 절차
1. 캐럿을 끝으로(`PLACE_CARET_AT_END_JS`: `editor.focus()` + 마지막 문단 끝에 접힌 선택) → `document.activeElement` 가 편집기 안인지 확인.
2. **`@` 트리거** `[분기 P4]`. 기본값 = **신뢰 키**: main 의 새 `sendMentionTrigger()` 가 Flow 뷰에 `keyDown/char/keyUp '@'` 를 보낸다(옛 사이트 선례 `flow-compose-mention.js:104-109`). DOM 단계의 키 잠금(`main.js:407` `before-input-event` → `preventDefault`)이 이것도 막을 수 있으므로 `sendMentionTrigger` 가 **1회용 허용**(키 `@` 만, ≤800ms, 이벤트 ≤2개)을 세우고 보낸다 — 사용자의 물리 키는 그대로 막힌다(그 800ms 안의 사용자 `@` 한 번은 통과할 수 있다 → 5 의 검증이 잡는다). 키 `sendInputEvent` 는 **main.js 의 이 한 자리에만** 둔다 — Angular 경로(flow-angular·composer-settings·shared) 에 키 이벤트가 없다는 기존 핀(`tests/electron/mainInputShieldWiring.test.js:57-62`)은 그대로 초록. P4 가 `execCommand('insertText','@')` 로도 열린다고 보이면 그것을 쓰고(키 이벤트·허용 없음) **텍스트 세그먼트에 `@` 가 있으면 클릭 전 거부**(reason `at-sign-in-text` — 그 경우엔 평문 `@` 도 피커를 연다).
3. ≤3s: 편집기 텍스트가 `@` 로 끝남 ∧ 애셋 창 열림 — 아니면 `mention-trigger-not-working`(편집기에 남은 `@` 는 9 의 게이트가 거부한다).
4. D7 의 탭 → 검색 검사 → 항목 → 미리보기 → 추가.
5. 검증: 끝의 `@` 가 사라짐 ∧ 멘션 노드 수 +1(노드 판별 `[분기 P3]`) — 노드의 라벨 텍스트는 D9 의 `editorExpected` 에만 쓰고 로그에 내지 않는다.
6. 텍스트 세그먼트는 `APPEND_EDITOR_TEXT_JS(text)` = 캐럿 끝 + `execCommand('insertText')`(M2 의 `SET_EDITOR_TEXT_JS` `flow-angular.js:49-72` 에서 전체 선택·삭제만 뺀 것) → 편집기 텍스트가 그만큼 늘었는지 확인.
- **편집기 명령(ProseMirror API)을 쓰지 않는 이유**: Flow 의 PM 뷰 인스턴스를 페이지 JS 에서 잡으려면 내부 구조를 뒤져야 하고(깨지기 쉽고 사실상 변조), 신뢰 UI 경로는 사용자가 한 그대로다(C g·g2).

### D9. 컴포저 정리와 클릭 전 게이트
- **정리**: 컴포저 단계 시작(레퍼런스 없는 M1·M2 경로 포함)과 업로드 뒤에, 칩이나 텍스트가 있으면 `button.clear-button` 신뢰 클릭 `[분기 P2]` → ≤2s 칩 0 ∧ 편집기 비어 있음. 안 되면 P2 가 정한 칩 개별 제거, 그래도면 `composer-not-clear`. 레퍼런스 없는 경로는 기존 `SET_EDITOR_TEXT_JS` 가 텍스트를 지우므로 **칩만** 보면 된다.
- **순서**: 정리 → (업로드 필요분 D4 → 정리) → 세그먼트 순서대로 텍스트/멘션 → **빠진 칩 채우기**(멘션∪첨부 id 중 칩 목록에 없는 것마다 D7 "＋" 추가 — 멘션이 칩을 더하든 대체하든(§1-4 ④, P3) 결과가 같아진다) → 게이트.
- **게이트**(한 번의 `READ_COMPOSER_STATE_JS`, 전부 클릭 전 = 0크레딧): (1) 애셋 창 닫힘 (2) 바쁜 칩 없음 (3) 칩 id 에 null·중복 없음, **집합 == 기대 집합**(멘션 ∪ 첨부) (4) 멘션 노드 수 == 기대 멘션 수, P3 에서 노드가 id 를 드러내면 **id 순서열 ==** 기대 (5) 텍스트 부분의 정규화 == `normalizePrompt(plan 텍스트)` (6) 닫힌 설정 요약(`READ_SETTINGS_SUMMARY_JS` `flow-composer-dom.js:72`) == 설정 단계 직후 판독값(칩이 모델·모드를 바꿨다면 여기서 잡는다, P7). 실패 사유는 `flow-reference-attach-failed` 의 `reason`.
- **이후 가드**: 게이트 통과 때의 `normalizePrompt(readEditorText)` 를 `editorExpected` 로 적고, `editorChangedBeforeClick`(`flow-angular.js:176-184`)·`makeDispatchGuard`(`:155-163`)는 프롬프트가 아니라 `editorExpected` **와 칩 집합**을 비교한다(멘션 라벨이 편집기 텍스트에 섞이므로). 재판독~mouseDown 사이의 IME·사용자·페이지 변화는 기존 Q1 경로(`:457`)로 클릭 전 실패.
- **gen 필드**: `normPrompt = normalizePrompt(plan 텍스트 세그먼트 배열)` — 캡처의 `extractSubmitPrompts` 가 멘션 세그먼트를 건너뛰고 텍스트만 `' '` 로 잇는 것과 같은 값(`flow-rpc-protocol.js:356-365`). `expectedRefs`(집합) · `expectedMentions`(순서열).

### D10. 제출 RPC 라우팅 — `MZZa6b`
- 이미지: 항상 `ogiZ0b`.
- 영상: refs 있음 → `gen.rpc='MZZa6b', altRpcs:['YhhmEf']`; 없음 → `gen.rpc='YhhmEf', altRpcs:['MZZa6b']`. 라우터는 `rpc ∪ altRpcs` 로 후보를 잡고(`flow-rpc-router.js:138` 확장) `gen.boundRpc` 를 적는다. 파싱은 `boundRpc` 로. 핸들러: `boundRpc ≠ gen.rpc` 면 **클릭 뒤** `flow-references-mismatch`(+`rejectedMediaId`, `postClick`) — 과금은 됐고(돈 규칙) 새 제출만 멈춘다.
- 유예(`SEND_GRACE_RPCS` `:42`)·미바인딩 보고(`unboundVideoMediaId` `:179-183`, `noteUnboundClose` `:50-54`)를 `MZZa6b` 로 넓힌다.
- 캡처 send 이벤트에 `refs`·`mentions`(id 만)를 싣는다: `ogiZ0b` 는 `inner[1][i][2][j][0]`·`inner[1][i][8][0][k][1][0][0]`(멘션 세그먼트 `seg[0]===null`), `MZZa6b` 는 `inner[0][i][1][j][1]`(멘션은 `[분기 P9]`). UUID 가 아니거나 모양이 다르면 `null`(= 검증 불가, D12). 이미지 x2~x4 요청처럼 항목이 여럿이면 항목마다 목록이 같아야 하고, 다르면 `null`. `extractSubmitPrompts` 에 `MZZa6b`(경로는 `YhhmEf` 와 같은 `inner[0][i][0][2][0]`).

### D11. 모델키 검증 확장
- `modelKeyMatches(key, want)` 에 `want.kind`('t2v' 기본 | 'r2v') — 키의 둘째 토큰이 `kind` 와 같아야 한다. 기존 t2v 진리표(P2 M2-1)는 무변경.
- r2v 표(CAT): `abra_r2v_{4,6,8,10}s[_360p]` ↔ Omni Flash(길이·해상도 규칙은 t2v 와 같다) · `veo_3_1_r2v_fast_{portrait|landscape}[_ultra|_relaxed…]` ↔ Veo 3.1 Fast, 8초, **방향 토큰 필수** — 9:16 ↔ `_portrait`, 16:9 ↔ `_landscape`(t2v 는 가로가 무토큰인 것과 다르다, CAT). `veo_3_1_r2v_lite` 는 false(패널 미관측), Veo Quality r2v 는 CAT 에 없음 → false.
- **클릭 전 지원 표** `R2V_MODELS` = {Omni Flash, Veo 3.1 Fast}(실기 관측 S3#10·#15) — 밖이면 D1 의 `flow-references-model-unsupported`. 모델키 문법(`flow-rpc-protocol.js:174`)은 그대로(`abra_`/`veo_` 접두가 r2v 도 덮는다).
- `parseVideoSubmitResponse(payload, rpcid)` — shape 경로 문구가 rpcid 를 쓴다(`:178` 의 고정 제거). `describeWant` 에 `kind`.

### D12. 클릭 뒤 레퍼런스 검증
- 근거 둘: **요청**(캡처 send 의 `refs`·`mentions`) · **응답 되돌림**(이미지 `[0][i][6][0][15][3][0][j][2]`, 영상 `[3][0][5][6][1][1][j][2]`).
- 규칙: 있는 근거는 전부 기대와 같아야 한다(레퍼런스 = 집합·개수, 멘션 = 순서열). **하나라도 어긋나면 거부**. 근거가 하나도 없으면(모양 드리프트) **수용 + warn + `reportDomFailure('rpc-shape:<rpc>@refs')`** — 클릭 뒤라 돈은 이미 나갔고, 클릭 전 게이트(D9)가 칩을 증명했다.
- 이미지 거부: `{success:false, errorKind:'flow-references-mismatch', error:…, postClick:true}`, **다운로드 없음**(0크레딧 — 그림을 버린다).
- 영상 거부: `+ rejectedMediaId` · `postClick:true` · `errorParams:{}`, `mediaId`/`generationId` 키 없음(P2 D8-6) → 훅의 `submitHalt` 가 새 제출만 멈춘다.
- 로그(개수만): `refs verified request=<n> echo=<n>` / `refs mismatch request=<got>/<want> echo=<got>/<want>`.

### D13. 레퍼런스 개수 상한
- 영상 ≤ 3: CAT `[9]` 이 veo r2v 3 · abra r2v 7 이고 앱 상수 `VIDEO_REFERENCE_IMAGE_LIMIT = 3`(`src/config/genModels.js:43`), 영상 다중 레퍼런스는 미관측 → 3. 렌더러 계획(D3-7)과 main(D1)이 둘 다 막는다.
- 이미지: 앱 상한 없음. UI 가 칩을 안 받으면 게이트(D9-3)가 클릭 전에, 서버가 거부하면 실패 프레임(`flow-rpc-error`, 0크레딧)이 닫는다.

### D14. 결과 계약 · 새 kind · 문구 · 로그
결과 계약은 P2 §3 그대로(이미지 `{success, images}`, 영상 `{success, generationId, creditsLeft}`). 새 kind(전부 ko/en `errorSection.kind.*`, params 는 이 표만):

| kind | 언제 | params | ko | en |
|---|---|---|---|---|
| `flow-reference-attach-failed` | 업로드·애셋 창·멘션·칩·게이트 실패(클릭 전). `reason` 필드(렌더 안 함) | `{}` | Flow 에 레퍼런스를 붙이지 못해 생성하지 않았습니다(크레딧 사용 없음). 다시 시도해 주세요. | Couldn't attach the references in Flow, so nothing was generated (no credits used). Please try again. |
| `flow-reference-source-missing` | ref 이미지 바이트를 못 읽음(렌더러, IPC 전) | `{}` | 레퍼런스 이미지 파일을 읽을 수 없어 생성하지 않았습니다. 레퍼런스 탭에서 이미지를 다시 지정해 주세요. | Couldn't read a reference image file, so nothing was generated. Re-select the image in the References tab. |
| `flow-reference-clipboard-busy` | 되돌릴 수 없는 클립보드(D4-c) | `{}` | 클립보드에 되돌릴 수 없는 항목(파일 등)이 있어 레퍼런스 업로드를 멈췄습니다. 텍스트를 한 번 복사한 뒤 다시 시도해 주세요. | Your clipboard holds something that can't be restored (such as a copied file), so the reference upload was stopped. Copy any text once and try again. |
| `flow-references-mismatch` | 클릭 뒤 레퍼런스 불일치(D10·D12) | `{}` | Flow 가 요청과 다른 레퍼런스로 생성해 결과를 쓰지 않았습니다. 영상이라면 Flow 에는 남아 있습니다(크레딧 사용됨). | Flow generated with different references than requested, so the result was not used. A video stays in Flow (credits were used). |
| `flow-references-model-unsupported` | refs + r2v 미지원 모델(D11) | `{model}` | {model} 은(는) Flow 에서 레퍼런스 영상을 지원하지 않습니다. Omni Flash 또는 Veo 3.1 Fast 를 선택해 주세요. | {model} doesn't support reference-to-video in Flow. Choose Omni Flash or Veo 3.1 Fast. |
| `flow-references-too-many` | 영상 ref > 3(D13) | `{max}` | Flow 레퍼런스 영상은 레퍼런스를 최대 {max}개까지 쓸 수 있습니다. | Flow reference-to-video accepts at most {max} references. |

- `flow-references-unsupported` 문구는 남는 경우(레퍼런스 생성의 스타일 ref, 옛 모양 페이로드)에 맞게 고친다. `flow-mention-chips-unsupported`·`flow-t2v-reference-images-unsupported` 는 생산자가 사라지지만 저장된 옛 항목 표시용으로 문구를 둔다.
- **배치 중단**(P2 §3): 영상 훅 `REPEATABLE_PRECLICK_KINDS`(`src/hooks/useVideoAutomation.js:65`)에 `flow-references-model-unsupported`·`flow-reference-clipboard-busy`, 그리고 `flow-reference-attach-failed` 중 배치 전체 사유(`paste-not-observed`·`mention-trigger-not-working`·`picker-not-open`·`no-project-id`)만 — 같은 kind+reason 두 번 연속이면 종결. 나머지 attach 사유는 항목 사유(다음 항목 재시도). 이미지 배치는 기존 3연속 실패 규칙(`useAutomation.js:392-393`).
- **로그 접두**: `[Flow Refs]`(계획·캐시·애셋 창·멘션·게이트) · `[Flow Upload]`(클립보드·붙여넣기·maseQ). 진단 보고 스텝: `refs:<reason>` · `upload:<reason>` · `rpc-shape:maseQ@…`(내용 없음, 개수·앞 8자·불리언만).

### D15. 렌더러 배관 · 동기화 게이트 퇴역
- `useAutomation.js:296` Flow 필터 `flowImageInjectable` → `sourceAvailable`(+`imagePath → filePath`), `:624-629` Flow 선행 업로드 없음(`refsToUpload = []`, 주석으로 이유) — 업로드는 main 이 항목마다 캐시와 함께 한다.
- `useSceneGeneration.js:108-128` 은 이미 name/data/filePath 를 넘긴다 — 그대로.
- `refImageGuard.js:80-136` `collectM1FlowReferenceExclusions`: Flow(M3) 에서 쓸 수 있음 = `sourceAvailable`(멘션·첨부 공통). mediaId 만 있고 로컬 이미지 없는 ref 는 기존 제외 토스트(`toast.unusableRefsExcluded`)로 빠진다(§6 #15).
- `mentionSyncTargets.js:22-41` → 항상 `[]`(새 Flow 엔 엔티티 동기화가 없고 엔진은 `parseSceneMentions` 를 안 쓴다 — "파서가 둘이면 어긋난다" 규칙(`:8-10` 주석)을 따라 게이트도 새 파서의 결과(동기화할 것 없음)를 낸다). 그래서 `emptyRefGate.js:188-193`·`App.jsx:1796-1799`·`mentionSyncRequest.js:39` 가 모달 없이 통과하고 MCP 의 `nonInteractiveSyncGate` 가 멘션 배치를 취소하지 않는다. 옛 동기화 UI·코드 정리는 범위 밖(§7).
- `videoPromptReferences.js:60-70` Flow 분기: `referenceImages` = 멘션된 쓸 수 있는 ref(`toGenerationReference`, 자르지 않는다 — 상한은 D3 가 거부), `styledPrompt` 는 `@` 토큰 유지, `segments: null`, `missing` = 미해결 이름.
- `engineFlow.generateVideoT2V`: `planFlowReferenceComposition({mode:'video', pool: referenceImages})` → 바이트 → IPC `refs`·`plan`.

### D16. M2 함정 · 새 위험 대응표

| 함정/위험 | 대응 | 핀(작업) |
|---|---|---|
| 화면 밖 뷰는 재레이아웃 안 됨 | 애셋 창·붙여넣기도 기존 제자리 뷰포트+방패 안에서(`flow-angular.js:259-272`) | M3-9 숨은 뷰 케이스 |
| Escape 로 닫은 패널 → 다음 트리거 헛클릭 | 애셋 창은 트리거 클릭으로 닫는다; 안 열리면 흔적 없을 때만 1회 재클릭(D7) | M3-8 |
| 한글 IME 가 키 잠금 우회 | 편집기 오염은 D8-5·D9 게이트·`editorExpected` 가드(Q1)가, **검색창 오염은 `picker-search-dirty`** 가 클릭 전에 잡는다 | M3-8 |
| 문서 이동을 넘긴 `executeJavaScript` 는 영영 settle 안 함 | 폴 exec 마다 1s race, 클립보드 복원은 exec 무관 5s 마감, `did-navigate` 의 `failBoundUnfinished` 가 바인딩된 `maseQ` gen 을 닫는다 | M3-7 |
| 방패 focus 가 편집기로 포커스를 되돌림 | 컴포즈 단계는 행선지 `'flow'`(주입 중), 게이트·재판독 뒤 `focusMainWindow()`(`:147-150`) 그대로 | M3-9 순서 핀 |
| 사용자 클립보드 덮어쓰기 | D4-c 스냅샷·조건부 복원·되돌릴 수 없으면 거부 | M3-5·M3-7 |
| 붙여넣기가 다른 창·입력란으로 | `webContents.paste()` 는 Flow 뷰의 포커스된 프레임에만 [추정, P1]; 사전 판독(`activeElement` ⊂ 편집기)·관찰 리스너의 대상 확인 | M3-7 |
| 업로드 타임아웃·실패 | send 15s / loadend 100s, 칩 10s — 전부 클릭 전 실패 | M3-3·M3-7 |
| 중복 업로드 | 직렬 업로드 + 캐시 + 항목 안 sha 중복 제거 | M3-6·M3-8 |
| 캐시 무효화 | 키(프로젝트·바이트) + 스캔 검증 + 재업로드 | M3-6·M3-8 |
| 멘션 삽입 중 편집기 오염(사용자 타이핑) | 키 잠금 + 삽입마다 검증 + 게이트 + mouseDown 직전 관문 | M3-8·M3-9 |
| 메뉴 클릭(편집 → 붙여넣기)이 DOM 단계 중 Flow 뷰로 사용자 클립보드를 붙임 | 여분 칩 → 게이트(칩 집합 불일치) 클릭 전 실패 | M3-8 |

---

## 3. M3-0 — 구현 전 프로브 (0크레딧; P9 만 7크레딧·사용자 확인)

**준비**: 스크래치 브랜치 `probe/m3-0`(**머지 금지**, 끝나면 삭제 — 제품 코드가 아니다)에 환경변수 `AUTOFLOWCUT_M3_PROBE=1` 일 때만 붙는 로컬 라우트 `POST /api/dev/m3-probe {step}` 를 둔다(main 의 기존 127.0.0.1 HTTP 서버). 라우트는 `executeJavaScript`·`trustedClickOnFlowView`·`clipboard`·`webContents.paste()`·(P4 만) 키 `sendInputEvent` 로 한 단계를 돌리고 **마스킹된** JSON(id 앞 8자, 텍스트 없음, 마크업은 id·서명·텍스트 노드 치환)을 돌려준다. 앱은 K3 §4 대로 NET_TRACE 로 띄운다. 테스트 이미지는 스크래치에 만든 단색 PNG(64×64 · 1376×768 · 6000×6000)와 같은 PNG 의 사본 — 사용자 콘텐츠가 아니다. 결과는 `docs/handoffs/evidence/2026-09-2x-m3-probes.md`(마스킹) + RAW 요약(§1-4 ①~⑦)을 커밋한다.

| # | 목적 | 절차 · 재는 것 | 결과 → 설계 |
|---|---|---|---|
| **P1** | 자동화 조건에서 붙여넣기 업로드 | 제자리 뷰포트+방패+키 잠금 흉내 → `flowView.webContents.focus()` → 편집기 캐럿 신뢰 클릭 → 관찰 리스너 주입 → 클립보드 PNG → `paste()`. 변형 (a) 앱 창 포커스 (b) **앱 창 비포커스**(curl 뒤 3초 안에 Finder 클릭) (c) **Flow 뷰 숨김**(앱 모달로 0×0 → 제자리 확장). 잰다: 붙여넣기 관찰까지 ms · `maseQ` send 까지 · send→loadend · 칩 상태 100ms 샘플(`aria-busy`, src 가 blob/data 인지) · 관찰 직후 클립보드를 복원해도 업로드가 되는지 | 셋 다 됨 → D4 그대로. (b) 만 실패 → 붙여넣기 순간만 `mainWindow.focus()`(macOS `app.focus({steal:true})`) 후 되돌리는 단계를 D4 에 추가하고 로그 `app focused for paste`. (c) 실패 → 제자리 뷰포트가 이미 보이게 하므로 원인 재측정; 그래도 실패면 **M3 중단** — 업로드 경로가 없다(CDP·파일 대화상자 대안 없음), 사용자와 재결정 |
| **P1d** | 되돌릴 수 있는 클립보드 형식 | 사용자가 (1) TextEdit 평문 (2) 서식 텍스트 (3) 미리보기 앱 이미지 (4) Finder 파일 을 복사할 때마다 `availableFormats()` 기록 | `RESTORABLE_FORMATS` 확정(D4-c). (4) 가 표준 형식만 보고하면(판별 불가) 파일 복사 보호는 불가 → §6 #16 잔여 위험으로 명시 |
| **P2** | 컴포저 비우기 | 손으로 텍스트+멘션 1+칩 2 를 만든 뒤 `button.clear-button` 신뢰 클릭 → 칩·텍스트·멘션 판독. 이어 칩 하나에 mouseMove(hover) 후 신뢰 클릭 → 판독 | 전부 비움 → D9 그대로. 텍스트만 → 칩 개별 제거 절차(관측된 동작)를 D9 에. 아무것도 안 됨 → 잔여 칩이 있는 컴포저는 `composer-not-clear` 로 항상 거부(사용자가 손으로 비워야 한다 — 문구 보강) |
| **P3** | 멘션 노드 마크업·칩 결합 | `@`→항목→추가 뒤 `div.ProseMirror` innerHTML(마스킹)·선택 위치·칩. 변형: 칩 1개가 있는 상태에서 멘션 · 서로 다른 미디어 멘션 2개 · 같은 미디어 2번 | 노드 판별 셀렉터 확정(D8-5·D9-4). 노드에 id 가 있으면 게이트가 순서열 비교, 없으면 개수만(순서는 클릭 뒤 요청이 판정). 칩이 **대체**되면(§1-4 ④) D9 의 "빠진 칩 채우기"가 이미 흡수 — 테스트 픽스처에 그 동작을 넣는다 |
| **P4** | `@` 트리거 방식 | (i) `execCommand('insertText','@')` (ii) `sendInputEvent char '@'` 만 (iii) `keyDown/char/keyUp '@'` — 각각 키 잠금 **켠 채**와 끈 채, 한글 2벌식 입력기 켠 채 한 번 더 → 애셋 창 열림·편집기 텍스트. 추가: 평문 `"a@b.com (@x) y @ z"` 를 insertText 로 넣으면 열리나, `(` 뒤 `@` 트리거 | (i) 열림 → D8 은 insertText 사용 + 텍스트 `@` 거부(`at-sign-in-text`). (i) 안 열림·(iii) 열림 → D8 기본값(신뢰 키 + 1회용 허용). 잠금 켠 채 (iii) 이 페이지에 닿으면(`before-input-event` 가 합성 키엔 안 돈다) 허용 장치는 빼고 핀만. `(` 뒤 안 열리면 `mention-trigger-not-working` 으로 거부(문장 수정은 하지 않는다) |
| **P5** | 애셋 창에서 id 로 고르기 | ＋ → 업로드 탭(`drive_folder_upload`) → 항목 수·항목 `img` src id·목록 스크롤 컨테이너/가상화 여부(업로드 20개 넘는 프로젝트) → 특정 id 항목 신뢰 클릭 → 상세 미리보기 컨테이너 클래스·src → 추가 → 칩. 닫기: 트리거 클릭 / Escape 각각 뒤 다음 ＋ 첫 클릭이 여는지 | 셀렉터 확정(D7). 가상화로 오래된 업로드가 안 그려지면 "못 찾음 → 재업로드"(0크레딧 중복)로 두고 §6 #10 에 기록. 탭이 없거나 목록이 안 바뀌면 전체 탭 |
| **P6** | 같은 이미지 재업로드 | 같은 PNG 두 번 붙여넣기 → mediaId 둘 | 다르면 캐시가 중복을 막는다(설계 그대로). 같으면 무해 |
| **P7** | 설정 × 칩 | 칩 1개 붙인 채 `applyComposerSettings` 로 이미지↔영상·Omni↔Veo 전환(제출 없음) → 칩·편집기·요약. 영상에서 Veo 3.1 Quality/Lite 선택 후 칩 첨부 → 모델·요약 변화 | 보존되면 순서(설정 → 컴포즈) 그대로 + D9-6 요약 재확인. 칩이 모델을 바꾸면 D9-6 이 클릭 전에 잡는다(문구 확인). 모드 전환이 칩을 지우면 순서 그대로가 맞다(설정 먼저) |
| **P8** | 업로드 한계·실패 모양 | 1×1 PNG · 6000×6000 PNG · 텍스트만 있는 클립보드 붙여넣기 → `maseQ` 상태·실패 프레임·칩 수명 | 실패 프레임 픽스처를 M3-1 에 추가. 큰 이미지가 느리면 loadend 100s 안인지 확인(아니면 업로드 전용 마감) |
| **P9** | (7크레딧, **사용자 확인**) 영상 인라인 멘션 요청 모양 | 사용자가 손으로: 영상 · Omni 4초 · 9:16 · `@`→업로드한 이미지 → 텍스트 → 제출. NET_TRACE 로 `MZZa6b` 요청 `[0][0][0][2]` 세그먼트와 응답 되돌림 | 멘션 세그먼트가 이미지와 같은 모양이면 영상 `videoMentions:'inline'`(D3-7), `extractSubmitRefs('MZZa6b')` 에 멘션 경로 추가. 사용자가 거절하면 `'chips'` 기본값 — 결정 1 과의 차이를 계획서 §8 에 사용자 확인으로 남긴다 |

---

## 4. TDD 작업 목록

### 구현자 공통 규칙 (P2 §3 의 규칙 전부 + M3 추가)
- P2 §3 그대로: 결과 계약 · kind→params 고정표(D14 로 확장) · 배치 중단 의미 · 마감·시각(초) · 주입 문자열 자기완결·멱등·minify 평가 · 로그 내용 금지 · 픽스처 재인코딩.
- **작업마다**: 실패 테스트(빨간 단언 확인) → 최소 구현 → 파일 초록 → 전체 스위트 초록(`env -u ELECTRON_RUN_AS_NODE npx vitest run`) → 뮤테이션 1회 이상(빨강 확인 후 `cmp` 복구). 새 소스 핀은 줄머리 앵커(`^\s*…/m`, P2 §12.11 관찰 6).
- **M3 픽스처**: 새 로더 `tests/fixtures/flow-m3-samples.js` — S3 를 `step`(+`rpcid`)로 고르고 `<uuid#n>` 을 기존 `maskedUuid(n)`(`tests/fixtures/flow-batchexecute-samples.js:18-20`)로, 요청은 `reencodeRequestBody`(`:49-54`) 규칙으로. DOM 픽스처 `tests/fixtures/flow-live-dom-m3.js` — RAW 의 칩 바·지우기 버튼·트리거 마크업(마스킹) + P3·P5 가 확정한 애셋 창·멘션 마크업, **영어 변형**(탭 텍스트 "Uploads", 칩 aria-label "Ingredient")을 같이 — 파인더가 문구를 안 보는 증명.
- **가짜 페이지**: `tests/helpers/fakeFlowComposer.js`(새) — jsdom 문서에 칩 바·편집기·애셋 창을 그리고 동작을 흉내 낸다: ＋ 토글, 탭 필터, 항목 클릭(active·미리보기), 추가(＋ 모드 = 칩 추가 / `@` 모드 = 멘션 노드 + 칩 — `opts.mentionChip:'add'|'replace'` 로 P3 두 경우), 지우기 버튼(`opts.clear:'all'|'text-only'`), 붙여넣기(관찰 리스너가 보는 `paste` 이벤트 + 바쁜 칩 → N ms 뒤 id 칩), `@` 트리거(`opts.atTrigger:'key'|'insertText'`). 핸들러 하네스의 `executeJavaScript` 는 컴포저 스크립트를 이 문서의 `window.eval` 로 **실제로** 돌리고(P2 §12.3 #66·§12.7 #103 의 `window.eval` 선례), 나머지(WIZ·캡처 프로브·설정 드라이버·에이전트)는 기존 하네스(`tests/electron/ipc/flowGenerateImageAngular.test.js:31-120`)처럼 마커로 라우팅한다. 신뢰 클릭 가짜는 표현식이 돌려준 요소에 `click` 을 보낸다.

**M3-1 프로토콜(순수)** — `tests/electron/flow-rpc-protocol.test.js` / `electron/flow-rpc-protocol.js`
- `extractSubmitRefs(rpcid, inner)`(새, 자기완결 — 캡처에 직렬화): S3#9 → `{refs:[U2,U3], mentions:[U2]}`; S3#3 → `{refs:[U2], mentions:[]}`; 09-24 S1(`[1][0][2]=null`) → `{refs:[], mentions:[]}`; S3#10 → `{refs:[U2], mentions:[]}`; S3#14 → `{refs:[], mentions:[]}`; `[1][0][2]` 가 문자열인 사본 · id 가 UUID 아닌 사본 → `null`(검증 불가 — 빈 배열과 구분됨을 단언). `U<n>` = `maskedUuid(n)`.
- `extractSubmitPrompts('MZZa6b', S3#10 inner)` → `['The king walks slowly toward the camera']`(지금은 `[]` — 빨강); `('ogiZ0b', S3#9)` 를 `normalizePrompt` 하면 `'and a queen in a garden'`(멘션 세그먼트는 빠진다).
- `parseUploadResponse`: S3#4 → `{mediaId:U3}`, S3#2 → `{mediaId:U2}`; `[1][3][4]` 를 다른 id 로 바꾼 사본 · `[0][0]` 비-UUID → `/maseQ response shape changed at \[0\]\[0\]/`; `JSON.stringify(결과)` 에 `image.png`·`king.jpg`·`image/` 없음.
- `parseVideoSubmitResponse(payload, 'MZZa6b')`: S3#10 → `{mediaId:U30, modelKey:'abra_r2v_4s', creditsLeft:904, refEcho:[U2]}`; S3#15 → `U40`·`veo_3_1_r2v_fast_portrait`·864; `[3][0][7][0][12]` 삭제 사본 → 메시지가 `MZZa6b response shape changed`(`YhhmEf` 아님) + `rejectedMediaId:U30`; 되돌림 경로 삭제 사본 → 성공 + `refEcho:null`. 기존 `YhhmEf` 케이스는 인자 없이 무변경.
- `parseImageGenerateResponse`: S3#9 `results[0].refEcho` = `[U2,U3]`, S3#3 = `[U2]`, 09-24 S1 = `null`.
- `modelKeyMatches` r2v 진리표(CAT 키만): **true** `('abra_r2v_4s',{model:'Omni Flash',duration:4,ratio:'9:16',resolution:'720p',kind:'r2v'})` · `('abra_r2v_6s_360p', Omni,6,'16:9','360p',r2v)` · `('veo_3_1_r2v_fast_portrait', Veo 3.1 - Fast,8,'9:16',r2v)` · `('veo_3_1_r2v_fast_landscape', Fast,8,'16:9',r2v)` · `('veo_3_1_r2v_fast_portrait_ultra_relaxed', Fast,8,'9:16',r2v)`; **false** `('abra_r2v_4s', …, kind 생략)`(t2v 기본) · `('abra_t2v_4s', …r2v)` · `('veo_3_1_r2v_fast_portrait', Fast,8,'16:9',r2v)` · `('veo_3_1_r2v_fast_landscape', Fast,8,'9:16',r2v)` · `('veo_3_1_r2v_lite', Lite,8,r2v)` · `('abra_r2v_4s', Omni,6,r2v)` · `('abra_i2v_4s', …r2v)`. 기존 t2v 표 전부 초록 유지.
- F12 핀(P2 §12.3 #72) 유지: 새 shape 경로 인덱스도 전부 < 100.
- 뮤테이션: 방향 토큰 검사 삭제 → landscape/portrait 행 빨강; `extractSubmitRefs` 가 멘션 세그먼트를 텍스트로 셈 → S3#9 빨강.

**M3-2 캡처 주입** — `tests/electron/flow-rpc-capture.test.js`, `tests/electron/flow-injections-minified.test.js` / `electron/flow-rpc-capture.js`
- vm+FakeXHR(`tests/electron/flow-xhr-capture.test.js:13-35` 방식): S3#10 재인코딩 body → send `{rpcid:'MZZa6b', prompts:['The king…'], refs:[U2], mentions:[]}`; S3#9 → `refs:[U2,U3], mentions:[U2]`; S3#4(`maseQ`) → `{rpcid:'maseQ', prompts:[]}` 이고 `JSON.stringify(ev).length < 400`, `<b64`·`image.png`·`image/png`·`SECRET` 없음; `maseQ` loadend 는 `responseText` 를 싣는다; 옛 ogiZ0b/YhhmEf 이벤트 모양 무변경(`refs` 추가만); `send` body 불변(세 rpc 모두).
- minified 번들에서 같은 결과(설치 플래그가 아니라 이벤트 페이로드 단언).
- 뮤테이션: `maseQ` 도 디코드 경로로 → 길이/문자열 단언 빨강; 허용 목록에서 `MZZa6b` 제거 → 빨강.

**M3-3 라우터** — `tests/electron/flow-rpc-router.test.js` / `electron/flow-rpc-router.js`
- `{rpc:'MZZa6b', altRpcs:['YhhmEf']}` gen + `YhhmEf` send → 바인딩, `boundRpc==='YhhmEf'`; loadend 09-24 S2 → `mediaId` 로 settle(파서가 `YhhmEf`). `altRpcs` 없는 gen + 다른 rpc send → 미바인딩(옛 동작).
- send 의 `refs`/`mentions` → `gen.sentRefs`/`gen.sentMentions`(없으면 `null`).
- `maseQ` gen: send 바인딩 → loadend S3#4 → `gen.mediaId===U3`; 실패 프레임 → `error:'flow-rpc-error'`, `rpcCode`; 15s send 없음 → `flow-submit-not-sent`(유예 없음 — 이미지와 같다); 미바인딩 `maseQ` loadend → `{dropped:'unbound'}`, `reportDomFailure` 미호출.
- `MZZa6b` send 마감 → 유예(닫히지 않음, `sendDeadlinePassed`, 훅 호출) — `YhhmEf` 와 같은 표 테스트에 행 추가; 최근 닫힌 `MZZa6b` gen 뒤 미바인딩 `MZZa6b` 200 → `media=<8>` 줄 + 보고.
- 뮤테이션: `SEND_GRACE_RPCS` 에서 `MZZa6b` 제거 → 빨강; `noteUnboundClose` 를 `YhhmEf` 만 → 빨강.

**M3-4 컴포저 레퍼런스 DOM 파인더** — `tests/electron/flow-composer-refs.test.js`(새) / `electron/flow-composer-refs.js`(새, 순수 + `*_JS` 단일 표현식)
- `readComposerState(doc)` → `{chips:[{mediaId, busy}], segments:[{t:'text'|'mention', …}], editorText, pickerOpen, searchDirty, activeInEditor}`: 칩 2개 순서, `aria-busy="true"` 또는 src 가 blob/data → `busy:true, mediaId:null`, 서명 쿼리 붙은 src 에서 UUID 만; 멘션 노드(P3 셀렉터) 판별과 라벨 분리; 영어 변형 픽스처에서 같은 결과.
- `findAssetItemByMediaId(doc, id)` → 정확한 요소; 같은 id 두 항목 → `null`; `lh3…/asb/…` 썸네일만 있는 항목은 어떤 id 로도 안 잡힘; id 가 다른 id 의 접두인 경우(`U2` vs `U2x…`) 오매칭 없음(`(\?|$)` 경계).
- `findPickerTab(doc, 'drive_folder_upload')` → 아이콘으로; 텍스트 "업로드"만 있고 아이콘 없는 탭 → `null`.
- `findAddMenuTrigger`·`findClearPromptButton`·`findAddToPromptButton` 각각 정확히 하나일 때만; `readPickerPreviewMediaId`(P5 셀렉터).
- `noLocaleBoundDomAnchors`(무변경) 초록 — 새 파일에 한글 문구 매칭 없음.

**M3-5 클립보드** — `tests/electron/flow-clipboard.test.js`(새) / `electron/flow-clipboard.js`(새; `clipboard`·`nativeImage` 주입)
- `snapshotClipboard`: `{text, html}` → 복원 때 `write` 가 **정확히** `{text, html}` 로 불린다(순서·값); 이미지 스냅샷 → `write({image})`; 빈 클립보드 → 복원 = `clear()` 만; 형식 `['text/uri-list','text/plain']` → `restorable:false`.
- `writeUploadImage` → `writeImage` 1회 + 서명 반환.
- `restoreClipboard`: 서명 같음 → `clear` 뒤 `write`; 우리가 쓴 뒤 가짜 클립보드가 다른 텍스트로 바뀜 → `{restored:false, reason:'changed-by-user'}` 이고 **`write`·`clear` 미호출**; `write` throw → `{restored:false, reason:'restore-threw'}`, 다시 던지지 않음.
- 로그 문자열에 스냅샷 텍스트·html 없음(명시 단언 + `noUserContentInLogs`).
- 뮤테이션: 서명 비교 삭제 → changed-by-user 케이스 빨강.

**M3-6 캐시 + 프로젝트 id** — `tests/electron/flow-ref-media-cache.test.js`(새), `tests/electron/flowUrl.test.js` / `electron/flow-ref-media-cache.js`(새), `electron/flowUrl.js`
- `get/set/delete` 가 `(projectId, sha)` 로; 다른 프로젝트 → miss; 새 인스턴스가 같은 파일에서 읽음(영속); 깨진 JSON → 빈 캐시 + warn, throw 없음; 상한 N+1 → 가장 오래된 `at` 이 사라짐; 쓰기는 임시 파일 → rename(가짜 fs 호출 순서 단언); 같은 바이트 다른 이름 → hit(키가 이름을 안 본다).
- `projectIdFromFlowUrl`: `https://flow.google.com/project/<id>` → id; `/project/<id>/character`·`?next=/project/<id>`·다른 호스트·옛 도메인 → `null`.

**M3-7 업로드 드라이버** — `tests/electron/flow-reference-upload.test.js`(새) / `electron/flow-reference-driver.js`(새) `uploadReferenceByPaste(ctx, ref)`, `FLOW_PASTE_OBSERVER_INJECTION`
- 하네스: `fakeFlowComposer` + 가짜 클립보드 + 실제 라우터 ctx(`routeReportResponse`·`buildReportCtx`) + `page.send/loadend('maseQ', S3#4)`.
- 정상: trace 순서 `state-read → clipboard:snapshot → clipboard:writeImage → paste → paste-observed → clipboard:restore → maseQ:send → maseQ:loadend → chip-verified → cache:set` — **복원이 loadend 보다 먼저**(업로드가 끝날 때까지 클립보드를 붙잡는 틀린 구현이 빨갛다); 결과 `{ok:true, mediaId:U3}`.
- `activeElement` 가 애셋 검색창 → `availableFormats`·`writeImage`·`paste` 전부 **미호출**, reason `focus-not-editor`.
- 되돌릴 수 없는 클립보드 → `flow-reference-clipboard-busy`, `writeImage`·`paste` 미호출.
- 관찰 exec 가 영영 settle 안 함(가짜 타이머) → 붙여넣기 뒤 5s 안에 `clipboard:restore`, reason `paste-not-observed`, gen 맵에서 삭제, `cache:set` 없음.
- 관찰됐으나 대상이 편집기 밖 → `paste-wrong-target`.
- 사용자가 업로드 중 복사 → 복원 안 함 + 업로드는 성공.
- `maseQ` 실패 프레임 → `upload-rpc-error`; loadend id ≠ 칩 id → `chip-mismatch` 이고 `cache:set` 없음; 새 칩이 둘 → `chip-mismatch`.
- `isAborted()` 가 쓰기 전에 true → 클립보드·붙여넣기 없음.
- 로그·보고에 base64·`image.png`·경로 없음.
- 뮤테이션: 복원을 finally 에서 성공 경로로만 → exec-hang 케이스 빨강; 칩 검증 생략 → mismatch 케이스 빨강.

**M3-8 컴포즈 드라이버(애셋 창·멘션·정리·게이트)** — `tests/electron/flow-reference-compose.test.js`(새) / `flow-reference-driver.js` `clearComposer`·`scanUploadedAssets`·`attachAsset`·`insertMention`·`composeReferencePlan`·`readGate`
- 계획 `[text 'A ', mention r0, text ' walks with the queen']` + attach `[r1]`, 캐시 hit·목록에 둘 다 있음 → 최종 DOM 세그먼트·칩 집합 `{m0,m1}`, **`paste` 0회**(재사용 증명), 클릭 순서 `＋→업로드탭→(닫기) … @→탭→item(m0)→추가 … ＋→item(m1)→추가`.
- 캐시 hit 인데 목록에 없음 → 그 ref 만 `uploadReferenceByPaste` 1회, 캐시 항목 교체, 업로드 뒤 정리 1회.
- `mentionChip:'replace'` 픽스처(P3 대체 동작) → "빠진 칩 채우기"가 ＋로 보충해 게이트 통과; `'add'` 픽스처도 통과(두 동작 모두 같은 최종 집합).
- 검색창에 글자(IME 흉내) → `picker-search-dirty`, 업로드·추가 없음.
- 미리보기 id 가 다름 → `preview-mismatch`, 추가 클릭 없음.
- 추가 뒤 여분 칩(메뉴 붙여넣기 흉내) → 게이트 `chip-set-mismatch`, arm·제출 없음.
- 칩 집합은 같고 멘션 순서가 뒤바뀜(노드가 id 를 드러내는 픽스처) → `mention-mismatch`.
- 시작 때 잔여 칩 → 지우기 클릭 → 비워짐; `clear:'text-only'` 픽스처 → P2 절차(또는 `composer-not-clear`).
- 애셋 창이 첫 클릭에 안 열림(헛클릭 픽스처) → 1회 재클릭 → 진행; 두 번 다 안 열림 → `picker-not-open`, **Escape keydown 없음**.
- `@` 트리거가 안 열림 → `mention-trigger-not-working`.
- 같은 sha 두 ref → 업로드 1회.
- 뮤테이션: 게이트의 집합 비교를 개수 비교로 → "같은 개수 다른 id" 케이스 빨강; 검색 오염 검사 삭제 → 빨강.

**M3-9 이미지 핸들러** — `tests/electron/ipc/flowImageReferencesAngular.test.js`(새), `tests/electron/ipc/flowGenerateImageAngular.test.js`(칩 게이트 행 추가) / `electron/ipc/flow-angular.js` `generateImage`·`collectRpcGen`·`makeDispatchGuard`·`editorChangedBeforeClick`·`withAutomationViewport(…, {timeoutMs})`
- 순서 단언: 세션 → 에이전트 → 캡처 → 설정 → 캐럿 → 정리 → 스캔 → (업로드) → 컴포즈 → 게이트 → `focusMainWindow` → 제출 가능 → 재판독(텍스트+칩) → arm(`expectedRefs`,`expectedMentions`,`normPrompt`) → 신뢰 클릭(`beforeDispatch` 가 칩도 본다).
- 동기: send(S3#9 재인코딩 이벤트) → loadend S3#9 → `{success:true, images:[…]}`, 로그 `refs verified request=2 echo=2`.
- send `refs:[U9]`(기대 `[U2]`) → `flow-references-mismatch`, `postClick:true`, **`sessionFetch` 미호출**; 응답 되돌림만 어긋남 → 같음; 둘 다 `null` → 성공 + warn + `reportDomFailure('rpc-shape:ogiZ0b@refs')`.
- 레퍼런스 없는 요청인데 잔여 칩 → 정리 후 진행; 정리 실패 → `flow-reference-attach-failed`, 클릭 없음; send `refs:[U3]`(요청 안 한 ref) → mismatch.
- mouseDown 직전 칩이 하나 늘어남 → 미디스패치 거부, gen 삭제, 클릭 전 실패(Q1 경로).
- 워치독 예산: ref 2개 → 121s 에 타임아웃 없음, `120 + 240` 초에 `dom-stage-timeout`; 좀비는 클립보드·붙여넣기 없음.
- `projectIdFromFlowUrl` null → `no-project-id`, DOM 단계 진입 없음; `plan` 인덱스 범위 밖 → `bad-plan`, executeJavaScript 는 WIZ 프로브뿐.
- 숨은 뷰(0×0) → 제자리 확장 + 방패 안에서 붙여넣기·애셋 창 클릭(`bounds:` trace 가 붙여넣기보다 앞).
- 뮤테이션: `collectRpcGen` 의 레퍼런스 검증 삭제 → mismatch 케이스 빨강; `beforeDispatch` 의 칩 비교 삭제 → 빨강.

**M3-10 영상 핸들러(r2v)** — `tests/electron/ipc/flowVideoR2VAngular.test.js`(새), `tests/electron/ipc/flowVideoT2VAngular.test.js`(칩 게이트·alt rpc 행), `tests/electron/ipc/flowAngularDispatch.test.js` / `flow-angular.js` `generateVideoT2V`·`finishVideoGen`, `electron/ipc/video.js:122-125`
- refs 1개 · Omni 4초 · 9:16: arm `rpc:'MZZa6b', altRpcs:['YhhmEf']`, `want.kind:'r2v'` → send/loadend S3#10 → `{success:true, generationId:U30, creditsLeft:904}`, 로그 `submitted media=00000030 creditsLeft=904 modelKey=abra_r2v_4s refs=1/1`.
- 페이지가 `YhhmEf` 로 보냄(09-24 S2) → `{success:false, errorKind:'flow-references-mismatch', rejectedMediaId, postClick:true}` 이고 **`generationId`·`mediaId` 키 없음**.
- 모델키 `abra_t2v_4s` 사본 → `flow-video-settings-mismatch`(r2v 기대); Veo Fast 16:9 에 `…_portrait` → 불일치.
- refs + `Veo 3.1 - Quality` → `flow-references-model-unsupported {model}`, **WIZ 외 executeJavaScript 0회**; refs 4개 → `flow-references-too-many {max:3}` 동일.
- 레퍼런스 없는 T2V: arm `altRpcs:['MZZa6b']`; 페이지가 `MZZa6b` 로 보냄 → mismatch + `rejectedMediaId`(지금의 "lost 로 사라짐" 대신 id 가 남는다 — §1-1 돈 구멍); 잔여 칩 → 정리 후 `YhhmEf`.
- 유예: `MZZa6b` send 가 20s 에 옴 → 정상 바인딩(15s 훅은 크레딧 재판독만).
- `video.js` 가 `refs`·`plan` 을 angular 로 넘긴다(핸들러 진입 로그 `refs=<n>` 로 관측 — 빨강: 구조분해 누락).
- 뮤테이션: `boundRpc` 비교 삭제 → 빨강; `altRpcs` 없이 arm → mismatch 케이스가 not-sent 로 빨강.

**M3-11 렌더러 계획·엔진** — `tests/utils/flowReferencePlan.test.js`(새), `tests/engine/engineFlow.test.jsx`(게이트 블록 교체), `tests/utils/videoPromptReferences.test.js` / `src/utils/flowReferencePlan.js`, `src/engine/engineFlow.js`, `src/utils/videoPromptReferences.js`
- 계획: `'@king이 웃는다'` + pool `[king(character, filePath)]` → `[{t:'mention',ref:0},{t:'text',text:'이 웃는다'}]`; `'@{Alice Smith} runs'` → 정확 매칭; `'@ghost'` + pool 비어 있지 않음 → `{errorKind:'unresolved-mentions', unresolvedNames:['ghost']}`, pool 비어 있음 → 텍스트; `'a@b.com'` → 텍스트; `@king … @king` → 두 번째는 `'king'` 평문; 멘션 ref 원천 없음 → `flow-reference-source-missing`; 태그 queen → `attach:[1]`, 멘션된 king 은 attach 에 없음(중복 제거); 영상 4개 → too-many; 영상 `'chips'` → 멘션 0·attach 에 king·텍스트에 `@` 없음.
- 엔진: 이미지 씬 refs → `flowGenerateImage` 페이로드에 `refs[i].base64`·`plan`·`referenceImages:[]`; 두 ref 중 하나를 못 읽음(가짜 fs) → `flow-reference-source-missing` 이고 **IPC 미호출**; `purpose:'reference'` + 스타일 ref → `flow-references-unsupported`; 업스케일 게이트 그대로; 영상 → `flowGenerateVideoT2V` 에 `refs`·`plan`, `segments` 없음.
- `videoPromptReferences` Flow 분기: `referenceImages` = 멘션된 원천 있는 ref, `segments:null`, `missing` = 미해결.
- 뮤테이션: 엔진이 `resolveReferenceImages(refs)` 를 한 번에 부름 → "하나 못 읽음" 케이스가 빠진 채 IPC 로 가서 빨강.

**M3-12 렌더러 훅·가드·동기화 퇴역** — `tests/utils/refImageGuard.test.js`, `tests/utils/mentionSyncTargets.test.js`, `tests/hooks/useAutomation.flowAngular.test.jsx`, `tests/hooks/useVideoAutomation.flowRejected.test.jsx` / `src/utils/refImageGuard.js`, `src/utils/mentionSyncTargets.js`, `src/hooks/useAutomation.js`, `src/hooks/useVideoAutomation.js`
- 가드: 태그만 걸린 캐릭터 ref(filePath, mediaId 없음) → 제외 **안 됨**(지금은 제외 — 빨강); mediaId 만 있는 ref → 제외.
- 동기화 대상: 미동기화 캐릭터 멘션 → `[]`(지금 `[ref]`).
- `useAutomation` Flow: filePath 만 있는 ref → `submitGeneration` 의 `matchedRefs` 에 포함; 선행 `uploadReference` **미호출**.
- 영상 훅: `flow-references-model-unsupported` 두 번 연속 → 종결(남은 fresh 같은 kind, 제출 2회); `flow-reference-attach-failed` `reason:'chip-mismatch'` 두 번 → 종결 안 함(항목 사유); `reason:'paste-not-observed'` 두 번 → 종결.

**M3-13 로케일·표시** — `tests/locales/flowSessionKeys.test.js`(`PARAMS` 표에 `{model}`·`{max}`), `tests/utils/errorDisplay.test.js` / `src/locales/{ko,en}.js`
- 새 kind 6개 ko/en 문구(D14 표 그대로), 코드 스캔이 찾은 kind 전부 문구 있음; `resolveDisplayError(t,'flow-references-model-unsupported',err,{model:'Veo 3.1 - Quality'})` 렌더 텍스트에 모델명·플레이스홀더 없음; `flow-references-unsupported` 새 문구.

**M3-14 파이프라인 통합** — `tests/electron/flowRpcPipeline.test.js`(확장), `tests/hooks/useAutomation.flowAngularPipeline.test.jsx`(확장), `tests/hooks/useVideoAutomation.flowAngular.test.jsx`(확장)
- main: 실제 캡처 주입(vm+FakeXHR)이 S3#9 요청을 보내면 라우터가 `sentRefs`·`sentMentions` 로 바인딩하고 loadend S3#9 → collect images; 같은 흐름에서 기대를 `[U9]` 로 바꾸면 mismatch. S3#4 `maseQ` → 업로드 gen 완료.
- 렌더러: 태그 ref 가 있는 씬 → 실제 `useFlowEngine`+`useAutomation`+`imageFinalize` → IPC 모킹이 images → 저장·done; 못 읽는 ref → 씬 error `flow-reference-source-missing`, 렌더 텍스트에 문구; 영상 3항목 #2 `flow-references-mismatch`(rejectedMediaId) → #1 다운로드 완료·#3 `flow-batch-halted {cause:'flow-references-mismatch'}`.

**M3-15 정책·배선·minify** — `tests/electron/noUserContentInLogs.test.js`, `tests/electron/mainInputShieldWiring.test.js`, `tests/electron/mainReferenceWiring.test.js`(새), `tests/electron/flow-injections-minified.test.js`, `tests/electron/preloadContract.test.js`(무변경 초록)
- `CONTENT_BEARING`(`noUserContentInLogs.test.js:32-46`)에 `base64|segments|plan|snapshot|mentionLabel|fileName|editorExpected|clip` 추가 후 초록.
- main 배선(줄머리 앵커): `flowAPIDeps` 에 `clipboard`·`nativeImage`·`refMediaCache`(userData 경로)·`pasteIntoFlowView`·`sendMentionTrigger`; 키 `sendInputEvent` 는 main.js 의 `sendMentionTrigger` 안 한 자리뿐이고 허용 키는 `'@'` 뿐; 기존 "Angular 경로엔 키 이벤트 없음" 핀 그대로. `[분기 P4]` 로 insertText 가 되면 `sendMentionTrigger` 와 허용 장치는 만들지 않고 이 핀은 "main.js 에도 키 이벤트 없음".
- 붙여넣기 관찰 주입: 멱등, 리스너가 `defaultPrevented` 를 만들지 않음(뒤에 붙은 리스너가 이벤트를 받는다), minified 평가 동일.
- 새 `*_JS` 전부 minified 번들에서 jsdom 픽스처 결과 동일, 직렬화 헬퍼가 서로를 이름으로 부르지 않음(정적 단언).
- `callFlowRpc('maseQ')`·`('MZZa6b')` → `throws /rpcid not allowed/`.

**M3-16 실기 게이트** — §5.

---

## 5. 수용 게이트

**단위/통합**: `env -u ELECTRON_RUN_AS_NODE npx vitest run` 전체 초록(M3-14·M3-15 포함). 최종 판정은 오케스트레이터.

**실기**(앱은 K3 §4·H2 §3 절차, 새 Flow 프로젝트 1개, 이미지 모델 Nano Banana 2, 업스케일 Off). 시작 전 사용자가 TextEdit 에서 `clipboard-sentinel` 을 복사해 둔다 — 각 게이트 뒤 `pbpaste` 가 그대로여야 한다.

- **G1 레퍼런스 이미지 1장(0크레딧, 첫 사용)** — 캐릭터 태그 ref 1개(로컬 PNG), 멘션 없음.
  `[Flow API] [Angular] generate-image: {promptLen, model, aspectRatio, batchCount, asyncMode, refs:1, mentions:0}` → `ensureAgentOff: already OFF` → `[Flow Settings] image … ok=true` → `[Flow Refs] composer clear chips=0 editorLen=0` → `[Flow Refs] assets scan tab=upload items=<n> cached=0 found=0 missing=1` → `[Flow Upload] ref#0 bytes=<n> sha=<8> formats=<n> restorable=true` → `[Flow Upload] paste observed files=1 target=editor ms=<n>` → `[Flow Upload] clipboard restored` → `[Flow RPC] maseQ send doc=<8> seq=<n> bound=<8>` → `[Flow RPC] maseQ loadend seq=<n> status=200` → `[Flow Upload] ref#0 uploaded media=<8> ms=<n> chip=ok` → `[Flow Refs] cache set media=<8>` → `[Flow Refs] composer clear chips=1→0` → `[Flow Refs] attach ref#0 media=<8> via=add-menu chip=ok` → `[Flow Refs] gate chips=1 mentions=0 text=ok summary=same ok=true` → `[Flow RPC] ogiZ0b send … bound=<8> refs=1 mentions=0` → `[Flow RPC] ogiZ0b loadend … status=200` → `[Flow API] [Angular] refs verified request=1 echo=1` → `[Flow API] [Angular] image …` → `download host=flow-content.google media=<8> bytes=<n>`. 씬 done, 크레딧 0 변화, Flow 업로드 탭 +1.
  변형 G1b(앱 모달로 Flow 뷰 숨김 → `view hidden … in-place shielded`) · G1c(실행 직후 다른 앱으로 포커스) — 같은 결과.
- **G2 인라인 멘션 이미지(0크레딧)** — 프롬프트 `@king 이 정원에서 @queen 과 걷는다`, 두 ref 모두 G1 로 이미 올림. `[Flow Refs] mention ref#0 media=<8> trigger=<key|insertText> ok` ×2 → `gate chips=2 mentions=2 … ok=true` → `ogiZ0b send … refs=2 mentions=2` → `refs verified request=2 echo=2`. 결과 그림을 사용자 눈으로 확인.
- **G3 재사용(0크레딧)** — G1 씬 재생성: `assets scan … cached=1 found=1 missing=0`, **`[Flow Upload]` 줄 0개**, NET_TRACE 의 `maseQ` 0건. (선택 G3b: 사용자가 Flow 에서 그 업로드를 지운 뒤 재생성 → `missing=1` → 재업로드 1회 → `cache set` 새 id.)
- **G4 레퍼런스 영상(크레딧 — 매번 사용자 확인)** — Omni Flash · 4초 · 720p · 9:16, `@king` 1개(7크레딧). `[Flow Video T2V] [Angular] generate-video-t2v: {…, refs:1}` → `credits before=<n>` → `[Flow Settings] video … ok=true` → 컴포즈 로그 → `[Flow RPC] MZZa6b send … refs=1` → `loadend status=200` → `submitted media=<8> creditsLeft=<n-7> modelKey=abra_r2v_4s refs=1/1` → 폴 → `state=3 → complete` → `[Flow VideoDownload] … bytes=<n>`. 크레딧 −7, mp4 720×1280. (선택: Veo 3.1 Fast 8초 20크레딧 — `veo_3_1_r2v_fast_portrait`.)
- **G5 회귀(0크레딧)** — 레퍼런스 없는 이미지 씬인데 사용자가 미리 칩 하나를 손으로 붙여 둔다 → `composer clear chips=1→0` → `ogiZ0b send … refs=0` → 정상. (영상 판은 크레딧이 들어 선택.)
- 전 게이트 공통: 로그에 프롬프트·파일명(`image.png` 포함)·경로·서명 URL·base64 0건; 실패 시 kind 는 D14 표 + `reason` 로그 한 줄.

---

## 6. 미지수 — 틀렸을 때 코드가 하는 일

| # | 미지수 | 확인 | 틀렸을 때 |
|---|---|---|---|
| 1 | 숨김 뷰·비포커스 창에서 `webContents.paste()` | P1 | `paste-not-observed`(클릭 전, 0크레딧) — 영상 배치는 2연속이면 종결, 이미지는 3연속 규칙 |
| 2 | 업로드 중 칩 모양(바쁨 표시) | P1·P8 | 게이트가 바쁜 칩을 거부, 10s 칩 마감 → `chip-mismatch` |
| 3 | `maseQ` 실패 프레임·크기 한계 | P8 | 매핑된 `flow-rpc-error` → `upload-rpc-error`(0크레딧) |
| 4 | 이미지 레퍼런스 상한 | 미확인(앱 상한 없음) | UI 거부 → 게이트 클릭 전, 서버 거부 → 실패 프레임(0크레딧) |
| 5 | 영상 다중 레퍼런스 요청 모양 | 미관측(1개만) | `extractSubmitRefs` 가 목록을 돈다; 모양이 다르면 검증 불가 → 수용+warn(돈은 이미 나감, 클릭 전 칩은 증명됨); 상한 3 |
| 6 | `@` 트리거 방식 | P4 | 안 열리면 `mention-trigger-not-working`(클릭 전) |
| 7 | 멘션 노드 마크업·id 노출 | P3 | id 없으면 게이트는 개수만, 순서는 클릭 뒤 요청이 판정(이미지 0크레딧 거부, 영상은 rejectedMediaId) |
| 8 | 멘션이 칩을 더하나/대체하나 | P3 | "빠진 칩 채우기"가 두 경우를 같은 결과로 만든다 |
| 9 | 지우기 버튼 동작 | P2 | 비우지 못하면 `composer-not-clear`(클릭 전) |
| 10 | 애셋 창 가상화 | P5 | 못 찾음 → 재업로드(0크레딧, 중복 애셋) |
| 11 | 같은 이미지 재업로드의 id | P6 | 어느 쪽이든 캐시가 흡수 |
| 12 | 칩이 설정(모델·모드)을 바꾸나 | P7 | 요약 재확인(D9-6)이 클릭 전에, 모델키 검증이 클릭 뒤에 |
| 13 | 영상 인라인 멘션 모양 | P9(크레딧) | 기본 `'chips'` — 사용자 결정 1 과의 차이를 확인받는다 |
| 14 | Veo Lite/Quality r2v 패널 | 미관측 | 클릭 전 `flow-references-model-unsupported` |
| 15 | mediaId 만 있고 로컬 이미지 없는 ref(옛 채택·옛 업로드) | 사용자 데이터 | M1 제외 토스트로 빠지고 씬은 그 ref 없이 진행(배치) / 단일 씬은 `flow-reference-source-missing` |
| 16 | 클립보드 형식 판별(파일 복사가 표준 형식으로만 보고될 수 있음) | P1d | 판별 못 하면 그 복사는 텍스트로만 복원 — 잔여 위험 |
| 17 | 쓰기~복원 창(≈1s) 사이 사용자가 다른 앱에 붙여넣기 · 클립보드 관리자 기록 | 설계상 잔여 | 레퍼런스 이미지가 그 앱으로 간다(사용자 자신의 이미지) — 문서화 |
| 18 | `JJH6Ub`·`ogiZ0b [1][0][4]`(2/3) 의미 | 무관 | 페이지가 만든다 — 앱은 읽지도 쓰지도 않는다 |
| 19 | 업로드 중 문서 이동 | 코드 경로 | `failBoundUnfinished` 가 `maseQ` gen 을 lost 로 → `upload-lost`, 워치독·`releaseDomStage` 그대로 |
| 20 | 첫 사용 업로드 동안 제자리 뷰포트가 앱을 오래 덮음(업로드당 ~10s) | UX | 기능 영향 없음; 재사용은 짧다. 사용자 눈 확인 항목 |

---

## 7. 범위 밖 — 전부 명시적 실패(fail-closed 유지)

| 것 | kind / 자리 |
|---|---|
| 캐릭터 엔티티(`C4BZMd`·`rzMKMb`)·Ref 탭 캐릭터 생성·엔티티 업로드·동기화 | `flow-feature-unsupported:generate-character`·`reroll-character`·`generate-scene`·`upload-character-entity`(`character.js:435,601,726,1236`) |
| i2v(시작 프레임) | `flow-feature-unsupported:generate-video-i2v`(`video.js:511`) |
| 업스케일(이미지·영상) | `flow-upscale-unsupported`(엔진 `engineFlow.js:183-185`) · `flow-feature-unsupported:upscale-image`(`flow-api.js:2156`)·`upscale-video`(`video.js:945`) |
| 레퍼런스 생성에 스타일 ref 이미지(`purpose:'reference'`) · 배치 스타일 ref 선행 업로드(`useReferenceGeneration.js:152`) | `flow-references-unsupported` |
| 엔진 `uploadReference`(Ref 탭 '동기화') | `flow-references-unsupported`(`engineFlow.js:498`) · `flow-feature-unsupported:upload-reference`(`flow-api.js:1873`) |
| Veo 3.1 Lite/Quality·그 밖의 r2v 모델 | `flow-references-model-unsupported {model}` |
| 파일 대화상자 업로드("미디어 업로드") | 쓰지 않음(파일 입력 없음 — CDP 없이는 불가) |
| webp·gif 변환 | `flow-reference-attach-failed` reason `image-decode-failed` |
| 영상의 태그 기반 레퍼런스(API 모드도 멘션만) | 붙이지 않음(동작 동일) |
| Flow 애셋 이름 변경·업로드 삭제·캐시 UI | — |
| 옛 코드 정리(`sceneMentions` 엔티티 경로·`flow-compose-mention`·`cdp-image-inject`·`flow-page-injection`·동기화 게이트 UI·P2 §11 #18 스킵 스위트) | 후속 |

---

## 8. 리뷰 처분

(리뷰 R1 — 저자와 다른 모델 독립 2인. 표: # · 리뷰어 · 등급 · 처분(수용/수정 수용/기각) · 반영 위치 · 사유)

| # | 리뷰 | 등급 | 처분 | 반영 위치 | 비고 |
|---|---|---|---|---|---|

**사용자 확인 대기**: (1) P9(7크레딧) 실행 여부 — 거절 시 영상 `@멘션` 은 칩 방식(D3-7) (2) 되돌릴 수 없는 클립보드일 때 업로드를 멈추는 정책(D4-c) (3) G4 크레딧.
