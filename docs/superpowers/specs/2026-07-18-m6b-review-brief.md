# M6b (+M6a) 적대 리뷰 브리프

너는 AutoFlowCut(Electron)의 **적대적 코드 리뷰어**다. 코드를 고치지 마라 — findings만 낸다.
브랜치 `feature/inapp-agent`. **리뷰 범위: `git diff 7230a1a7..f138c804`** (아래 4커밋 = claude orchestrator를 프로덕션 sessionManager에 배선).

| 커밋 | 내용 |
|---|---|
| `6e255e98` M6a | claude state를 주입 runState cell로 hoist(mechanical). **M6a는 이번에 처음 리뷰됨.** |
| `5117a3d2` 2a | provider factory + open row resolve(prefixed-id 버그 수정) + catalog 동기 snapshot + defaultPin + close null-safe privateRpc |
| `3c804a21` 2b | claude coordination 분기(busy/send/steer/abort/observe) + claude.send P 채택 + settlePendingAbort 훅 + replaceRunState guard |
| `f138c804` 2c | send 생략을 session.defaultPin으로 위임(sticky 방지 이동) |

## 확정 설계 (원장 `.superpowers/sdd/progress.md` SESSION (6) 정본)
아키텍처 **A** (Codex+Fable 설계상담 합의): 세션당 단일 semantic authority cell, provider별 shape. **codex**=flat `session.runState`(매니저 SM 소유). **claude**=nested `{state:{kind},turnEpoch,toolEpoch}`(claude 내부 SM이 authority, 매니저가 open 때 생성·주입). 매니저는 `session.provider` 분기, `replaceRunState`는 claude에 호출 안 함(hard guard).

## 필독
- `.superpowers/sdd/progress.md` SESSION (6) + 그 아래 2a/2b/2c 절(설계·검증·known 이슈).
- 스펙 `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` §5.1(catalog/defaultPin/D2/sticky), §5.5(busy/reservation), §5.6(steer table), §5.7(abort), §8.
- 상담 원문 `docs/superpowers/specs/2026-07-18-m6b-runstate-consult.md`.

## 🔴 반드시 검증할 것 (paper fix 사냥 + 모든 앵커 직접 열어 대조)
1. **replaceRunState가 claude nested cell을 절대 전삭제하지 않는가.** 모든 호출부(send/finishPending/releaseActive/closeSession/settleAbort/abort)가 claude 세션에서 이 함수에 도달하지 않는지. guard가 loud한지.
2. **claude.send P 채택**(`claudeOrchestrator.js:998`): await open 전 injected 캡처, self-mint 제거. turnId가 매니저 P(`${sessionId}:pending:N`)인지, standalone(주입 없음)은 self-mint 유지해 M2~M4 무변경인지.
3. **🔴 pendingStart 창 abort 정산 훅**(2b-4): 매니저 open/catalog await 중(claude.send 호출 전) abort → `settlePendingAbort` 훅으로 즉시 idle 정산되는가, 아니면 30s watchdog로 세션이 닫히는가. 매니저 finishPending claude 분기가 훅을 부르는지. 훅이 잘못된 transaction을 정산하지 않는지.
4. **abort claude=위임**(2b-5): 매니저가 자체 transaction/watchdog을 안 만드는가(만들면 이중 watchdog + replaceRunState가 claude cell 삭제). `sessionClosed:true`만 background closeSession으로 소비하고 값은 무변형인가. cleanup 실패가 abort를 reject로 만들지 않는가.
5. **observeEvent codex-only**(2b): claude 이벤트가 release/state를 안 건드리는가. ⚠️ **known**: guard가 nested shape라 우연 no-op일 수 있다 — 이게 defense-in-depth로 충분한지, 아니면 필드 추가시 침묵 파괴되는 실위험인지 판정.
6. **steer**(2b-6): claude 위임(자체 steerRefusal §5.6 일치 확인), codex 매니저 게이팅이 §5.6 표(idle/pendingStart/aborting/orphanDrain/closing) error/message/turnId와 정확히 일치하는가. throw 회귀 없는가.
7. **open row resolve + defaultPin**(2a): prefixed-id 버그(open이 `codex:gpt-5.5`를 orchestrator model로 흘리던 것) 수정 확인. fail-closed(unknown provider/미해결 명시 id/null sdkModel=claude:default) 확인. cold marker(fallbackReason:'catalog-cold') vs warm. snapshot이 list() 유발 안 함.
8. **sticky/D2**(2c): 생략 send가 session.defaultPin(open 고정)을 쓰고 catalog 재조회 안 하는가(#13). 명시 provider open + 생략 send → pin.provider≠session.provider → providerSwitchRequired 동작. thread 상속 표현 불가 불변식 유지.
9. **codex 경로 무회귀**(M5): flat SM(send reservation/active/abort transaction/watchdog/observeEvent release)이 그대로인가. close null-safe가 codex privateRpc를 여전히 닫는가.
10. **claude 반환값 무변형**(sessionManager.test.js:337-339 계약): send/steer/abort 결과를 매니저가 안 바꾸는가.

## known 이슈 (평가해서 findings로 확정할지 판정)
- (a) observeEvent codex-only guard = defense survivor(#5).
- (b) `replaceRunState is codex-only` guard 존재를 **소스-문자열 grep**으로 핀한 테스트(sessionManager.test.js ~line 155-163). 원장 규율([[reviewer-consensus-is-not-measurement]])이 소스-문자열 핀을 금한다. behavioral 대체가 가능/필요한가.
- (c) claude send 분기(sessionManager.js ~:574)에 try/catch 없음 — claude.send throw 시 매니저가 rejected promise 반환. claude가 자체 상태 정리하므로 안전하다는 주장이 맞는가.

## 규율 (CLAUDE.md)
1. **모든 code anchor를 직접 열어 대조하라. 조작·드리프트된 앵커 자체가 finding.**
2. **paper fix를 사냥하라 — 사실은 맞는데 조립이 안 되는 것.**
3. **findings 0이면 실패한 리뷰다. 단, 없는 걸 지어내는 건 더 나쁘다.**
4. 스펙 문구와 코드가 상충하면 어느 쪽이 우선인지 판정+근거.

## 출력
severity(Critical/Important/Minor)별 findings 목록. 각 finding: 파일:라인 앵커 + 재현/실패 시나리오 + 근거. findings 0이면 "무엇을 열어 어떻게 대조했는지" 증거와 함께 certified. 이 리포트는 오케스트레이터(Opus)에게 가는 raw 판단이다.
