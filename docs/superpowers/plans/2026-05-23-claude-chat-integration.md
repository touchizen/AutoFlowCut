# Phase Plan — Claude Chat Window Integration

**Status**: planned (not started)
**Estimated effort**: ~12~16 시간 (MVP: 채팅창 + SDK 연동 + 사용량 트래커)
**Risk level**: Medium — 외부 API 의존, 월 크레딧 한도 관리 필요
**Target start**: 2026-06-15 이후 (Anthropic 새 billing 정책 발효 시점)

---

## Motivation

### 왜 지금인가

2026-06-15부터 Anthropic이 Claude 구독 billing을 분리:

- **인터랙티브 사용** (claude.ai, Claude Code CLI 인터랙티브) → 기존 구독 한도 유지
- **프로그래매틱 사용** (Agent SDK, `claude -p`, third-party 앱) → **별도 월별 크레딧 풀**

| 플랜 | 월 프로그래매틱 크레딧 |
|---|---|
| Pro ($20) | $20/월 |
| **Max 5x ($100)** | **$100/월** ← 현재 사용 중 |
| Max 20x ($200) | $200/월 |

핵심: **크레딧은 매월 자동 충전되고 이월 안 됨**. 안 쓰면 사라짐.
→ AutoFlowCut에 Claude 채팅창을 통합하면 **$100/월을 매월 알뜰하게 활용** 가능.

### 왜 AutoFlowCut에 채팅창인가

현재 AutoFlowCut 워크플로우:
- 씬/레퍼런스 프롬프트 작성 → Flow 생성 → CapCut 내보내기

병목 지점:
- 프롬프트 작성·튜닝 시 외부 LLM 도구로 컨텍스트 스위칭
- 씬 메타데이터, 스타일, 레퍼런스 정보를 매번 복붙
- "이 씬을 더 자연스럽게 다시 써줘", "이 씬에 어울리는 SFX 추천" 같은 도메인 질의를 앱 안에서 못 함

채팅창이 앱 안에 있으면:
- 현재 프로젝트 컨텍스트(씬, 스타일, 레퍼런스)를 자동 주입
- 결과를 바로 CSV/씬에 적용 가능 (액션 버튼)
- 워크플로우 단절 없음

---

## Goals / Non-goals

### Goals (MVP)
- Electron 사이드 패널에 채팅창 (열기/닫기 토글)
- Anthropic SDK 직접 연동 (Sonnet 4.6 기본, Haiku 4.5 선택)
- 프로젝트 컨텍스트 자동 주입 (현재 프로젝트, 선택된 씬, 스타일)
- 프롬프트 캐싱 적극 활용 (시스템 프롬프트, 컨텍스트 캐시)
- 월별 사용량 트래커 (토큰/달러 환산, 80%/95% 임계치 알림)
- API key 안전한 로드 (`~/.anthropic/credentials` 또는 env var, 소스 평문 금지)

### Non-goals (MVP에서 제외)
- 멀티 세션 관리 (단일 활성 세션부터)
- 채팅 히스토리 영구 저장 (in-memory 우선, 페이즈 2에서 SQLite)
- 음성 입출력
- 이미지 첨부 (페이즈 2)
- Tool use / function calling (페이즈 2, "씬에 적용" 같은 액션은 manual 버튼으로 시작)
- 사용자별 다중 API key (혼자 쓰는 도구 전제)

---

## Architecture

### 데이터 흐름

```
[Chat Panel UI (React)]
        ↓ user message
[Chat Service (renderer)]
        ↓ IPC
[Main Process Anthropic Client]
        ↓ HTTPS
[Anthropic API]
        ↓ stream
[Main → Renderer (IPC stream)]
        ↓
[Chat Panel UI (assistant message)]
```

### 핵심 결정 사항

1. **호출은 main process에서** — renderer에서 직접 API 호출하면 API key가 빌드 번들에 노출 위험. main process에서 호출하고 IPC로 결과 스트리밍.

2. **`@anthropic-ai/sdk` 사용** — `claude -p` subprocess 대신 SDK 직접 호출. 6월 15일 이후 둘 다 같은 크레딧 풀이라 비용 동일, SDK 쪽이 통합 깔끔.

3. **컨텍스트 주입은 시스템 프롬프트 + 캐시 활용**
   - 정적 부분 (앱 설명, 사용 가능 액션, 도메인 용어) → 캐시 적중
   - 동적 부분 (현재 선택된 씬, 최근 편집 내용) → 매 요청 갱신
   - 예상 캐시 적중률 80%+, 비용 50~70% 절감

4. **사용량 트래커는 SQLite (`~/.autoflowcut/usage.db`)** — Anthropic API response의 `usage` 필드 (input/output/cache 토큰) 기록. 월별 집계.

---

## Phases

### Phase 1: API Key 로드 + 사용량 트래킹 토대 (~3시간)

- `src/services/anthropic/credentials.js`
  - 로드 우선순위: `process.env.ANTHROPIC_API_KEY` → `~/.anthropic/credentials` → 에러
  - **소스에 평문 박지 말 것** (CLAUDE.md 보안 규칙 준수)
- `src/services/anthropic/usage-tracker.js`
  - SQLite 테이블: `(timestamp, input_tokens, output_tokens, cache_read, cache_create, model, cost_usd)`
  - 월별 집계 함수
  - 임계치(80%, 95%, 100%) 알림 이벤트
- 단위 테스트: credentials 로드, 트래커 누적/집계, 임계치 알림

### Phase 2: Main Process API 클라이언트 (~3시간)

