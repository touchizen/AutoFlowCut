# M3 레퍼런스 캡처 — 2026-09-25 (flow.google.com · batchexecute)

캡처: 워크트리 `AutoFlowCut-bugfix`, 브랜치 `feat/flow-m3-references`(분기점 `f00a2775`), `AUTOFLOWCUT_NET_TRACE=1`(XHR 훅 + webRequest 본문 → JSONL, 원본은 개인 id·토큰 때문에 저장소 밖). 사용자가 Flow 창에서 손으로 조작, 단계마다 `Cmd+Shift+E` DOM 덤프.
마스킹 샘플: `2026-09-25-m3-samples.masked.jsonl`(16건, `step` 필드로 아래 단계와 연결). DOM: `2026-09-25-m3-dom-<단계>.elements.json`(13개, `elements` + 칩 `chipImages`, bodyHtml 제외).
마스킹 규칙은 `scripts/flow-rpc-table.py` 의 `Masker` 와 같다(`<uuid#n>` 같은 값 = 같은 번호, `<b64 N chars>` = reCAPTCHA 토큰 또는 이미지 base64, `<sig>` = CDN 서명, `<at>`). **샘플과 DOM 이 한 마스커를 공유**하므로 번호가 두 파일에서 같다: `<uuid#1>` = 프로젝트, `<uuid#2>` = king.jpg 업로드 미디어, `<uuid#3>` = 붙여넣기(queen) 업로드 미디어.

## 1. 단계

| 단계 | 사용자 동작 | 관측 RPC | DOM 덤프 | 크레딧 |
|---|---|---|---|---|
| a | 컴포저 **＋(프롬프트 상자에 소재 추가)** 클릭 | 목록은 이미 로드된 미디어(`as29s`), 프로젝트 선택기용 `UpteDb` 페이지 조회 | `a-asset-picker-open` | 0 |
| b | 애셋 창 **"미디어 업로드"** → OS 파일 대화상자 → `king.jpg`(1376×768, 1.1MB) → "프롬프트에 추가" | `JJH6Ub` → `recaptcha/enterprise/clr` → **`maseQ`**(9.5s) | `b1-uploaded-in-picker`, `b2-chip-attached` | 0 |
| c | 프롬프트 입력 → 생성(Nano Banana 2, 9:16, x1) | **`ogiZ0b` + 레퍼런스 1**(27s 동기) — 결과가 king 을 닮음(사용자 눈) | `c-after-image-generation` | 0 |
| d | 클립보드에 queen.jpg(osascript) → 편집기 클릭 → **`Cmd+V`** | **`maseQ`**(`image/png`, 이름 `image.png`, 10.3s) — 새 칩 | `d-pasted-chip` | 0 |
| e | 애셋 창 **캐릭터** 탭 | (없음) — 비어 있음 | `e-picker-character-tab` | 0 |
| f | 헤더 **＋(미디어 메뉴 추가)** | — | `f-header-add-menu` | 0 |
| f2 | "캐릭터 만들기" → 프리셋 카드(괴짜) | `eAenfb` → **`C4BZMd`**(엔티티 생성) → `ogiZ0b`(캐릭터 이미지) → **`rzMKMb`**(이미지 참조 비움) | `f2-character-page` | 0 |
| g | 편집기에 **`@`** 입력 | — (애셋 창이 열림) | `g-at-opens-picker` | 0 |
| g2 | `@`→king "프롬프트에 추가" → ＋→queen → 텍스트 → 생성 | **`ogiZ0b` + 레퍼런스 2 + 인라인 멘션**(33s) — "그럭저럭 비슷"(사용자 눈) | `g2-inline-mention-chip`, `g2-two-chips-before-submit` | 0 |
| h1 | 동영상 · **Omni Flash 4초** · 720p · 9:16 · x1, king 칩 | **`MZZa6b`** `abra_r2v_4s` → `jwpduf` 5s 폴(`[2]`→`[3]`, ~40s) → `as29s` | `h1-omni-ref-before-submit` | **−7** (911→904) |
| h2a | Veo 3.1 Fast, **칩 없이**(사용자가 붙이지 않음 — 대조군) | `YhhmEf` `veo_3_1_t2v_fast_portrait` | — | **−20** (904→884) |
| h2b | Veo 3.1 Fast · 9:16 · x1, king 칩(제출 전 덤프로 칩 확인) | **`MZZa6b`** `veo_3_1_r2v_fast_portrait` → 폴 ~45s | `h2b-veo-ref-before-submit` | **−20** (884→864) |

