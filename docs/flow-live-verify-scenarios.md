# Flow Live-Verify 시나리오 (A그룹 deferred 항목)

> 이 항목들은 실제 Flow 웹 세션을 띄워야 검증 가능해서 코드 리뷰 루프에서 보류됨.
> 아래는 **현재(미수정) 동작이 버그인지 직접 확인**하는 수동 테스트. 각 시나리오는
> "버그 재현 → 관찰 포인트 → PASS/FAIL 기준" 순서. FAIL(=버그 확인)이면 그 정보로 정식 수정.

## 0. 공통 준비

- 앱 실행 후 **Flow 모드**로 전환 (Header의 모드 토글). Flow WebContentsView가 붙고
  labs.google 로그인 세션이 떠야 함.
- **DevTools 콘솔** 열어두기 (메인 프로세스 로그는 터미널, 렌더러/페이지 로그는 DevTools).
  - 페이지 자동화 로그: `[Flow ...]`, `[Flow Video ...]`, `[Flow Scene ...]` prefix.
- Flow 프로젝트가 하나 바인딩된 상태(생성 가능)인지 확인.
- 비교용으로 **API 모드(BYOK)** 에서 같은 시나리오를 돌려 "정상 동작 기준선"을 잡으면 판정이 쉬움.

---

## A-1. Flow video model 실제 적용 (R26-4b)

**가설(버그):** 앱에서 고른 Flow video 모델이 실제 생성에 안 쓰이고 Flow web-UI 기본 모델이 쓰임.
(메타데이터에는 R26에서 사용자가 고른 모델 id가 기록되도록 고쳐둠 — 즉 메타 ≠ 실제일 수 있음)

**절차**
1. Flow 모드, 비디오 탭.
2. 모델 드롭다운에서 **기본이 아닌 모델** 선택 (예: `Veo 3.1 I2V Quality` = `veo_3_1_i2v_s_quality_fl`).
3. F2V/T2V 한 줄 생성 시작.
4. 생성 직전~중에 Flow 페이지(WebContentsView)의 **컴포저 하단 모델 칩**을 본다.

**관찰**
- Flow 컴포저에 실제로 선택된 모델 칩이 내가 고른 것과 같은가?
- (참고) `electron/ipc/shared.js`의 `configureFlowMode`는 mode/batch만 설정하고 **model은 안 건드림** → 칩이 Flow 기본값일 것으로 예상.

**PASS/FAIL**
- PASS = Flow 칩이 내가 고른 모델과 일치 (버그 아님 → 항목 닫기)
- FAIL = Flow 칩이 기본값(앱 선택 무시) → 버그 확인. 수정 방향: `configureFlowMode`에 model 선택 추가.

---

## A-2. Flow @mention 씬의 seed / aspect / batch 적용 (R29-4)

**가설(버그):** `flow:generate-scene` 핸들러가 prompt/segments만 받고 seed/aspect/batchCount를 버림.

**절차**
1. Flow 모드. 캐릭터 레퍼런스 1개 등록(이미지 업로드 + 이름 `hero`).
2. 설정에서 **seed 고정**(예: 12345) + **aspect 9:16** + **batch count 2**.
3. 프롬프트에 `@hero ...`가 들어간 씬을 만들어 이미지 생성.

**관찰**
- 결과 이미지 **개수**가 2장인가? (batch 반영?)
- 결과 **종횡비**가 9:16인가? (aspect 반영?)
- 같은 seed로 다시 돌리면 **동일/유사 결과**인가? (seed 반영?)
- 비교: API 모드에서 같은 설정 → 정상 반영되는지 기준선.

**PASS/FAIL**
- FAIL(예상) = batch 1장 / aspect 기본 / seed 무시 → 버그. 수정: generate-scene에 inject arming(setFlowPageInject + configureFlowMode) 추가 + `clickAndCaptureGeneration` expectedCount=batchCount.

---

## A-3. 멀티 비디오 연속 제출 시 컴포저 idle 대기 (SUBMIT_PROBE, R29-5)

**가설(버그):** 이미지 경로엔 "컴포저가 idle(arrow_forward)일 때까지 대기"하는 SUBMIT_PROBE가 있는데
비디오 경로엔 없음 → 직전 생성이 아직 도는 동안 다음 영상 제출이 busy 컴포저에 부딪혀 실패.

**절차**
1. Flow 모드, 비디오 탭.
2. **여러 줄(예: 4~6개)** 의 T2V/F2V를 한 번에 생성(배치).
3. 생성이 슬라이딩 윈도우로 연속 제출되는 동안 관찰.

**관찰**
- 일부 줄이 `submit failed` / `Agent not ready` 류 에러로 떨어지는가?
- 메인 로그에서 비디오 제출 직전 컴포저 상태(stop/busy) 확인.
- 비교: 이미지 배치(레퍼런스/씬 다수)는 SUBMIT_PROBE 덕에 안 깨지는지.

**PASS/FAIL**
- FAIL = 멀티 비디오에서 간헐적 제출 실패 → 버그. 수정: 비디오 제출 전 이미지 경로의 SUBMIT_PROBE(`flow-submit-gate.js`)와 동일 대기 추가.

