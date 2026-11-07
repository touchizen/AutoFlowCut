# Flow 씬 이미지: 페이지 네트워크 래퍼 없는 수집

2026-11-07 · 작업 브랜치 `fix/flow-detection-no-page-mutation`

## 현재 구현 — 네이티브 응답으로 소유권 확인

기본 **일반 텍스트 씬 이미지**는 실제 네이티브 요청의 응답에서 결과를 선택한다. 갤러리 차집합·2초 안정화·카드 순서·pending 노드 계보를 소유권 근거로 사용하지 않는다. 기존 R3 expected failure는 지연된 옛 카드 대신 해당 응답의 media ID만 선택하는 일반 회귀 테스트로 바뀌었다. 아래 리뷰 이력의 시간 판정은 과거 구현이다.

1. 설정과 프롬프트는 Electron 네이티브 입력을 사용하고, DOM은 격리 월드에서 읽는다. main의 기존 `webRequest` 리스너 하나에서 원래 요청을 관찰한다. callback은 `{}`이며 요청 본문·URL·헤더를 변경하지 않는다. 프로젝트·프롬프트·개수·seed·소유 WebContents를 확인한다.
2. 클릭 전에 `session.netLog`를 private POSIX FIFO에 연결한다. 요청을 재전송하거나 protocol proxy를 설치하지 않는다. CDP·Flow 디버거·페이지 fetch/XHR 래퍼도 사용하지 않는다. 마지막 비동기 씬 검사 뒤 수집기 준비를 다시 확인하고 네이티브 클릭한다.
3. 관찰한 요청의 HTTP 200 완료 뒤, **full transport URL + POST + 단일 native request source**의 응답 바이트만 복원한다. 중복 START/재요청·redirect·network error·비정상 HTTP·잘못된 byte count/base64·불명확한 encoding을 거부한다. 단일 `ogiZ0b` 성공 프레임과 media UUID·고유성·개수·seed·원문 echo·원본 URL의 ID 경로를 검증한다. HTTP 200만으로 성공을 판단하지 않는다.
4. 검증된 응답의 서명 원본 URL을 해당 Flow 세션의 `net.request`로 내려받는다. 썸네일이나 갤러리 카드에서 결과를 추측하지 않는다. 비이미지 MIME·빈 응답·32MiB 초과·30초 초과·취소·잘린 응답을 거부한다. 씬 배정과 디스크 저장은 기존 finalize 경로를 사용한다.
5. 설정부터 응답 수집·다운로드·뷰 복원까지 배타 소유권을 유지한다. 비동기 submit도 수집이 끝난 뒤 generationId를 반환한다. 네이티브 mouseDown 시점의 로컬 제출 기록과 제출 후 실패 차단을 보존한다. 재시작/CSV 복원 뒤에도 같은 씬을 자동 재제출하지 않는다.

NetLog는 Flow partition만이 아니라 **앱 전체 network service**를 관찰하며 raw 내용에 인증 정보가 포함될 수 있다. raw는 0700 디렉터리의 0600 FIFO와 메모리에서만 취급하고 일반 파일/로그에 저장하지 않는다. Chromium의 raw scratch file을 만드는 `maxFileSize`는 설정하지 않는다. 입력은 32MiB·수명 130초로 제한하며 실패 시 버퍼를 폐기한다. 이 수치는 JSON/string 복사까지 포함한 최대 heap 크기는 아니다. 늦거나 실패한 exporter 종료는 EOF까지 drain하며, writer 종료를 확인할 수 없으면 앱 전역 lease를 유지해 후속 제출을 막는다.

현재 FIFO 수집기는 **POSIX 전용**이다. Windows나 NetLog 사용 불가/다른 수집기 실행 중에는 클릭 전에 거부한다. 갤러리 시간 판정이나 구형 래퍼로 자동 전환하지 않는다. `AUTOFLOWCUT_FLOW_RPC_CAPTURE=1`은 기존 호환 경로를 명시적으로 켜는 별도 옵션이다. 영상·캐릭터·레퍼런스 업로드·업스케일은 이번 일반 이미지 경로의 검증 범위에 포함하지 않는다.

