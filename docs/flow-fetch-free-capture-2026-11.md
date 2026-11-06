# Flow 씬 이미지: 페이지 네트워크 래퍼 없는 수집

2026-11-07 · 작업 브랜치 `fix/flow-detection-no-page-mutation` · 시작 HEAD `5d1fb7d6`

## 구현과 소유권 판정

기본값은 **일반 텍스트 씬 이미지**의 수동 네트워크 관찰 + 격리 DOM 비교다. `AUTOFLOWCUT_FLOW_RPC_CAPTURE=1`일 때만 기존 RPC 래퍼를 허용한다. 구형 본문 변조는 여기에 `AUTOFLOWCUT_FLOW_LEGACY_MUTATION=1`까지 있어야 한다. 영상·캐릭터·레퍼런스 업로드·업스케일·구형 generate-scene IPC는 기본 정책에서 거부한다. 이미지 payload에 레퍼런스·멘션·고정 seed가 있으면 입력 전에 거부한다.

1. main의 기존 `onBeforeRequest` 관찰과 새 관찰을 **한 리스너**로 합쳤다. callback은 항상 `{}`로 호출하며 요청 바이트·헤더·URL을 바꾸거나 차단하지 않는다. `uploadData.bytes`만 읽고 파일/불명확한 본문을 거부한다. `at`·본문은 저장하지 않는다.
2. 단일 요청의 RPC(`ogiZ0b`), 소유 WebContents, 프로젝트, 정규화 프롬프트, 예상 개수, seed 형태를 확인한다. 요청 시각과 같은 요청 ID의 HTTP 200 완료 시각을 main 메모리에 기록한다. HTTP 200만으로 생성 성공이라고 판단하지 않는다.
3. 설정·프롬프트는 기존 네이티브 입력 경로를 쓴다. 시작 스냅샷, 입력 후 스냅샷, mouseDown 직전 스냅샷의 기존 ID/URL이 같아야 한다. 편집기 텍스트·빈 레퍼런스·Agent OFF도 직전에 재확인한다.
4. 응답 완료 후 기존 ID/URL이 모두 보존되고 새 미디어가 **정확히 기대 개수**인 경우만 받는다. 1.5초 동안 같은 결과 집합이 유지되어야 한다. 응답 직후의 일시적 로딩 DOM은 제한 시간 동안 기다린다. 다운로드 뒤와 뷰포트 복원 뒤에도 소유권을 재확인한다.
5. 결과 ID는 해당 프로젝트 edit-card 또는 이미지 타일 안의 명시적인 ID/이미지 URL에서만 얻는다. edit ID·불투명 asb 토큰은 mediaId로 추측하지 않는다. 갤러리 밖 미리보기와 칩은 제외한다. 기존 빈 카드/타일은 제출 전에 거부하여 늦게 로드된 옛 결과를 배정하지 않는다.
6. 이미지 다운로드는 main의 `net.request`와 해당 Flow 세션 쿠키로 한다. asb 썸네일은 그대로 저장하지 않고 기존 레포의 `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<ID>`로 원본을 요청한다. HTML/비이미지 MIME, 비정상 HTTP 상태, 빈 응답, 32MiB 초과, 30초 초과는 거부한다. 완료·실패·취소 모두 타이머·리스너·버퍼를 정리한다.
7. 배타적 소유권은 설정부터 수집·다운로드·복원까지 유지한다. 비동기 제출도 이 작업이 끝난 뒤 generationId를 반환하고 기존 check/collect 계약으로 완성 이미지를 건넨다. 기존 main 안전 게이트의 생성 간격(기본 60초 + 최대 15초 지터)이 이어서 적용된다.

Electron은 webRequest 이벤트별 마지막 리스너만 사용하므로 기존 리스너를 별도 등록으로 덮지 않았다. 세션 쿠키 옵션과 요청 취소도 공식 문서를 확인했다. [WebRequest](https://www.electronjs.org/docs/latest/api/web-request), [ClientRequest](https://www.electronjs.org/docs/latest/api/client-request).

## 거부·중단 조건

- 중복/다른 탭 생성, 제출 전 생성, 다른 프로젝트·프롬프트·개수·참조, 알 수 없는 RPC/본문, HTTP/네트워크 오류.
- 요청을 관찰하지 못함(15초), 결과가 완성되지 않음(120초), 전체 작업 180초 초과.
- 화면/뷰 변경·렌더러 종료·입력 개입, 사용자 취소, 안전 게이트 중단, 입력 방패를 만들 수 없음.
- 기존 미디어 삭제/변경, 새 결과 과다, ID 중복/충돌/불명확, 갤러리 판독 불가.
- 제출 후 실패는 `postClick`, `retryBlocked`, `safetyStop`으로 반환한다. 관찰기는 불확실 상태를 유지해 다음 생성과 재시도를 차단한다. HTTP 완료나 clear-generations만으로 이를 초기화하지 않는다.

## 증명의 전제와 미확인 부분

이것은 **조건부 상관관계 판정**이며 RPC 응답의 mediaId를 직접 읽은 것과 같지 않다. 이미 완전히 로드된 갤러리에서 같은 프로젝트에 다른 생성·편집이 없다는 전제가 필요하다. 같은 Electron 세션의 경쟁 생성은 관찰하지만 다른 브라우저/기기에서 같은 계정·프로젝트를 수정하는 경우는 증명할 수 없다. 따라서 실제 시험 동안 같은 프로젝트를 다른 곳에서 조작하지 않는다.

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

## 커밋 상태

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
