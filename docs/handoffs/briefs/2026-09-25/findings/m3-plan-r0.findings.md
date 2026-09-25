# M3 계획 R0 리뷰 — findings 와 처분 (2026-09-25)

리뷰어: **A = Sonnet 5 (설계 vs 증거 축)** · **B = Sonnet 5 (테스트·배선·돈 축)** — 저자(Opus 5.5)와 다른 모델, 사본 분리(`review-m3-plan-A/B`, detached worktree `ddb14b99`). Codex 는 9/27 06:01 까지 주간 한도, Fable 5.1 은 사용량 소진.

| # | 리뷰 | 등급 | 요지 | 처분 | 근거·반영 |
|---|---|---|---|---|---|
| A1 | A | MAJOR | `maseQ`·`MZZa6b` 가 XHR 로 나간다는 것은 추론 — fetch 면 프로덕션 캡처(XHR 프로토타입 래핑)가 못 본다. P1 에서 캡처 채널 자체를 확인하라 | **수정 수용** | 이미 관측: 캡처 샘플 16건은 전부 `source=xhr` 행(`flow-xhr-capture.js` 의 `XMLHttpRequest.prototype` 래핑 — 프로덕션 캡처와 같은 기법)이고 `maseQ`(×2)·`MZZa6b`(×2)의 send·loadend 가 그 훅에 잡혔다. R1 §1-4 에 [관측] 으로 명시. 프로브 추가 없음(실기 G1 이 프로덕션 캡처로 다시 확인) |
| B1 | B | BLOCKER | 배치 경로 `submitGeneration`(`engineFlow.js:400-451`)이 `generateImage` 와 같은 게이트·라우팅·거부를 갖는데 D1·D3·M3-11 이 `generateImage` 만 다룬다 → 배치·MCP 레퍼런스가 계속 거부되거나(삭제 시) ReferenceError | **수용** | 코드 확인(`:424` `flowInputGate`, `:427` `planMentionRouting`, `:434` 거부, `:440` `asyncMode:true`). 단 M3-14 렌더러 통합(실제 `useAutomation`→`submitGeneration`)이 빨갛게 잡았을 것 — "아무것도 못 잡는다"는 과장. R1: D1·D3 에 `submitGeneration` 명시, M3-11 에 `submitGeneration` 전용 단위 테스트(refs·plan·base64 페이로드 + `asyncMode:true`) 추가 |
| B2 | B | MINOR | 클립보드 스냅샷의 `rtf` 가 `CONTENT_BEARING` 에 없다 | **수용** | R1 M3-15 목록에 `rtf` |
| B3 | B | MINOR | r2v 상한을 API 모드 상수 `VIDEO_REFERENCE_IMAGE_LIMIT`(`genModels.js:43`)로 — 무관한 기능과 결합 | **수용** | R1 D13: Flow 전용 상수 `FLOW_R2V_REFERENCE_LIMIT = 3` |

사용자 결정(2026-09-25, R0 §8 "사용자 확인 대기" 해소): **P9 실행(7크레딧)** · **되돌릴 수 없는 클립보드면 업로드 중단(D4-c 그대로)** · **M2 돈 구멍은 M3 에서만 닫는다**(M2 브랜치 소급 없음).