## 실제 근거와 검증 상태

- 11:56:16 KST 네이티브 Flow 직접 생성 1장 성공. 실측 fixture `tests/fixtures/flow-live-lineage-20261107.json`은 pending → 완료의 같은 타일 노드와 media ID를 기록한다. 다만 공개 Flow 클라이언트는 옛 pending 카드도 다시 만들 수 있어 **노드 계보만으로 소유권을 증명하지 않았다.**
- production collector의 네이티브 localhost gzip/br/identity 응답 복원과 동일 URL 중복 요청 거부를 확인했다. 파란 컵은 응답 증명 뒤 기존 downloader의 조기 request-close 처리로 실패했다. 이를 고친 뒤 **13:07:36.208 KST 노란 배 1장**을 앱 엔진으로 제출해 정확한 씬 배정·원본 다운로드·디스크 저장까지 통과했다. media ID `ba9cd385-c98a-49ef-ab5c-fb85e0edc00e`, JPEG 97,368 bytes, 1376×768, SHA-256 `5fc7069fefd54ed4e6cb116be132e5752dfb5a9ccc37e2c1383c2a8604ea0bb`. Flow 타일·앱 썸네일·저장 원본이 같은 노란 배임을 확인했다.
- 최신 전체 회귀 **901개 파일 통과·4개 skip / 10,656개 통과·54 skip·expected failure 0**, exit 0 (`full-final-complete.log`). `render.smoke.test.js`는 기존 main 실패로 제외했다. native request close 선행·end 등록 순서·후속 response error를 RED/GREEN과 실제 Electron localhost로 검증했다. 잘린 응답은 실패하고 close 뒤 오류 guard도 정리된다. viewport 관련 192개, reason 보존 관련 164개, legacy 넓은 화면 156개 및 DOM download 17개도 확인했다.
- 새 감지 경고·로그인·CAPTCHA·Flow RPC 오류가 나타나면 즉시 중단한다. 이번 시험은 새 프로젝트에서 **실제 3장 한도에 도달**했다(사과 1·파란 컵 1·노란 배 1). 1장씩, 실제 제출 간격은 모두 75초 이상이며 새 Flow 감지 경고는 없었다. 사용자 프로젝트를 생성 대상으로 사용하지 않았고 병합/push도 하지 않았다. 추가 생성·오류 재시도를 하지 않는다.

좁은 패널에서 597px 및 줌 후 700px에서도 Agent 칩이 없음을 실측해 최소 자동화 폭을 960px로 올렸다. 합성 fixture의 잘못된 600px 렌더 가정도 고쳤다. **최종 실제 성공은 창 최대화 뒤 물리 Flow 폭 957px/Agent OFF를 확인한 조건**이다. 597px에서 자동 줌만으로 시작한 경로가 실제로 통과했다고 보고하지 않는다. 생성 전 거부는 native 제출 기록과 이미지 RPC가 없었으며 이미지 예산을 소모하지 않았다. 거부 사유는 `errorParams.reason`으로 씬 저장까지 보존한다. 파란 컵의 기존 실패·재제출 차단은 시험 프로젝트에 그대로 남겼다.

증거·실행 로그·리뷰: `/Users/tuxxon/workspace/afc-codex/live/attempt-2/`. 구현 계획: `docs/plans/2026-11-07-flow-native-response-ownership.md`.

