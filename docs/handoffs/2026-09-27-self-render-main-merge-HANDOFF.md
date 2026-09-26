# main → feature/self-render 병합 — HANDOFF (2026-09-27)

> 사용자 지시: "AutoFlowCut-selfrender 에도 main 에 올라와 있는 commit 들을 병합해줘 — 나중에 다시 main 에 병합하려는 것."
> 규칙: 리뷰는 Opus 5.5 서브에이전트 2명(A 의미 · B 테스트/뮤테이션), **둘 다 findings 0** 뒤 푸시.

## 1. 상태

- 워크트리 `~/workspace/AutoFlowCut-selfrender`, 브랜치 **`feature/self-render`**, origin 푸시(병합 전 origin `a0dc61a1` 에서 fast-forward).
- 전체 스위트 **10009 passed / 3 failed / 55 skipped**, `npm run build` 통과. 실패 3개는 병합 전부터 있던 `tests/integration/render.smoke.test.js`(§4-1).
- selfrender 의 `node_modules` 에 main 이 새로 넣은 `@fal-ai/client` 를 설치했다(`npm install`, 잠금파일은 병합 결과 그대로).

| 커밋 | 내용 |
|---|---|
| `a4182fea` | Merge origin/main(194 커밋, `98a1e48e` 까지) — 충돌 11파일 22덩어리, 해결 내역은 커밋 메시지 · `git show --remerge-diff a4182fea` |
| `6b41d4d9` | 리뷰 A: Upscayl 래치로 배치를 멈출 때도 run scope 취소(main 의 종결 경로 계약) |
| `a4cddbaf` | 리뷰 B: `/api/update` 를 `routeMcpUpdate`(electron/ipc/mcp.js)로 빼 동작 테스트 · 진입 파일 미선언 식별자 게이트 · 게이트가 잡은 DELETE 폴백 버그 수정 · 테스트 공백 3건 |
| `31574726` `a6c0b35a` `3190a530` | 리뷰 B R2–R4: 게이트 강화(깨끗한 Node 전역을 stdin 으로, 선언 없는 대입, 내장 모듈 이름) · DELETE 핀을 스코프 분석으로(테스트만) |

## 2. 충돌 해결 원칙

양쪽 기능을 모두 살렸다. 까다로웠던 셋:
- **MCP update-scene**: self-render 의 `applyMcpSceneUpdate`(Upscayl busy 가드 · 이미지 교체 시 baseline 리셋)에 main 의 stage-pair generation 병합(`mergeSceneGenerationForMcp`, 설정은 `settingsRef`)을 넣었다. IPC 경로와 `dispatchMcpUpdate` 의 executeJavaScript 경로가 모두 이 함수로 간다.
- **`/api/update`**: main 의 화이트리스트 판정(400, 렌더러 무접촉)을 먼저, 통과한 forward 만 self-render 의 `dispatchMcpUpdate`(이미지 교체가 busy 면 409). 지금은 `routeMcpUpdate` 한 함수.
- **Veo 오디오 볼륨(`videoAudioVolume`)**: self-render 가 내보내기 설정을 컨텍스트(`ExportSettingsProvider`)로 옮겨 놓아, main 의 모달 로컬 상태를 그 구조에 맞춰 이식(초기 로드 · persist · export 옵션). 선택은 CapCut 탭에만 보인다.
- 그 밖: startGuard·useAutomation 은 양쪽 코드 병치, `useScenes`·update-scenes 는 main 의 공용 보존 목록 + self-render 의 `upscaledAt` 을 `CSV_PRESERVED_SCENE_FIELDS` 에 추가, main.js import·top-level 블록 합집합.

## 3. 리뷰 루프 — ✅ 둘 다 findings 0

- **A(의미)**: R1 nit 1(Upscayl 래치 종결 경로의 scope 취소 누락) → `6b41d4d9` → R2 0 → 코드가 바뀐 `a4cddbaf` 에서 R3 **0**(옛/새 라우트를 같은 입력 200가지로 대조, DELETE 경로별 대조, 번들 해석 확인). 그 뒤 커밋은 테스트만.
- **B(테스트·뮤테이션)**: R1 70 뮤턴트 · 공백 5(major 1: 합친 `/api/update` 에 동작 핀 없음) → `a4cddbaf` → R2 게이트 공백(워커 전역·선언 없는 대입) → R3 게이트 회귀(`-e` 가 내장 모듈을 전역에 올림 — B 가 R2 의 자기 제안을 정정) → R4 nit(선언 위치) → R5 확인.
- 교훈: 새 게이트도 공허할 수 있다 — 전역 목록의 출처(워커 · `-e` · stdin)마다 가리는 이름이 달랐다. 양성 대조에 **가려질 수 있는 이름의 종류마다** 하나씩 넣었다.

## 4. 병합과 무관 — 원래 있던 문제(사용자 판단 필요)

1. **self-render 가 ffmpeg 9 에서 깨진다**: `render.smoke` 3개가 시스템 ffmpeg(Homebrew 9.0.1)에서 `Unrecognized option 'filter_complex_script'` 로 실패(병합 전 브랜치에서도 같음). 번들 ffmpeg 는 고정이라 당장은 괜찮지만, 9.x 로 올리기 전에 `-/filter_complex <file>` 로 바꿔야 한다.
2. **보안 — `DELETE /api/projects` 경로 이탈**: `name` 을 검증하지 않고 `path.join(workFolder, name)` 을 재귀 삭제한다(`../..` 면 작업 폴더 밖). MCP HTTP 서버(127.0.0.1, 기본 꺼짐)는 인증 없이 `Access-Control-Allow-Origin: *` 에 DELETE 를 허용 → 켜 둔 채 악성 페이지를 열면 브라우저에 따라 도달 가능. **main 에도 같다** — main 핫픽스 권장(이름이 작업 폴더의 직계 자식인지 검증 + CORS 허용 출처 제한).
3. **self-render MP4 는 `videoAudioVolume` 을 안 쓴다**: 렌더는 Veo 오디오를 `VIDEO_GAIN` 1.0 으로 섞는다 — main 이 CapCut 에서 막은 "Veo 가 지어낸 대사가 나레이션 위에 깔림"이 렌더 출력엔 남는다. 옵션을 렌더에도 적용할지 제품 결정.
4. 작은 것들(리뷰 B): before-quit 안의 `localJobsCleanedUp = true` 삭제 등이 테스트로 안 묶임(BQ1–BQ3, self-render 원래 코드) · mcp-server `load_csv` 의 `preserveSceneRuntimeFields` 호출을 실행하는 테스트 없음(MS5) · `tests/.../codexSdk.test.js` 가 없는 export 를 import(base 부터).

## 5. 다음 일

- 이 병합은 끝. self-render 를 main 에 다시 병합할 때: 위 §4-1(ffmpeg 9)·§4-3(렌더 오디오 볼륨) 결정, 실앱 눈검증(self-render 렌더·Upscayl 이 main 의 Flow/API 생성 결과와 같이 도는지).
- §4-2 보안은 main 핫픽스로 별도 진행 권장.