누적 크레딧 911 → 864(−47). 이미지 생성(레퍼런스 유무 무관)은 0.

## 2. 새 rpcid

| rpcid | 용도 | 판정 | 요청(마스킹) | 응답(마스킹) |
|---|---|---|---|---|
| `maseQ` | **이미지 업로드** | 관측 ×2(파일 대화상자·붙여넣기) | `[[null,22,…,"<project>",…,["<reCAPTCHA>",1]], "<base64>", "image/jpeg"\|"image/png", 1, null×4, "<파일명>", null, "<UUID>", "<UUID>"]` | `[[<mediaId>,<project>,<workflowId>,"CAE",null,[[ts],…,<bytes>],[null,[…,"image/jpeg"],[w,h]]], [<workflowId>,null,null,[<파일명>,[ts],null,null,<mediaId>],<project>]]` — 서버는 PNG 도 jpeg 로 저장, 크기는 원본 [w,h] |
| `MZZa6b` | **레퍼런스 영상(r2v) 제출** | 관측 ×2(Omni·Veo) | `[[[[null,null,[[["<prompt>"]]]], [[null,"<refMediaId>"]], "<r2v modelKey>", 1, null, [null×4,"<UUID>","<UUID>"]]], [null,22,…,"<project>",…,["<reCAPTCHA>",1]], ["<UUID>",2]]` | `YhhmEf` 와 **같은 모양**: `[null, <크레딧 잔량>, [[워크플로]], [[미디어 레코드]]]` |
| `JJH6Ub` | 미상(파일 대화상자 업로드 직전 1회) | 관측 | `[14,"google3"]` | `[]` — 붙여넣기 업로드 앞에는 없음 |
| `eAenfb` | 캐릭터 프리셋 → 설명문 생성 | 관측 | `[2]`(프리셋 번호) | `["<생성된 인물 묘사>"]` |
| `C4BZMd` | **캐릭터 엔티티 생성** | 관측 | `[["<project>",null,null,[1,"제목 없는 캐릭터",[]]]]` | `[["<project>","<characterId>",null,[1,"제목 없는 캐릭터",[]],null,null,[ts],[ts]]]` |
| `rzMKMb` | 캐릭터 엔티티 갱신(field mask) | 관측 | `[["<project>","<characterId>",null,[1,null,[[[]]]]],[["entity_info.character_info.image_references"]]]` | 갱신된 엔티티 |

기존 rpcid 의 새 모양:
- `ogiZ0b` 레퍼런스 첨부: `[1][0][2]` = `[["<mediaId>",null,null,null,1], …]`(칩 순서). 레퍼런스 없는 요청은 `[1][0][2]` = `null`(M1·캐릭터 이미지). 같은 요청의 `[1][0][4]` 는 레퍼런스 있을 때 `2`, 없을 때 `3`(샘플 2+2, 의미 미확정).
- `ogiZ0b` 인라인 멘션: 프롬프트 `[1][0][8]` 이 세그먼트 배열 — `[[[null,[["<mediaId>","king.jpg"]]],[" and a queen in a garden"]]]`. 멘션 없는 프롬프트는 `[[["<text>"]]]`. 서버는 멘션을 이미지 설명으로 풀어 프롬프트를 다시 쓴다("Knight riding horse in battle **in first image** and a queen in a garden").
- `ogiZ0b` 캐릭터 이미지: 요청 `[4]` 가 `["<UUID>",null,["<characterId>",[0]]]`(보통은 `["<UUID>"]`) — 엔티티에 묶임.
- `YhhmEf` 는 레퍼런스 없는 영상만(h2a 대조군). **레퍼런스가 있으면 페이지가 `MZZa6b` 로 보낸다** — 같은 Veo 모델도 `veo_3_1_t2v_fast_portrait`(YhhmEf) ↔ `veo_3_1_r2v_fast_portrait`(MZZa6b).

