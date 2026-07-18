# Story M3 — 대본 검토 루프 설계

**날짜**: 2026-07-04
**맥락**: M3(Claude 품질 경로) 남은 작업. Claude 어댑터·모델선택·구독로그인은 이미 완료(대본 재설계 때). 남은 건 **대본 자동 검토·수정 루프**. 스펙 근거: `2026-07-02-story-pipeline-design.md` §124-125(Claude: 쓰기→자체검토→수정 루프 최대 3회 옵션 / Gemini: 검토 1회), §10 M3.

## 0. 목표 / 비목표

- **목표**: 대본 생성 후 **옵션 토글**로 켜면, 앱(스텝머신)이 `검토→수정`을 **최대 3회 자동 반복**(비평가 verdict가 pass면 조기종료)해 다듬은 최종본을 편집기 게이트에 올린다.
- **비목표(YAGNI)**: 라운드별 사용자 확인 UI(자동 루프만). 씬/오디오/프롬프트 등 하류 변경(무변경). 별도 검토 "스텝"(script 스텝 내부에서만 돈다). 검토 결과 이력 영속(마지막 대본만 저장).

## 1. 확정 결정 (brainstorm)

| 항목 | 결정 |
|---|---|
| 개입 방식 | **자동 루프 → 최종본만 편집기에**. 라운드별 확인 없음. |
| 종료 조건 | 비평가 **verdict='pass'면 조기종료**, 아니면 **최대 3회**. |
| 검토 기준 | **내장 루브릭 + 장르 metaPrompt**(loadMetaPrompt 재사용). |
| 토글 기본값 | **OFF**(비용·시간 드는 opt-in 품질 옵션). |
| 위치 | **script 스텝 내부**(스텝머신이 루프 제어, LLM이 아니라 앱이 순서 통제 — §42). |

## 2. 데이터 흐름 (스텝머신)

검토 루프는 **script 스텝 내부**의 생성 경로 끝에 붙는다. **pasted/continue 조기반환 경로는 제외**(§2.1). 실패 격리를 위해 **루프 전체를 try/catch로 감싸고**, 비-abort 에러는 정상 반환(스텝 `done`)한다 — `start()` 래퍼가 throw를 `script:error`로 마킹하기 때문(Codex-High2).

```
script 스텝(stepMachine.js), 생성 경로(generateScript) 뒤:
  await store.saveText('script.md', scriptMd)          # 기존: 초안 저장(streaming 완료)
  if opts.reviewLoop && !signal.aborted:
    const MAX = reviewRounds(opts.model || state.engine?.model)  # effective model 사용(Codex-R2). claude→3, 그 외→1
    try {
      for (round = 1; round <= MAX; round++) {
        send('story:progress', { kind:'script-review', operationId:opId, round, of:MAX, phase:'reviewing' })
        const { verdict, critique } = await llm.reviewScript(scriptMd, opts, { signal })
        if (signal.aborted) return
        if (verdict !== 'revise' || !critique?.trim()) break   # pass, 또는 revise인데 critique 비면 종료(Codex-Low6)
        send('story:progress', { kind:'script-review', operationId:opId, round, of:MAX, phase:'revising' })
        const r = await llm.reviseScript(scriptMd, critique, opts, { signal })   # NON-streaming(Codex-High1)
        if (signal.aborted) return
        scriptMd = r.scriptMd
        await store.saveText('script.md', scriptMd)      # 라운드마다 최신본 영속
      }
    } catch (e) {
      if (signal.aborted) return                         # abort: 조용히 중단(토스트 없음)
      send('story:progress', { kind:'script-review', operationId:opId, phase:'error', error:String(e.message||e) })
      # return 없이 정상 진행 → 마지막 저장본 유지, 스텝 done(Codex-High2)
    }
  # → 스텝 done, story:state가 최종 scriptMd 전달 → 편집기 게이트(기존)
```

- **하류 무변경**: DOWNSTREAM(script→scenes/audio/prompts) 리셋은 `start()` 래퍼가 스텝 시작 시 1회. `story:state`/pushScenes emit도 최종 settle 1회. storyStore.writeAtomic이 쓰기를 큐잉하므로 라운드별 `saveText` 다중 호출은 안전(Codex 확인).
- **streaming 안 함**: reviseScript는 onDelta 없이 전체 재작성본을 반환한다. 초안(generateScript)만 스트리밍되고, 검토/수정 라운드는 progress 배지로 표시(§5). 스트리밍 append 계약에 revise 전체본을 흘리면 preview에 초안+수정본이 누적되는 버그(Codex-High1)를 피한다. 최종본은 스텝 settle 시 `story:state.scriptText`로 편집기에 반영.

