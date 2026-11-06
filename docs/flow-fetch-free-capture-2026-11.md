# Flow 씬 이미지: 페이지 네트워크 래퍼 없는 수집

2026-11-07 · 작업 브랜치 `fix/flow-detection-no-page-mutation` · 시작 HEAD `5d1fb7d6`

## 구현과 소유권 판정

기본값은 **일반 텍스트 씬 이미지**의 수동 네트워크 관찰 + 격리 DOM 비교다. `AUTOFLOWCUT_FLOW_RPC_CAPTURE=1`일 때만 기존 RPC 래퍼를 허용한다. 구형 본문 변조는 여기에 `AUTOFLOWCUT_FLOW_LEGACY_MUTATION=1`까지 있어야 한다. 영상·캐릭터·레퍼런스 업로드·업스케일·구형 generate-scene IPC는 기본 정책에서 거부한다. 이미지 payload에 레퍼런스·멘션·고정 seed가 있으면 입력 전에 거부한다.

1. main의 기존 `onBeforeRequest` 관찰과 새 관찰을 **한 리스너**로 합쳤다. callback은 항상 `{}`로 호출하며 요청 바이트·헤더·URL을 바꾸거나 차단하지 않는다. `uploadData.bytes`만 읽고 파일/불명확한 본문을 거부한다. `at`·본문은 저장하지 않는다.
2. 단일 요청의 RPC(`ogiZ0b`), 소유 WebContents, 프로젝트, 정규화 프롬프트, 예상 개수, seed 형태를 확인한다. 요청 시각과 같은 요청 ID의 HTTP 200 완료 시각을 main 메모리에 기록한다. HTTP 200만으로 생성 성공이라고 판단하지 않는다.
3. 목록 HTTP 완료 뒤 격리 월드에서 ID/URL 집합이 2초간 변하지 않으면 DOM 반영이 안정화된 것으로 판단한다(`createPassiveCapture({ gallerySettleMs })`, 기본 2000ms). 변화·미완성 DOM·다음 목록 요청은 안정화 시간을 다시 시작한다. 설정·프롬프트는 기존 네이티브 입력 경로를 쓴다. 시작 스냅샷, 입력 후 스냅샷, mouseDown 직전 스냅샷의 기존 ID/URL이 같아야 한다. 편집기 텍스트·빈 레퍼런스·Agent OFF도 직전에 재확인한다.
4. 응답 완료 후 기존 ID/URL이 모두 보존되고 새 미디어가 **정확히 기대 개수**인 경우만 받는다. 1.5초 동안 같은 결과 집합이 유지되어야 한다. 응답 직후의 일시적 로딩 DOM은 제한 시간 동안 기다린다. 다운로드 뒤와 뷰포트 복원 뒤에도 소유권을 재확인한다.
5. 결과 ID는 해당 프로젝트 edit-card 또는 이미지 타일 안의 명시적인 ID/이미지 URL에서만 얻는다. edit ID·불투명 asb 토큰은 mediaId로 추측하지 않는다. 갤러리 밖 미리보기와 칩은 제외한다. 기존 빈 카드/타일은 제출 전에 거부하여 늦게 로드된 옛 결과를 배정하지 않는다.
6. 이미지 다운로드는 main의 `net.request`와 해당 Flow 세션 쿠키로 한다. asb 썸네일은 그대로 저장하지 않고 기존 레포의 `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<ID>`로 원본을 요청한다. HTML/비이미지 MIME, 비정상 HTTP 상태, 빈 응답, 32MiB 초과, 30초 초과는 거부한다. 완료·실패·취소 모두 타이머·리스너·버퍼를 정리한다.
7. 배타적 소유권은 설정부터 수집·다운로드·복원까지 유지한다. 비동기 제출도 이 작업이 끝난 뒤 generationId를 반환하고 기존 check/collect 계약으로 완성 이미지를 건넨다. 기존 main 안전 게이트의 생성 간격(기본 60초 + 최대 15초 지터)이 이어서 적용된다.