공식 API: [NetLog](https://www.electronjs.org/docs/latest/api/net-log), [WebRequest](https://www.electronjs.org/docs/latest/api/web-request), [ClientRequest](https://www.electronjs.org/docs/latest/api/client-request), [IncomingMessage](https://www.electronjs.org/docs/latest/api/incoming-message).

## 이전 리뷰와 진단 이력

아래 기록은 각 시점의 결과를 보존한다. 현재 구현·현재 실제 시험 결과는 위 단락과 최신 실행 보고서를 따른다.

## 1차 리뷰 수정 이력 (2026-11-07, 아래 2차 수정 전 상태)

- 관찰 준비(`prepare`)와 실제 클릭 기록(`dispatch`)을 분리했다. 클릭 헬퍼의 성공/디스패치 결과 또는 실제 관찰 요청만 제출 증거로 취급한다. 마지막 검사 뒤 bounds 변경·타임아웃, 클릭 전 취소·탐색은 과금 가능/영구 차단으로 기록하지 않는다. 취소 직후 헬퍼가 실제 디스패치를 알려주는 경우에는 그 기록을 보존한다.
- 감지는 신규 제출만 중단한다. 완료 결과는 조회·수집·저장하고, 미완료·수집 실패는 생성 ID, 감지 사유, 재시도 차단 상태를 씬에 남긴다. 저장된 미수집 ID는 앱 재시작 후에도 일반 시작·부분 재시도·강제 생성으로 재제출하지 않는다. 사용자 중지는 결과 수집 취소를 유지한다.
- 다운로드 뒤뿐 아니라 뷰포트 정리 뒤에도 갤러리 전체의 기준 ID/URL과 선택 결과 ID/URL/개수를 다시 읽는다. 복원 테스트는 observer를 직접 무효화하지 않고 실제 카드 DOM을 삭제·추가·교체한다.
- 기본 이미지 경로는 창 전체로 뷰를 확대하지 않는다. 입력 방패는 Flow 뷰의 bounds만 덮고 bounds 변경을 따라간다. 중지 버튼은 앱 영역에 남는다. 취소 시 대기 중 DOM 판독과 다운로드도 중단하고 방패/리스너/타이머를 정리한다. 좁은 패널에서 정상 네이티브 클릭을 확인할 수 없으면 제출 전에 거부한다.
- 위 목록 반영 미입증 거부는 `postClick`/`safetyStop`을 만들지 않는다. 다만 실제 제출 없이도 그 관찰 세션에서 생성이 불가능해질 수 있다는 운영상 제한은 남는다. 목록의 DOM 완료 증거를 추가하는 후속 작업이 필요하다.

회귀 재현 및 수정 후 실행 로그는 `.work/review-r1/`에 보관한다. 이번 리뷰 수정에서는 커밋을 시도하지 않았다.

최종 검증: 관련 **34 files / 256 tests 통과**, 전체 **891 files 통과 / 4 skipped, 10,534 tests 통과 / 54 skipped**, exit 0. 전체 명령은 `TMPDIR="$PWD/.work/review-r1/tmp" node node_modules/vitest/vitest.mjs run --configLoader native --maxWorkers 4 --exclude tests/integration/render.smoke.test.js`이며 `full-final.log`에 남겼다. `git diff --check`와 변경 Electron JS 구문 검사 통과. `electron` 전체 및 merge-base `211a7793`부터 worktree까지 Electron 추가 줄의 `debugger.` 검색은 모두 **0건**이다. 앱 실행·실제 Flow 생성·API 모드·커밋·push·병합은 하지 않았다.

## 2차 리뷰 수정 (2026-11-07, 기준 HEAD `05b21a74`)

- 목록 완료 플래그의 영구 차단을 위의 DOM 안정화 판정으로 대체했다. 고정 sleep만 두면 중간 변화를 놓치므로 ID/URL 집합과 관찰 revision을 함께 비교한다. 정상 초기 로드→생성→조회→수집, 생성 직후 정상 재조회, 정확히 3개 수집을 오프라인 통합 테스트로 연결했다.
- 597px에서 Agent 컨트롤을 실제로 제거하는 반응형 fixture로 회귀를 재현했다. Flow의 물리적 패널을 유지하고 Electron 네이티브 줌으로 CSS 뷰포트를 최소 700×600까지 확보한다. 창 전체 확대보다 앱 중지 버튼의 위치·히트 영역을 유지할 수 있어 이 방법을 선택했다. DOM 히트테스트는 CSS 좌표, 네이티브 클릭은 줌을 반영한 좌표를 쓰고 마지막 관문에서 줌 변경을 거부한다. 성공·실패·취소 시 원래 줌을 복원한다. 숨긴 패널이나 0.25 미만의 줌이 필요한 패널은 제출 전에 거부한다.
- 배치·개별·MCP는 `getPreservedFlowSubmissionStop`을 공유한다. `generationId && retryBlocked`는 메모리 차단이 사라진 재시작 뒤에도 유효하며, 개별 편집 스냅샷으로 지울 수 없다. 큐 진입과 실제 실행 직전에도 최신 씬을 확인한다. 명시적 복구로 보존 상태를 해제하기 전에는 새 제출을 보내지 않는다.
- CSV 공통 보존 목록에 `generationId`, `retryBlocked`, `safetyStop`, `reason`, `error`, `errorKind`, `errorParams`를 추가했다. 앱/MCP CSV 재적용→실제 JSON 저장→새 훅 로드→배치·개별·MCP 개별/배치 재시도 차단을 검증한다.
- RED/GREEN·관련·전체 테스트 로그와 결과 JSON은 `.work/review-r2/`에 남긴다. 이 작업은 커밋 없이 변경만 남긴다.

2차 최종 검증: 관련 **70개 파일·605개 통과**, 전체 **893개 파일 통과·4개 skip / 10,567개 테스트 통과·54개 skip**, 실패 0. `render.smoke.test.js`만 제외했다. `TMPDIR="$PWD/.work/review-r2"`와 `--configLoader runner --no-cache --maxWorkers 4`로 실행했다. `debugger.`는 Electron 전체와 브랜치+worktree Electron 추가 줄 모두 0건이다. HEAD는 `05b21a74`로 유지했다.

## 3차 조사·수정 (2026-11-07, 기준 HEAD `627e96c3`)

### 소유권 근거 조사: 선택할 수 있는 근거 없음

| 후보 | 저장된 증거 | 결론 |
|---|---|---|
| 타일·상세 프롬프트 정확 일치 | `tests/fixtures/flow-live-dom-20260714.js:12`, `:18`: 결과 img의 alt는 `Generated image`/`생성된 이미지`, 프롬프트 없음. `docs/handoffs/evidence/2026-09-25-m3-dom-c-after-image-generation.elements.json:546`의 `footer-left` 버튼에는 `King standing in palace hall` 제목이 있지만 타일 계층·media ID가 보존되지 않음. | `2026-09-25-m3-samples.masked.jsonl:3`의 원문은 `A king standing in a palace hall, cinematic lighting`; 짧은 제목은 정확 일치 프롬프트가 아님. `flow-live-dom-download-20261019.js:13`의 제목도 Flow가 붙인 미디어 이름임. |
| 생성 중 placeholder → 결과 노드 계보 | `flow-live-dom-20260924.js:14`, `:17`의 placeholder는 프롬프트 편집기 안내. `flow-live-dom-m3.js:15`의 busy는 업로드 첨부 칩. | 생성 결과 placeholder의 생성·교체 전후 기록이 없음. `flowPassiveImage` 테스트의 pending-result는 합성 시나리오이며 실제 Flow 계보 증거로 사용할 수 없음. |
| data/aria/요청 식별자 | `flow-live-dom-20260714.js:12`: data-tile-id의 UUID = edit 경로 UUID, img name의 media UUID와 다름. `2026-09-25-m3-samples.masked.jsonl:3`: 요청 `[4][0]`의 `<uuid#9>`가 응답 메타데이터에 반복되지만 동시 DOM 덤프에 노출되지 않음. | edit/media 식별자는 결과를 구분하지만 요청과 연결되지 않음. aria는 드래그·메뉴/선택 상태이며 제출 순서나 요청 ID가 아님. 응답 본문 접근을 새로 추가하지 않음. |

`flow-media-collect.js:32`은 img src의 name UUID와 edit 링크만 읽으며 DOM 순서 자체를 제출 순서로 취급한다. `flow-dom-dump.js:17`은 인터랙티브 요소만 평탄화하고 텍스트를 80자로 자른다(`:33`). 실제 M3 기록은 bodyHtml을 제외했다(`docs/handoffs/evidence/2026-09-25-m3-references-capture.md:4`). 따라서 이 기록만으로 전체 갤러리 구조·원문 프롬프트 부재를 단정할 수 없고, 쓸 수 있는 증거를 **확인하지 못한 것**이다. `tests/fixtures/flow-passive-image.js:19`도 실측이 아닌 계약 fixture라고 명시돼 있다.

사용자와 실제 화면에서 확인할 항목(이번 작업에서는 실행하지 않음):

1. 완료 이미지의 타일·상세·프롬프트 재사용 UI에서 **원문 전체**가 읽히는지, 길이·줄바꿈·한국어가 보존되는지와 해당 media/edit ID의 DOM 범위를 기록한다. 자동 제목과 원문을 구별한다.
2. 사용자가 승인한 한 번의 제출에서 기존 카드 전체, 클릭 직전, 생성 중 placeholder, 결과 표시의 DOM을 연속 기록한다. 격리 월드의 WeakMap/MutationObserver로 같은 노드가 유지되는지, 타일이 통째로 교체되는지, 가상 스크롤이 옛 노드를 재사용하는지 확인한다. DOM에 표식 속성을 쓰지 않는다.
3. 요청 `[4][0]` 또는 항목의 요청 UUID가 placeholder/결과의 data/aria에 그대로 나타나는지 비교한다. 지연된 기존 카드·같은 프롬프트의 옛 결과도 함께 대조한다. 복수 근거가 확인되면 AND 조건을 설계한다.
4. 근거가 확인되기 전에는 시간 기반 성공 테스트를 소유권 증명으로 취급하지 않는다. 이후 검증은 1장부터 시작하고, 3장 검증의 제출 간격은 기존 60~75초를 유지한다.

### 제출 기록 보존

- 네이티브 `mouseDown` 직후, 첫 post-click await 전에 `{id, submittedAt, promptHash, postClick, retryBlocked, reason}`를 생성한다. `id`는 로컬 `flow-submit-<UUID>`, 해시는 정규화된 프롬프트의 SHA-256이다. 기록을 실제 서버 generation ID로 취급하지 않는다. 클릭 전 거부는 기록을 만들지 않는다.
- main → **앱 렌더러** IPC를 호출 ID로 묶어 `scene.flowSubmission`에 즉시 반영하고, 반환 결과에도 실어 이벤트/응답 양쪽에서 보존한다. Flow 페이지 메인 월드에는 아무것도 추가하지 않는다.
- 제출 후 다운로드·HTTP·탐색·타임아웃·IPC 예외는 기록/차단/사유를 보존한다. 수집·저장 중 throw, 사용자 Stop 등 결과 객체 없는 실패도 `useScenes`의 공통 patch에서 기존 기록을 유지한다. 성공 finalize만 기록을 `collected`, `retryBlocked:false`로 닫는다.
- 공유 guard는 `generationId`가 없어도 `flowSubmission.id && postClick && retryBlocked`를 차단한다. CSV 공통 보존 목록에 `flowSubmission`, `postClick`을 추가했다. 배치/개별 양쪽의 실제 네이티브 클릭 하네스 → 실제 다운로드 모듈 타임아웃 → 씬 → CSV → 디스크 저장/load → 메모리 latch 초기화 → 새 배치/개별 훅의 4가지 조합으로 검증한다.
- 레코드는 씬 저장 경로를 따른다. main과 앱 렌더러가 저장 전에 동시에 강제 종료되는 상황까지 보장하는 별도 디스크 저널은 추가하지 않았다. 실제 Flow 생성·앱 재시작은 하지 않고 오프라인 훅/IPC 하네스로 재시작을 검증했다.

### 최신 씬 재검사

- 큐 execute는 최신 start 함수를 호출하고 최신 scenes에서 대상을 읽는다. 비동기 준비 뒤 씬별 제출 직전과 엔진의 참조 준비 뒤에도 검사한다. force 초기화도 최신 보존 차단 씬의 상태/오류를 지우지 않는다.
- main의 마지막 DOM 판독이 끝난 뒤, 네이티브 dispatch 직전 마지막 await에서 앱 렌더러에 현재 씬의 존재/보존 차단을 묻는다. main이 만든 check ID와 originating sender가 모두 맞는 응답만 사용한다. 응답 없음·취소·렌더러 오류는 3초 이내에 클릭 전에 거부하고 리스너/타이머를 정리한다.
- 큐 대기 중 MCP update, auth 준비 중 변경, main 준비 중 변경/삭제, 마지막 비동기 갤러리 판독 중 변경을 각각 실패 테스트부터 재현했다. 로그·검증 결과는 `.work/review-r3/`에 남긴다. 커밋하지 않는다.

3차 최종 검증: 관련 **133개 파일 / 일반 통과 1,811개 + expected failure 1개**, 전체 **898개 파일 통과·4개 skip / 일반 통과 10,598개 + expected failure 1개 + skip 54개**, exit 0. expected failure는 미해결 소유권 1번이며 고친 것으로 집계하지 않는다. 전체 명령: `TMPDIR="$PWD/.work/review-r3/tmp" node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache --maxWorkers 4 --exclude tests/integration/render.smoke.test.js`. `debugger.`는 Electron 전체 및 merge-base부터 브랜치·worktree Electron 추가 줄(새 파일 포함) 모두 0건. 변경 Electron 구문 검사·`git diff --check` 통과. HEAD `627e96c3` 유지, 커밋·push·병합·앱 실행·실제 Flow 생성 없음. 상세 기록: `.work/review-r3/report.json`, `full-final.log`, `debugger-audit.json`.

## 증명의 전제와 미확인 부분

이것은 **조건부 상관관계 판정**이며 RPC 응답의 mediaId를 직접 읽은 것과 같지 않다. 이미 완전히 로드된 갤러리에서 같은 프로젝트에 다른 생성·편집이 없다는 전제가 필요하다. 같은 Electron 세션의 경쟁 생성은 관찰하지만 다른 브라우저/기기에서 같은 계정·프로젝트를 수정하는 경우는 증명할 수 없다. 따라서 실제 시험 동안 같은 프로젝트를 다른 곳에서 조작하지 않는다.

2초 안정화는 서버가 제공하는 렌더 완료 신호가 아니다. 그보다 늦게 나타난 기존 카드가 제출 후 결과와 완전히 같은 관찰 형태를 보이면 DOM만으로 구별할 수 없다. 창 줌에 따른 실제 Flow 반응형 동작도 앱 실행 금지 조건 때문에 실기 확인하지 않았다.

빈 프로젝트, 영상 혼합 갤러리, 가상 스크롤, 명시 ID가 없는 asb 갤러리는 현재 기본 경로가 거부한다. 새 DOM fixture는 과거 기록의 계약을 조합한 것이며 오늘의 실측 덤프가 아니다. 과거 실제 마스킹 batchexecute 본문 파싱은 별도로 테스트했다. 현재 Flow DOM이 그 계약을 만족하는지, 같은 세션의 기존 원본 redirect가 새 Flow 미디어에도 동작하는지는 **실기 미확인**이다. 실패하면 래퍼/API/CDP로 자동 전환하지 않는다.

## 2026-11-07 후속: 실제 시험 중단 상태와 진단 준비

직전 실행은 main 앱에서 감지 경고를 확인하고 `~/workspace/afc-codex/live/initial-safety-stop.png`를 저장한 뒤 앱을 정상 종료했다. 해당 실행이 중단되어 이 상태가 최초 인계에 반영되지 않았다. 후속 작업은 브리프의 재시도 금지를 유지하며 **생성 0장**으로 진행했다. 실제 소유권 근거를 새로 확보하지 않았고, 2초 안정화 판정과 기존 expected failure는 그대로다.

`flow-live-dom.js`/`flow-live-diagnostics.js`에 기본 꺼짐인 격리 월드 994 기록기를 추가했다. 명시한 시험 프로젝트 UUID와 절대 저장 경로가 모두 있어야 활성화된다. 노드 계보, data/aria 속성, 텍스트 전환, 요청 UUID 후보와 검증된 이미지 요청 사실을 JSONL로 저장한다. 기존 webRequest 리스너에 관찰을 합성하며 요청·응답·페이지 DOM·메인 월드를 변경하지 않는다. 임의 f.req 원문과 내부 reCAPTCHA 토큰, 폼 at 토큰, 헤더, URL 서명은 저장하지 않는다.

단일 읽기, 탐색 epoch, observerId, 문자·노드·변경 수·파일 크기·실행 시간 제한과 정리를 검증했다. 폴링 사이 transient text/element와 늦은 읽기를 다루지만, 관측 시각이나 로컬 노드 ID가 서버 소유권 증명으로 바뀌는 것은 아니다. 상세 설정과 한계는 `docs/plans/2026-11-07-flow-live-diagnostics.md`에 있다. 모든 신규 DOM은 **합성 fixture**이며 실측 fixture로 제시하지 않는다.

검증: 전체 회귀 검사 **899개 파일 통과·4개 skip / 10,614개 통과·expected failure 1개·54개 skip**, exit 0(`render.smoke` 제외). 이 전체 실행 뒤 추가로 수정한 진단 경계 조건은 최신 관련 **5개 파일 / 112개 통과·expected failure 1개**, exit 0으로 별도 확인했다. 최신 진단 자체는 19개 테스트다. 최종 production 빌드, JS 구문, `git diff --check` 통과. Electron 전체와 브랜치+worktree 추가 줄의 `debugger.`는 0건. 신규 진단 변경 리뷰 findings 0개는 기존 소유권 문제의 해결을 의미하지 않는다. 로그와 리뷰는 `~/workspace/afc-codex/live/`에 남긴다.

## 기본 경로의 메인 월드 조작

| 대상 | 기본 경로 |
|---|---|
| fetch/XHR/Function.prototype.toString 교체 | 0 |
| `__autoflowcut_*` 전역 버퍼·플래그 생성 | 0 |
| RPC/legacy/settings-dumper/net-trace 설치 | 0 |
| preload electronAPI 메인 전역 노출 | 0 |
| 세션·갤러리·설정·편집기·클릭 좌표·클릭 실패 진단 판독 | 격리 월드 |
| 페이지 fetch/XHR로 다운로드 또는 준비 확인 | 0 |
| 입력/포커스/선택/클릭 | main의 네이티브 API; 정상 UI 변화는 발생 |

다른 호환 기능의 구현 코드는 제거하지 않았다. 기본 IPC 정책과 플래그가 그 진입을 막는다. 수집된 이미지 바이트는 기존 렌더러 저장 경로로 전달한다.

## 검증 기록

- 명령: `TMPDIR="$PWD/.work/flow-fetch-free" npm run test:run -- --configLoader runner --exclude tests/integration/render.smoke.test.js`
- 기본 config bundler는 공유 node_modules의 `.vite-temp` 쓰기 권한이 없어 실행되지 않았다. runner 로더로 공유 디렉터리 변경 없이 실행했다.
- 변경 전: 884 files passed / 4 skipped; **10,431 tests passed / 54 skipped**.
- 첫 전체 회귀: 새 오류의 en/ko 키 누락 2개 실패를 확인하고 수정했다.
- 변경 후 최종: **889 files passed / 4 skipped; 10,501 tests passed / 54 skipped**, exit 0 (81.82초). 통과 테스트 **70개 증가**.
- 격리 클릭 판독 추가 때 호환 경로 진단 Promise의 타이밍 회귀 1개를 재현하고, 기존 Promise를 그대로 반환하도록 수정했다. 관련 57개 테스트와 위 최종 전체 실행이 통과했다.
- `git diff --check` 및 변경 JS 구문 검사가 통과했다. merge-base `211a7793`부터 현재 worktree까지 electron 추가 줄(신규 파일 포함)의 `debugger.` 검색 결과 **0건**. 증거: `.work/flow-fetch-free/debugger-audit.txt`, 전체 로그: `.work/flow-fetch-free/full-final.log`.
- RED→GREEN 로그: ownership/gallery, download, image integration, policy/network, isolated clicks/restore race, incomplete cards, post-response render delay. `.work/flow-fetch-free/`에 보관한다.
- `tests/integration/render.smoke.test.js`는 브리프가 알려준 시스템 ffmpeg 9.0.1의 main 기존 실패 3개라 전후 모두 제외했다. 이번 작업에서는 그 원인을 재현하거나 수정하지 않았다.
- 앱 실행/재시작, 실제 Flow 생성 요청, CDP, API 모드, push, main 병합은 수행하지 않았다. 모든 작업 결과/로그는 이 worktree 안에 있다.

## 최초 구현 당시 커밋 상태 (이력)

첫 단계 `git add`에서 `.git/worktrees/autoflowcut-flow-detection/index.lock` 생성이 `Operation not permitted`로 거부됐다. 현재 샌드박스는 승격도 허용하지 않아 새 커밋은 **0개**다. HEAD는 `5d1fb7d6` 그대로다. 변경과 테스트·보고서는 worktree에 보존한다. 권한 복구 후 권장 커밋 구분:

1. `feat(flow): observe image requests and validate gallery ownership`
2. `feat(flow): default scene images to passive capture and session downloads`
3. `docs(flow): record capture limits and offline verification`

## 사용자와 할 실제 시험

이 턴에서는 실행하지 않았다. 사용자가 검토한 변경을 별도로 적용한 뒤:

1. 기존 이미지가 완전히 로드된 프로젝트에서 다른 브라우저/기기 조작을 중단한다. 레퍼런스·Agent·고정 seed·업스케일 없이 씬 **1장**을 시험한다. 실패가 제출 전인지 뒤인지, 생성 클릭이 1회인지, 요청 프롬프트/개수가 맞는지, 새 ID가 1개인지, 기존 결과를 가져오지 않았는지 확인한다.
2. 저장된 파일을 열어 이미지 내용·원본 해상도·mediaId를 Flow 갤러리와 대조한다. asb 원본 redirect가 실제 이미지로 응답하는지도 확인한다. 감지 문구·ID 미확인·다운로드 실패면 추가 생성 없이 중단한다.
3. 1장 시험이 통과하면 서로 다른 프롬프트의 씬 **3장**을 차례로 생성한다. 제출 사이 **60~75초 이상** 간격(기존 main 게이트는 완료 뒤에도 간격을 두므로 실제 간격은 더 길 수 있음), 매번 요청 1회·정확한 ID 차이·올바른 씬 저장·기존 이미지 보존을 확인한다.
4. 취소/화면 이동·관찰 불일치가 생기면 이후 생성이 멈추는지 확인한다. 실패를 자동 재시도하지 않는다. 유료 중복 생성은 일부러 일으키지 않는다.
