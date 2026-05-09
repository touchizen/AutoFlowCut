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

### 조사 결과 (2026-05-09)

**파일 크기로 본 비대칭**: [useReferenceGeneration.js](src/hooks/useReferenceGeneration.js) **481줄** vs [useSceneGeneration.js](src/hooks/useSceneGeneration.js) **106줄**. 4.5배 차이.

**배치 경로 (apples-to-apples)**:
- Reference 배치: [_executeBatchRefs](src/hooks/useReferenceGeneration.js):264-438
- Scene 배치: [useAutomation.js](src/hooks/useAutomation.js):130+

**같은 부분** (속도차 원인 아님):
| 항목 | 값 |
|------|-----|
| Inter-submit delay | 7~15초 무작위 (양쪽 모두) |
| 폴링 간격 | 3초 (양쪽 모두) |
| 폴링 타임아웃 | 180초 (양쪽 모두) |
| 생성 API 자체 | `submitGenerationDOM` 동일 |

**다른 부분** (= 속도차의 원인):

| 단계 | Reference | Scene |
|------|-----------|-------|
| 스타일 prep (`_prepareStyleRefs`) | 첫 호출 시 preset 썸네일 추출 + `flowAPI.uploadReference` (캐시 후 1회) | `resolveSceneStyle` 단순 문자열 결합 |
| **결과 후처리: `flowAPI.uploadReference` 라운드트립** ([line 108](src/hooks/useReferenceGeneration.js):108) | **YES — 이미지마다** | NO |
| **결과 후처리: `saveExtraToHistory`** ([line 163](src/hooks/useReferenceGeneration.js):163) | **YES — 이미지마다** | NO |
| 업스케일 (`tryUpscaleImage`) | YES (line 96) | YES (단일은 `finalizeGeneratedImage` 내부) — 사실상 동일 |
| disk 저장 | YES | YES — 동일 |

### 한 줄 결론

> **Reference 가 느린 핵심 원인 = 생성된 이미지마다 `flowAPI.uploadReference` 로 Flow 에 다시 업로드해서 `mediaId` + `caption` 을 받는 라운드트립 + `saveExtraToHistory` 추가 디스크 I/O. 둘 다 Scene 경로엔 없음.**

**왜 제거 불가 (구조적):**
- `mediaId` 는 후속 씬 생성 시 `matchedRefs` 의 입력으로 쓰임 → reference 가 reference 로서 기능하려면 Flow 측 식별자가 필요.
- 즉 Reference 는 "한 번 생성해서 끝" 이 아니라 "생성 → Flow 에 등록 → 향후 재사용 준비" 까지가 한 사이클.

### 개선 가능 지점 (별도 phase)

1. **`uploadReference` 병렬화** — 현재 후처리는 sequential. Phase 2 폴링 중 완료된 이미지를 발견하면 즉시 다음 결과 폴링하면서 백그라운드로 uploadReference 병렬 실행 가능.
2. **`saveExtraToHistory` 동기 → 비동기** — disk write 가 다음 결과 처리를 막을 이유 없음. fire-and-forget 으로 풀면 사용자 체감 속도 개선.
3. **첫 호출 preset 썸네일 prefetch** — 첫 ref 시점이 아니라 앱 시작 시 캐시 채우면 첫 ref 만의 추가 지연 제거.

세 가지 모두 코드 변경 필요 — 오늘 저녁 범위는 아님. 별도 phase 로 분리.

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
2. ✅ #3 구현 + 커밋 — `d65a714 feat(story-engine): track per-wave timing in W_progress.json`
3. ✅ #4 구현 + 커밋 — `8f9db77 feat(story-engine): add /story-step skill for manual single-wave runs`
4. ✅ #2 조사 + 결론 본 문서에 추가 (수정 없음) — 위 #2 섹션 "조사 결과" 참조
5. ✅ 본 문서 끝 부분에 작업 결과 요약 (아래)

---

## 세션 결과 요약 (2026-05-09 저녁)

**완료된 작업 3건:**

| # | 결과물 | 커밋 |
|---|--------|------|
| 3 | `W_progress.json` 에 `started_at` + `duration_seconds` 추가, 파이프라인 종료 시 웨이브별 시간 표 출력 | `d65a714` |
| 4 | 신규 스킬 `/story-step` — 한 웨이브씩 실행, 내부 질문 없음, 사용자가 결과물 보고 다음 호출 결정 | `8f9db77` |
| 2 | 조사만 — 한 줄 결론 위 #2 섹션에 기록. 개선 가능 지점 3개 식별, 별도 phase 로 분리 | (커밋 없음) |

**다음 세션으로 이월:**
- **#1**: Flow 탭 가시성 (MCP tool 신설 — 새 IPC + HTTP endpoint + tool wrapper)
- **#2 개선**: `uploadReference` 병렬화 / `saveExtraToHistory` 비동기화 / preset 썸네일 prefetch (3가지 — 코드 변경 필요)

**스킬 사용법 변화:**
- 자동 한방에 가고 싶으면: `/story-execute` (그대로)
- 한 웨이브씩 보면서 가고 싶으면: **`/story-step`** (신규)
- 중단 후 자동 재개: `/story-next` (그대로)

**메타데이터 업데이트:**
- `skills/story-engine/metadata.json` 버전 `2.2.0` → `2.3.0`
- `dependencies` 에 `story-step` 추가
