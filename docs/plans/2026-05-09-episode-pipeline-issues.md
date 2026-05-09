# 2026-05-09 — Episode Pipeline Issues

에피소드 1회차 실행 중 발견된 이슈 4건. 오늘 저녁 작업 대상.

## Priority Matrix

| # | 이슈 | 난이도 | 표면적 | 권장 순서 |
|---|------|--------|--------|-----------|
| 3 | 웨이브별 소요시간 기록 | **S** (~15분) | skill 마크다운만 | **1순위** |
| 4 | 질문 과다 → 수동 모드 신규 스킬 `/story-step` | **S** (~30분) | 신규 1파일 + SKILL.md 1줄 | **2순위** |
| 2 | Ref vs Scene 이미지 생성 속도 차이 | **M** (조사 우선) | `src/hooks/` + `electron/main.js` | **3순위** (오늘은 조사만) |
| 1 | Flow 탭을 ClaudeCode가 읽지 못함 | **L** (~2–3h+) | electron IPC + HTTP API + MCP tool | **다음 세션** |

오늘 저녁 처리: **#3 → #4 → #2 (조사)**.
다음 세션: **#1**.

---

## #3 — 웨이브별 소요시간 기록 (P1)

### 현황
[execute-pipeline.md](skills/story-engine/workflows/execute-pipeline.md):594-660 의 `W_progress.json` 스키마는 `completed_at` 만 있고 `started_at` 이 없음. 종료 시점에서 소요시간을 역산할 근거가 없음.

```json
{
  "status": "done",
  "completed_at": "<ISO-8601>",
  "review_rounds_used": <n>,
  "issues_found": <n>,
  "deliverables": [...]
}
```

### 수정 방향
- `W_progress.json` 스키마에 `started_at`, `duration_seconds` 필드 추가
- 오케스트레이터: 서브에이전트 spawn 직전 `started_at` 기록, 반환 후 `duration_seconds` 계산
- 파이프라인 종료 시점 (W9 직후 or `--summary`)에 `W1..W9` 소요시간 표 출력

### 사용자 요청
> W_progress.json 파일에 기록해 두고, 마지막에 알려줘도 좋아.

→ 마지막 요약 출력 형식 예: `W1 12s | W2 34s | W3 5m20s | ...`

---

## #4 — 질문 과다 (P2)

### 정책 (사용자 합의 — 최종)
**기존 스킬은 그대로 두고, 수동 모드용 신규 스킬 `/story-step` 만 추가.**

| 스킬 | 모드 | 동작 | 변경 |
|------|------|------|------|
| `/story-execute` | 자동 | W{현재}→W9, W3/W7 게이트 유지, 내부 질문 그대로 | 그대로 |
| `/story-next` | 자동 재개 | STATE.md 읽고 → `/story-execute --from W{N}` 위임 | 그대로 |
| **`/story-step`** | **수동 (신규)** | **다음 한 웨이브만** 실행, **내부 질문 전부 자동 기본값**, 종료 후 deliverable 요약 | **신규** |

### 구현
- 신규 파일: `skills/story-engine/workflows/step.md`
  - STATE.md 읽어 다음 웨이브 W{N} 결정
  - 서브에이전트 spawn 시 프롬프트에 **"non-interactive: AskUserQuestion 호출 금지, 모든 결정은 결정적 기본값 사용"** 명시
  - 웨이브 완료 후 deliverable 요약 출력 + **종료 (다음 웨이브로 안 넘어감)**
- [SKILL.md](skills/story-engine/SKILL.md):11 — 스킬 표에 `/story-step` 행 추가
- 기존 wave 문서 (W1/W5/W7/W8): **수정 불필요** (오케스트레이터의 "질문 금지" 지시가 우선)

### 사용 시나리오
- 한 웨이브 끝낼 때마다 결과물 직접 확인 → 만족하면 `/story-step` 재호출, 불만족하면 직접 수정 후 재호출
- 끝까지 한방에 가고 싶으면 `/story-execute` 그대로 사용

---

## #2 — Ref vs Scene 속도 차이 (P3, 오늘은 조사만)

### 의심 지점
- [useReferenceGeneration.js](src/hooks/useReferenceGeneration.js) 에는 다음 단계 존재:
  - 프리셋 썸네일 업로드 (Flow에 사전 업로드)
  - 1–3초 무작위 인터-리퀘스트 딜레이
  - **업스케일 단계** (씬 생성에는 없음으로 추정)
  - mediaId → 파일 저장 후처리
- `useSceneGeneration.js` 는 직접 Flow 호출 → 저장 단순 경로 가능성

### 오늘 저녁 작업
1. 두 훅 코드 직접 비교 (실제 단계 수, polling 간격, 동시성 제한)
2. `electron/main.js`:1207-1244 의 두 트리거 비교
3. 격차 원인 1줄 결론을 이 문서에 기록 (수정은 별도 phase)

---

## #1 — Flow 탭 가시성 (다음 세션)

### 현황
MCP 노출 데이터: `app_status`, `app_get_references`, `app_get_scenes` 만 존재. 모두 요약 데이터.
**미노출**: Flow WebContentsView의 라이브 상태 (현재 탭, 선택된 스타일, 생성 큐, 진행 중인 이미지).

### 작업 추정
- 새 IPC: 메인 → 렌더러 Flow view 상태 캡처
- 새 HTTP endpoint: `GET /api/flow-status`
- 새 MCP tool: `mcp__autoflowcut__app_flow_status`
- 가능하면 스크린샷 옵션도 (Electron `webContents.capturePage()`)

표면적이 크므로 별도 phase로 분리. 오늘 저녁 작업 X.

---

## 작업 순서 (저녁 세션)

1. ✅ 본 문서 작성
2. ⬜ #3 구현 + 커밋
3. ⬜ #4 구현 + 커밋
4. ⬜ #2 조사 + 결론 본 문서에 추가 (수정 없음)
5. ⬜ 본 문서 끝 부분에 작업 결과 요약
