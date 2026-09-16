# 핸드오프 — Flow 도메인 이전 대응 (2026-09-16)

레포: `~/workspace/AutoFlowCut-bugfix` (worktree, 브랜치 **main**, working tree clean)
상태: **수정 완료·커밋됨(`0bc50ae5`), 미푸시 1커밋. 리뷰 1라운드 미완, 빌드/눈검증 미실시.**

---

## 1. 사건

사용자가 앱(패키징 3.2.2)에서 Flow 를 켜면 저장된 프로젝트 열기가 **무한 반복**됐다.

```
[Flow Project] opening saved flow project: https://labs.google/fx/tools/flow/project/134cf5b5-…
[Flow] initial loadURL failed: ERR_ABORTED (-3) …
[Flow] did-finish-load: https://flow.google.com/project/134cf5b5-…
[Flow Project] open error — retry via home: 134cf5b5-…
[Flow Project] open failed after retry: 134cf5b5-… dead= false https://flow.google.com/project/134cf5b5-…
[Flow Project] opening saved flow project: …      ← 반복
```

## 2. 원인 (curl 로 실측, 301 · redirects=1)

**Google 이 Flow 를 옮겼다.**

| 옛 | 새 |
|---|---|
| `labs.google/fx/tools/flow` | `flow.google.com/` |
| `labs.google/fx/tools/flow/project/<id>` | `flow.google.com/project/<id>` |

앱의 URL 판정이 **`/tools/flow` 경로 세그먼트를 요구**해서, 리다이렉트로 착지한
`flow.google.com/project/<id>` 를 "대상 아님"으로 오판했다. 로그의
`open failed after retry … dead= false https://flow.google.com/project/<맞는 id>` 가 그 증거다 —
**정확히 맞는 URL 위에서 실패라고 보고**하고 있다.

실패로 끝나면 `src/hooks/useProjectData.js` 의 폴링이 mode-entry 를 다시 돌리고,
그게 `openFlowProject` 를 재호출해 무한 루프가 된다.

⚠️ `ERR_ABORTED (-3)` 는 원인이 아니다 — 리다이렉트가 원래 로드를 대체할 때 나는 정상 신호다.

## 3. 고친 것 (`0bc50ae5`)

같은 판정이 **여러 곳에 복제**돼 있던 것이 확산 반경이었다 → 순수 모듈 하나로 모았다.

| 파일 | 변경 |
|---|---|
| `electron/flowUrl.js` | **신규** — `flowBaseFromUrl` / `flowProjectUrl` / `onProjectComposerUrl`. 옛·새 배치 둘 다 인식, 옛 도메인의 로케일 접두어(`labs.google/ko/fx/…`) 보존 |
| `electron/ipc/dom.js` | open 프로브 — **여기가 루프가 난 자리** |
| `electron/ipc/shared.js` | `onProjectComposerUrl` 위임 + base 추출 2곳 + lenient 폴백 |
| `electron/ipc/character.js` · `electron/flow-character-api.js` · `electron/ipc/flow-api.js` | 같은 이전 |
| `electron/flow-media-collect.js` | **같은 원인으로 조용히 죽어 있던 것** — 생성 이미지 edit 카드 href 매칭이 `/tools/flow` 전용이라 새 도메인에서 **수집이 0건**이었다. 이 함수는 `Function.prototype.toString` 으로 페이지에 주입돼 **import 를 못 쓴다** → 두 패턴 인라인 |
| `package-lock.json` | 3.2.1 → 3.2.2 (앞선 버전 범프가 놓쳐 패키징 테스트가 깨져 있었다) |

TDD: `tests/electron/flowUrl.test.js`(11개 신규)와 `flow-media-collect.test.js`의
도메인 이전 케이스 4개를 **실패 상태로 먼저** 작성했다. **전체 7331 / 695 files green.**

## 4. 새 세션이 할 일

1. **리뷰 마무리** — Fable 1라운드를 돌렸으나 세션 종료로 결과를 못 받았다. 다시 돌릴 것.
   물어볼 것: ① 놓친 사이트 없나(`labs.google` / `tools/flow` / `/project/` 전수 grep, 페이지 주입
   스크립트 문자열 포함) ② `onProjectComposerUrl` 이 예전만큼 엄격한가(다른 오리진·`?next=`·
   `/archive/project/`·`<id>-suffix`·비컴포저 하위경로·정규식 메타문자 id) ③ 미디어 수집 인라인
   정규식의 과/소매칭 ④ **다른 실패 모드로 무한 재시도가 여전히 가능한가**(미로그인, 삭제된 프로젝트)
   - ⚠️ **Codex MCP 가 지난 세션에 연결 실패**(`CONNECTION_CLOSED`)라 Codex 리뷰는 못 돌렸다.
     `claude mcp` 로 복구 후 gpt-6-astra 도 같이 돌릴 것.
2. **푸시** — 현재 `origin/main` 보다 1커밋 앞서 있다.
3. **빌드 + 눈검증** — `npm run dist:mac:prod`. 확인할 것:
   - Flow 탭에서 저장된 프로젝트가 **한 번에** 열리고 로그가 반복되지 않는가
   - 이미지 생성 후 **결과가 수집되는가**(이게 조용히 죽어 있었다)
   - 캐릭터 페이지 진입
4. 필요하면 3.2.3 릴리스. 릴리스 노트는 **단문형·명사형 종결**(메모리 `release-notes-terse-noun-ending`).

## 5. 주의

- 이 worktree 는 **다른 세션과 공유**된다. 작업 중 `main` 에 다른 커밋이 들어왔고
  `git stash` 스택에도 남의 WIP 가 있다 — **bare `git stash` / `pop` 금지.**
- `main.js:126` 의 `FLOW_URL` 과 `src/config/defaults.js:33` 의 `flowUrl` 은 **옛 도메인 그대로 뒀다.**
  리다이렉트가 동작하므로 기능엔 문제없고, 바꾸면 세션/인증 경로에 영향이 갈 수 있어 범위 밖으로 뒀다.
  `ERR_ABORTED` 로그 노이즈는 그래서 남는다.