### 2.1 적용 범위 (script 경로별)

- **적용**: generateScript 생성 경로(최초 생성 + 다시쓰기/rewrite — 둘 다 generateScript 통과).
- **제외**: `params.pastedScript`(사용자 임포트 대본)·`params.continue`(이어쓰기) 조기반환 경로. 토글은 setup 폼(생성)에서만 노출되므로 임포트엔 애초에 reviewLoop=false. 구현은 생성 경로 끝에서만 루프 호출(별도 헬퍼 불필요 — 조기반환들이 이미 앞에서 return).

### 2.2 라운드 수 (엔진별, Codex-Med4)

- `reviewRounds(model)`: model이 `claude`로 시작하면 3, 그 외(gemini 등) 1. 부모 스펙(§124-125: Claude 최대 3 / Gemini 1)과 일치. Gemini 3라운드 오동작 방지.
- **effective model 주의(Codex-R2)**: story state.engine엔 `model`이 없다(`{llm:'claude'}`). UI 선택 모델은 `params.options.model`→`opts.model`로 온다(stepMachine.js:194에서 `...params.options`가 override). 따라서 반드시 `reviewRounds(opts.model || state.engine?.model)`로 **effective model**을 넘긴다. `state.engine.model`만 쓰면 undefined→1로 Claude가 Gemini처럼 degrade.
- 현재 story UI 모델 드롭다운은 Claude(Opus 4.8/Sonnet 5)만 노출 → 실질 Claude(3). 그러나 엔진 함수는 양쪽(llmClaude/llmGemini)에 추가해 parity 유지.

## 3. 엔진 함수 (llmClaude.js + llmGemini.js 양쪽 동일 시그니처)

- `reviewScript(scriptMd, opts, { signal }) → { verdict: 'pass' | 'revise', critique: string }`
  - structured output(REVIEW_SCHEMA). 루브릭+장르 metaPrompt 기준 채점.
  - Claude: structuredClaudeCall(REVIEW_SCHEMA). Gemini: structuredCall(REVIEW_SCHEMA).
  - verdict 정규화: 'pass'/'revise' 외 값은 'pass'로 취급(안전측 — 애매하면 수정 안 함). 루프는 verdict='revise' && critique non-empty일 때만 계속(§2).
- `reviseScript(scriptMd, critique, opts, { signal }) → { scriptMd }`
  - critique 반영해 전체 재작성. **NON-streaming**(onDelta 없음) — 완성본만 반환(Codex-High1). 내부적으로 non-stream 호출 경로 사용(Claude: outputFormat 없이 result 텍스트 / Gemini: generateContent 1회).
- **REVIEW_SCHEMA**(schemas.js): `{ verdict: STRING, critique: STRING }`, required 둘 다.

## 4. 프롬프트 빌더 (prompts.js — 두 엔진 공유)

- `buildReviewPrompt(scriptMd, opts)`:
  - **내장 루브릭**: 훅(도입부 몰입), 구조(기승전결), 페이싱(늘어짐/급전개), 일관성(설정·인물·시점), 화자 구분(대사 자연스러움), 결말(여운·마무리).
  - `opts.metaPrompt`(장르 지시) 있으면 컨텍스트로 포함.
  - 지시: "심각한 문제가 있으면 verdict='revise'와 구체적 critique, 충분히 좋으면 verdict='pass'. 사소한 취향 차이로 revise 남발 금지."
- `buildRevisePrompt(scriptMd, critique, opts)`:
  - "아래 비평(critique)을 반영해 대본을 개선하라. 톤·언어·길이·화자 표기는 유지. 전체 대본만 출력(설명 금지)."

## 5. UI (StoryView.jsx setup 폼)

- **옵션 행 1개 추가**(`story-opt-row` 패턴): 라벨 "대본 자동 검토·수정" + 체크박스. 로컬 state `reviewLoop`(기본 false). `disabled={isRunning}`.
- `handlePrimaryAction`의 script start에 `options.reviewLoop` 실어 보냄(기존 genre/length/language options에 합류).
- 재오픈 hydrate: reviewLoop는 재실행 옵션이라 hydrateOpts에서 복원(기존 genre/model 패턴).