## 3. 레퍼런스·모델 키 위치 (인덱스 경로, payload = `wrb.fr` 의 JSON 문자열을 푼 값)

| RPC | 방향 | 값 | 경로 |
|---|---|---|---|
| `maseQ` | 요청 | reCAPTCHA 토큰 | `[0][10][0]` |
| `maseQ` | 요청 | 이미지 base64 · mime · 파일명 | `[1]` · `[2]` · `[8]` |
| `maseQ` | 응답 | **새 mediaId** | `[0][0]` (= `[1][3][4]`) |
| `maseQ` | 응답 | 저장 크기 [w,h] | `[0][6][2]` |
| `ogiZ0b` | 요청 | 레퍼런스 i 의 mediaId | `[1][0][2][i][0]` |
| `ogiZ0b` | 요청 | 인라인 멘션 mediaId(세그먼트 k) | `[1][0][8][0][k][1][0][0]` |
| `ogiZ0b` | 응답 | 레퍼런스 되돌림(`[null,1,<mediaId>]`) | `[0][0][6][0][15][3][0][i][2]` |
| `MZZa6b` | 요청 | 레퍼런스 i 의 mediaId(`[null,<id>]`) | `[0][0][1][i][1]` |
| `MZZa6b` | 요청 | 모델 키 | `[0][0][2]` (YhhmEf 는 `[0][0][1]`) |
| `MZZa6b` | 응답 | 크레딧 잔량 | `[1]` |
| `MZZa6b` | 응답 | 미디어 id(= generationId) | `[3][0][0]` |
| `MZZa6b` | 응답 | 모델 키 | `[3][0][7][0][12]` (M2 `YhhmEf` 와 같은 자리) · `[3][0][5][6][1][0][0]` |
| `MZZa6b` | 응답 | 레퍼런스 되돌림(`[null,4,<mediaId>]`) | `[3][0][5][6][1][1][i][2]` |

모델 키 옆 원소: t2v `["veo_3_1_t2v_fast_portrait",1,null,null,1,1]` · r2v `["abra_r2v_4s",3,[5],null,1,1]`. 레퍼런스 되돌림의 두 번째 원소는 이미지 `1`, 영상 `4`.

## 4. DOM

| 요소 | 셀렉터 근거(덤프) | 관측 |
|---|---|---|
| 소재 추가 버튼 | `button.add-menu-trigger[aria-label="프롬프트 상자에 소재 추가"]`, 아이콘 `add` → 열림 `close` | 누르면 **애셋 창**(메뉴 아님) |
| 애셋 창 | `input.search-input[aria-label="애셋 검색"]`, `mat-select[aria-label="애셋 정렬"]`, 항목 `button.asset-item[role=option]`(텍스트 = 이름 + "이미지"/"동영상"), 왼쪽 탭 `mat-list-item[role=tab]` 전체·이미지·동영상·음성·캐릭터·아바타·업로드, `button.sidebar-upload-button`("미디어 업로드"), 미리보기 아래 `button.detail-add-to-prompt-btn`("프롬프트에 추가") | 새로 올린 미디어가 맨 위(정렬 "최근") |
| 파일 입력 | **없음** — 모든 덤프에서 `input[type=file]` 0개 | "미디어 업로드" 는 문서 밖 입력으로 OS 대화상자를 여는 것으로 보임 |
| 첨부 칩 | `button.chip-container[aria-label="소재"]`(50×50, 아이콘 `cancel`, `aria-busy="false"`) + 안의 `img[alt="소재 이미지"]` src = `https://flow-content.google/image/<mediaId>?…` | **칩 → mediaId 를 DOM 에서 읽을 수 있다.** 칩이 여럿이면 가로로 나란히(x 198, 252) |
| 인라인 멘션 | 편집기(`div.ProseMirror`) 텍스트에 `king.jpg` 가 들어감 + 같은 미디어 칩 | `@` 는 같은 애셋 창을 여는 단축키. 별도 멘션 목록 없음 |
| 생성 후 | 칩·프롬프트 모두 비워짐, 생성 버튼 `disabled` | 다음 생성마다 레퍼런스를 다시 붙여야 한다 |
| 헤더 ＋ | `button[aria-label="미디어 메뉴 추가"]` → `div.add-menu[role=menu]` 항목 업로드 · 새 컬렉션 · **캐릭터 만들기** · 새로운 장면 | |
| 캐릭터 페이지 | URL `/project/<id>/character`, `button.preset-card` ×6, 컴포저(모델 선택 `🍌 Nano Banana 2`), `업로드` · `프로젝트에서 추가` | 프리셋 누르면 바로 엔티티 생성 + 이미지 생성(0크레딧) |
| 설정 트리거(영상) | 텍스트 `동영상 · 720p · 4초 crop_9_16 x1`(Omni), `동영상 · 720p · 8초 …`(Veo) | M2 와 같음 |