---

## A-4. 비디오 다운로드 해상도 선택 (직접 URL 우회, R29-2)

**가설(버그):** 상태 응답이 직접 URL(fife)을 주면 `flowDownloadVideoUrl`이 해상도 인자를 무시 →
1080p/4K를 골라도 기본(보통 720p)으로 받음. (해상도 선택은 DOM/mediaId 업스케일 경로에서만 동작)

**절차**
1. Flow 모드에서 비디오 1개 생성 완료.
2. 다운로드 해상도를 **1080p 또는 4K**로 선택해 저장.
3. 저장된 파일의 **실제 해상도**를 확인(파일 속성 / `ffprobe`).

**관찰**
- 받은 파일 해상도가 선택값과 같은가, 아니면 720p인가?
- 로그에서 다운로드 경로가 `flowDownloadVideoUrl`(URL) 였는지 `flowDomDownloadVideo`(mediaId) 였는지.

**PASS/FAIL**
- FAIL = 1080p/4K 선택해도 720p로 받음 → 버그. 수정: 비-기본 해상도 요청 시 mediaId(DOM 업스케일) 경로 우선.

---

## A-5. Flow video aspect / duration 적용 (R33-1)

**가설(버그):** 비디오 T2V/I2V 제출 시 inject가 seed만 넣고 aspectRatio:null → 사용자가 고른
종횡비/길이가 Flow 기본값으로 무시됨.

**절차**
1. Flow 모드, 비디오 탭. **aspect 9:16 + duration 6초**(또는 다른 비-기본값) 설정.
2. T2V/I2V 1개 생성.
3. 생성된 영상의 **종횡비 / 길이** 확인.

**관찰**
- 출력 영상 종횡비가 9:16인가? 길이가 6초인가? 아니면 Flow 기본(16:9 / 기본 길이)?
- 비교: API(Veo) 모드는 aspect/duration 반영됨 → 기준선.

**PASS/FAIL**
- FAIL = 종횡비/길이 무시 → 버그. 수정: 비디오 inject/`configureFlowMode`에 aspect/duration 반영(A-2와 같은 inject 메커니즘).

---

## A-6. 단일 씬 @mention 캐릭터 on-demand 등록 (R30-2)

**가설(버그):** 배치 생성은 @mention 캐릭터 ref를 자동 Flow 등록(entityId 확보)하는데,
**단일 씬 재생성**은 그 과정이 없어서 `Unresolved @mention` 으로 실패.

**절차**
1. Flow 모드. 캐릭터 ref `hero` 업로드(아직 미등록 상태 — 배치 한 번도 안 돌린 상태).
2. 어떤 씬에 `@hero`를 넣고 **그 씬만 단일 재생성** 버튼 클릭.
3. 따로: **배치(전체) 생성**으로 같은 `@hero` 씬을 생성해 비교.

**관찰**
- 단일 재생성 → `Unresolved @mention(s): hero` 에러로 막히는가?
- 배치 생성 → 정상으로 @hero가 들어가는가?

**PASS/FAIL**
- FAIL = 단일은 실패 / 배치는 성공 → 버그(불일치). 수정: 단일 경로에 배치(`useAutomation`)의 on-demand 등록 로직 미러.

---

## A-7. @mention 씬에서 style/reference 이미지 적용 (R30-3)

**가설(버그):** 씬에 `@character` 멘션 + style 레퍼런스가 둘 다 있을 때, Flow의 mention 경로가
referenceImages를 안 넘겨서 **style 이미지가 무시**됨. (멘션 없는 일반 생성은 넘김)

**절차**
1. Flow 모드. 캐릭터 ref + **style ref**(스타일 카드) 둘 다 준비.
2. `@character`가 들어가고 + 그 style이 적용되도록 씬 구성 → 생성.
3. 비교: 같은 씬을 **@mention 없이** style만 적용해 생성.

**관찰**
- @mention 있는 결과에 style이 반영됐는가? (없는 경우와 비교해 스타일 차이가 있나)

**PASS/FAIL**
- FAIL = @mention 씬에서 style 이미지가 무시됨 → 버그. 수정: `engineFlow.generateImage`의 hasMention 분기에서 `flowGenerateScene(...)`에 referenceImages 전달 + 핸들러(A-2와 묶음)에서 사용.

---

## 판정 기록 템플릿

| ID | 항목 | 결과(PASS/FAIL) | 관찰 메모 |
|----|------|------------------|-----------|
| A-1 | video model 적용 | | |
| A-2 | scene seed/aspect/batch | | |
| A-3 | video SUBMIT_PROBE | | |
| A-4 | 다운로드 해상도 | | |
| A-5 | video aspect/duration | | |
| A-6 | 단일 씬 @mention 등록 | | |
| A-7 | @mention + style ref | | |

> FAIL 난 항목 + 관찰 메모를 주면, 그 live 동작을 근거로 정식 수정(테스트 포함)을 진행함.
> 참고: A-2/A-5/A-7은 같은 "Flow inject 메커니즘"을 공유 → 한 번에 묶어 고치는 게 효율적.