Electron은 webRequest 이벤트별 마지막 리스너만 사용하므로 기존 리스너를 별도 등록으로 덮지 않았다. 세션 쿠키 옵션과 요청 취소도 공식 문서를 확인했다. [WebRequest](https://www.electronjs.org/docs/latest/api/web-request), [ClientRequest](https://www.electronjs.org/docs/latest/api/client-request).

## 거부·중단 조건

- `Zzl0ze` 목록 조회가 이미 진행 중이면 제출 전에 거부한다. 완료된 초기 목록은 최대 15초 동안 실제 DOM 안정화를 확인한 뒤 기준으로 삼는다. 관찰한 본인 제출 이후 같은 뷰의 목록 재조회는 정상 갱신으로 허용하되, 모든 목록 완료와 안정화까지 결과 확정을 기다린다. 제출 전 새 목록이나 다른 뷰의 목록은 거부한다.
- 격리 월드 995의 `MutationObserver`로 최초 등장 시각과 미완성 카드 구간을 기록한다. 기준에 없던 항목이 기대보다 많거나 최초 시각이 요청 이전이면 거부한다. 처음 보였다 사라진 기존 카드의 재등장, 제출 전에 빈 카드가 생기고 제출 뒤 이미지가 붙는 경우도 거부한다. 같은 밀리초는 순서가 불명확하므로 거부한다. 폴링과 복원 검사는 매번 실제 DOM을 다시 읽어 속성 mutation 없는 `currentSrc` 변경도 확인한다.
- 중복/다른 탭 생성, 제출 전 생성, 다른 프로젝트·프롬프트·개수·참조, 알 수 없는 RPC/본문, HTTP/네트워크 오류.
- 요청을 관찰하지 못함(15초), 결과가 완성되지 않음(120초), 전체 작업 180초 초과.
- 화면/뷰 변경·렌더러 종료·입력 개입, 사용자 취소, 안전 게이트 중단, 입력 방패를 만들 수 없음.
- 기존 미디어 삭제/변경, 새 결과 과다, ID 중복/충돌/불명확, 갤러리 판독 불가.
- 제출 후 실패는 `postClick`, `retryBlocked`, `safetyStop`으로 반환한다. 관찰기는 불확실 상태를 유지해 다음 생성과 재시도를 차단한다. HTTP 완료나 clear-generations만으로 이를 초기화하지 않는다.

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

## 증명의 전제와 미확인 부분

이것은 **조건부 상관관계 판정**이며 RPC 응답의 mediaId를 직접 읽은 것과 같지 않다. 이미 완전히 로드된 갤러리에서 같은 프로젝트에 다른 생성·편집이 없다는 전제가 필요하다. 같은 Electron 세션의 경쟁 생성은 관찰하지만 다른 브라우저/기기에서 같은 계정·프로젝트를 수정하는 경우는 증명할 수 없다. 따라서 실제 시험 동안 같은 프로젝트를 다른 곳에서 조작하지 않는다.

2초 안정화는 서버가 제공하는 렌더 완료 신호가 아니다. 그보다 늦게 나타난 기존 카드가 제출 후 결과와 완전히 같은 관찰 형태를 보이면 DOM만으로 구별할 수 없다. 창 줌에 따른 실제 Flow 반응형 동작도 앱 실행 금지 조건 때문에 실기 확인하지 않았다.

빈 프로젝트, 영상 혼합 갤러리, 가상 스크롤, 명시 ID가 없는 asb 갤러리는 현재 기본 경로가 거부한다. 새 DOM fixture는 과거 기록의 계약을 조합한 것이며 오늘의 실측 덤프가 아니다. 과거 실제 마스킹 batchexecute 본문 파싱은 별도로 테스트했다. 현재 Flow DOM이 그 계약을 만족하는지, 같은 세션의 기존 원본 redirect가 새 Flow 미디어에도 동작하는지는 **실기 미확인**이다. 실패하면 래퍼/API/CDP로 자동 전환하지 않는다.

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