붙여넣기: 앱 메뉴에 `{ role: 'paste' }`(`electron/updater.js`)가 있어 Flow 뷰의 `Cmd+V` 는 포커스된 webContents 의 붙여넣기 명령으로 간다 — 즉 **`webContents.paste()` 와 같은 신뢰 경로로 업로드가 된다는 관측**이다. 크롬은 클립보드 이미지를 `image.png`(PNG)로 넘긴다.

## 5. 설계 입력(관측 사실만 — 결정은 계획서에서)

1. **업로드는 앱이 직접 부를 수 없다**: `maseQ` 요청에 reCAPTCHA 토큰(`[0][10][0]`). 제출과 같이 **페이지 UI 경유**. 경로 후보: (가) 클립보드 이미지 + 편집기 신뢰 붙여넣기 — 관측됨(d), (나) "미디어 업로드" 파일 대화상자 — 문서에 파일 입력이 없어 자동화 경로 미확인.
2. **레퍼런스는 제출 전에도, 후에도 검증할 수 있다**: 제출 전 = 칩 `img` 의 mediaId 집합, 요청 = `[1][0][2]`/`[0][0][1]`, 응답 = 되돌림 목록. 셋 다 기대 집합과 같아야 한다(fail-closed 재료).
3. **레퍼런스 영상은 다른 RPC**(`MZZa6b`)다. 응답 모양·모델 키 자리는 `YhhmEf` 와 같아 폴링(`jwpduf`)·다운로드(`as29s`)·돈 규칙은 그대로 쓸 수 있다. 지금 모델 키 검증은 `_t2v` 세그먼트를 요구하므로 r2v 키가 거부된다(`electron/flow-rpc-protocol.js`).
4. **크레딧은 r2v = t2v**(Omni 4초 7 · Veo Fast 8초 20, 카탈로그 `HTrJv` 값과 일치). 레퍼런스 이미지 생성은 0.
5. 컴포저는 생성마다 비워진다 → 항목마다 레퍼런스를 다시 붙인다. 이미 올린 미디어는 애셋 창에서 골라(`maseQ` 없이) 다시 붙일 수 있다(g2 의 king).
6. 캐릭터 엔티티(`C4BZMd`/`rzMKMb`)는 있지만 레퍼런스 생성에는 필요 없다(칩만으로 c·g2·h1·h2b 성공).

## 6. 아직 모르는 것

- 업로드 중 칩 상태(`aria-busy="true"`?) — 업로드가 끝난 뒤 덤프만 있다. 업로드 실패 프레임·크기/형식 제한.
- 레퍼런스 개수 상한 — 카탈로그 모델 항목 `[9]` 가 Omni r2v `7`, Veo r2v `3`, t2v·i2v 는 `null`(상한 후보, 미확인). 영상 **레퍼런스 2개 이상** 요청 모양 미관측(이미지는 2개 관측).
- 앱 창이 포커스를 잃었거나 Flow 뷰가 숨겨진 상태에서 `webContents.paste()` 가 먹는지(이번 관측은 사용자가 편집기를 클릭한 상태).
- 같은 이미지를 두 번 붙여넣으면 새 mediaId 가 생기는지(중복 업로드) — 한 번만 관측.
- `JJH6Ub`·`ogiZ0b [1][0][4]` 의 의미. i2v(시작 프레임), 업스케일 — 범위 밖.