- `electron/services/anthropic-client.js`
  - `@anthropic-ai/sdk` 래퍼
  - 메시지 전송 (스트리밍)
  - 사용량 트래커 자동 기록
  - 에러 핸들링 (rate limit, 크레딧 소진, 네트워크 실패)
- IPC 채널 설계:
  - `chat:send` (renderer → main, payload: messages + system + options)
  - `chat:stream` (main → renderer, payload: delta chunks)
  - `chat:done` (main → renderer, payload: final usage)
  - `chat:error` (main → renderer, payload: error info)
- 통합 테스트: mock SDK로 IPC end-to-end

### Phase 3: 채팅 패널 UI (~4시간)

- `src/components/ChatPanel/`
  - 슬라이드인 사이드 패널 (기존 레이아웃에 토글 버튼 추가)
  - 메시지 리스트 (markdown 렌더링)
  - 입력창 (멀티라인, Cmd+Enter 전송)
  - 스트리밍 표시 (typing indicator)
  - 상단: 현재 컨텍스트 미리보기 (선택된 씬 ID 등)
  - 하단: 월별 사용량 바 ("$23.40 / $100 used")
- 상태 관리: 기존 패턴 따름 (zustand 사용 중이면 그대로)
- 단위 테스트: 메시지 렌더링, 입력 핸들링, 스트리밍 UI 상태

### Phase 4: 컨텍스트 자동 주입 (~3시간)

- `src/services/anthropic/context-builder.js`
  - 정적 시스템 프롬프트 빌더 (앱 설명, 도메인 용어, 사용 가능 액션) — **cache_control: ephemeral**
  - 동적 컨텍스트 빌더 (선택 프로젝트, 현재 씬, 최근 변경)
  - 토큰 예산 관리 (컨텍스트 너무 크면 잘라내기)
- 채팅 패널에서 "컨텍스트 포함" 토글 (기본 ON)
- 통합 테스트: 정적 부분이 캐시 적중하는지 (`cache_read_input_tokens > 0` 확인)

### Phase 5: 한도 관리 + 사용자 알림 (~2시간)

- 임계치 도달 시 토스트 알림
  - 80%: 정보성 알림
  - 95%: 경고 + 일시 정지 옵션
  - 100%: 채팅 비활성화 + 추가 크레딧 구매 안내 링크
- 설정 화면: 월별 사용량 그래프, 모델 선택 (Sonnet/Haiku), 캐시 통계
- 통합 테스트: mock 사용량으로 각 임계치 동작

### Phase 6 (옵션, 페이즈 2): 액션 통합 (~4시간)

- 채팅 응답에 "씬에 적용" 버튼
- 응답 JSON 블록 파싱 → 씬 업데이트
- Tool use로 발전 가능
- (MVP에서 제외 — 사용 패턴 확인 후 결정)

---

## Open questions

1. **모델 선택 기본값**: Sonnet 4.6 (품질) vs Haiku 4.5 (비용)?
   - 추천: Sonnet 4.6 기본, 설정에서 변경 가능
2. **채팅 히스토리**: in-memory만 (앱 재시작 시 소실) vs SQLite 영구 저장?
   - 추천: MVP는 in-memory, 페이즈 2에서 SQLite (프로젝트별)
3. **컨텍스트 자동 주입 범위**:
   - "현재 선택된 씬만" vs "전체 프로젝트 메타데이터"?
   - 추천: 선택된 씬 + 프로젝트 요약 (전체는 토큰 폭주 위험)
4. **사이드 패널 위치**: 우측 (기본) vs 분리된 윈도우?
   - 추천: 우측 사이드 패널 (워크플로우 단절 최소화)
5. **번들 전략**: `@anthropic-ai/sdk`를 main process에만 번들 (renderer 노출 X)?
   - 답: YES (필수)

---

## 비용 시나리오 (Max 5x = $100/월 크레딧)

| 사용 패턴 | 예상 월 비용 (캐시 활용) |
|---|---|
| 가벼운 사용 (하루 10~20 메시지, 작은 컨텍스트) | $5~15 |
| 보통 사용 (하루 30~50 메시지, 씬 컨텍스트 주입) | $20~40 |
| 헤비 사용 (하루 100+ 메시지, 큰 컨텍스트) | $60~100 |
| 자동 처리 루프 추가 | $100 초과 가능 (페이즈 6에서 별도 고려) |

→ 일반 사용은 매월 크레딧 안에서 여유 있음. 안 만들면 매월 $100 그냥 사라짐.

---

## 의존성 / 사전 작업

- `@anthropic-ai/sdk` 추가 (`package.json` dependencies)
- `~/.anthropic/credentials` 파일 형식 정의 (dotenv 호환)
- README에 API key 설정 안내 추가
- (선택) `.env.example`에 `ANTHROPIC_API_KEY` 예시

---

## Validation / Definition of Done

- [ ] 채팅창에서 메시지 전송 → 스트리밍 응답 표시
- [ ] 응답에 현재 프로젝트/씬 컨텍스트 반영됨
- [ ] 캐시 적중률 70%+ (`cache_read_input_tokens` / `input_tokens` 비율)
- [ ] 월별 사용량 트래커가 실제 API 응답 usage와 일치
- [ ] 80%/95%/100% 임계치 알림 정상 동작
- [ ] API key가 빌드 번들에 포함되지 않음 (`grep` 검증)
- [ ] 단위 테스트 + 통합 테스트 모두 통과 (CLAUDE.md TDD 규칙)