### 5.1 진행 표시 계약 (Codex-Med3)

- **pipeline state** `reviewProgress = { operationId, round, of, phase, error? } | null`. `useStoryPipeline`이 `story:progress`(kind:'script-review')를 받아 갱신(segmentProgress 패턴 참고, **별도 필드**).
- **operationId 필터·cleanup**(stale 배지 방지):
  - `story:start`(새 실행) 시 `reviewProgress=null`로 초기화.
  - 수신 이벤트의 operationId가 현재 진행 중 operation과 다르면 무시.
  - terminal `story:state`(스텝 settle) 수신 시, 그리고 abort·프로젝트 전환(open) 시 `reviewProgress=null`.
- **배지 위치**: script 생성 화면의 두 스트리밍 상태(setup phase 직후 `story-script-stream`, editor phase 스트리밍) 위에 공통으로, `reviewProgress`가 있으면 "검토 중 N/3" 또는 "수정 중 N/3"(phase='error'면 "검토 중단") 표시. 검토 호출은 non-streaming이라 이 배지가 없으면 UI가 멈춘 것처럼 보임 — 배지가 진행 신호를 준다.

## 6. 실패 / 취소 처리

- reviewScript/reviseScript **실패**(throw): 루프를 try/catch로 감싸(§2) 중단하되 **이미 저장된 대본(마지막 성공본)을 유지**하고 스텝은 정상 반환(→ `start()` 래퍼가 `done` 마킹). progress `phase:'error'` emit → 편집기 스트림 위 "검토 중단" 배지. 품질 옵션이 본 생성을 깨선 안 됨. (generateScript 자체 실패는 루프 이전이라 기존대로 스텝 error.)
- **abort**: 라운드 사이 `signal.aborted` 검사로 즉시 return(catch에서 aborted면 error emit 없이 조용히), 마지막 저장본 유지. `start()` 래퍼의 isStale/동기 error 마킹과 일관.

## 7. 테스트 (TDD)

- **엔진**(llmClaude/llmGemini): reviewScript verdict 파싱(pass/revise), 잘못된 verdict→'pass' 폴백, reviseScript가 NON-streaming으로 최종 scriptMd 반환(onDelta 미호출). mock queryImpl(claude) / fetch(gemini).
- **프롬프트**: buildReviewPrompt 루브릭 키워드·metaPrompt·본문 포함, buildRevisePrompt critique·본문 포함.
- **reviewRounds(model)**: 'claude-*'→3, 'gemini-*'/기타→1.
- **스텝머신**: reviewLoop mock —
  - (a) 1라운드 pass 조기종료(revise 미호출),
  - (b) 계속 revise면 MAX회 후 강제종료 — **integration: options.model='claude-sonnet-5' + 계속 revise → 정확히 3라운드**(Codex-R2, reviewRounds 단위테스트만으론 effective-model 배선 실수 못 잡음),
  - (c) verdict='revise'인데 critique 빈 문자열이면 종료(revise 미호출),
  - (d) reviewScript/reviseScript throw면 원본(마지막 저장본) 유지 + 스텝 **done**(error 아님) + progress error emit,
  - (e) abort 시 라운드 사이 중단·마지막 저장본 유지·error progress 없음,
  - (f) reviewLoop=false면 루프 미실행,
  - (g) pasted/continue 경로는 reviewLoop 무관(루프 미실행),
  - progress emit(operationId/round/phase) 검증.
- **UI**: 토글 렌더·기본 off, 켜면 start('script', options.reviewLoop=true) 전달. reviewProgress 배지 표시 + operationId 불일치/terminal/abort 시 cleanup.

## 8. 변경 파일

- `electron/api/llm/schemas.js`(REVIEW_SCHEMA), `prompts.js`(buildReviewPrompt/buildRevisePrompt), `llmClaude.js`+`llmGemini.js`(reviewScript/reviseScript).
- `electron/story/stepMachine.js`(script 스텝 루프).
- `src/components/story/StoryView.jsx`(토글 + progress) + `useStoryPipeline.js`(reviewProgress, 필요 시).
- 테스트: 각 미러 경로.
- GCF 무변경. 크로스레포 없음.

## 9. 마일스톤 완료 정의

이 슬라이스로 M3의 actionable 부분(대본 검토 루프) 완료. **정책 시행 확인/feature flag는 릴리스 시점 게이트**(Anthropic 구독 크레딧 정책 의존)라 별도 — 코드 작업 아님.
