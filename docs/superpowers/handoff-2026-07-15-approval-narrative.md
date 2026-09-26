# 핸드오프 — 승인창 서술형 + danger 박스 + S6 D8 반환 정규화 (2026-07-15)

**브랜치**: `feature/inapp-agent` — HEAD `89cbf9f`. 워킹트리 클린.
**전체 스위트**: **601 files / 6601 tests 그린** (`npm run test:run` 직접 실행, exit 0).
**뮤테이션**: 승인창 39/39 + S6 15/15 = **54/54 killed, 사각지대(NO-OP) 0.**

### 이번 세션 커밋
| | |
|---|---|
| `8d8d295` | 승인창 서술형 + 신뢰 경계 + 게이트 구멍 2개 + 거짓 문구 정정 |
| `e9abe2f` | danger 줄을 빨강 박스로 (연주황+굵게는 약해서 사람이 놓친다 — 실앱 눈검증에서 드러남) |
| `89cbf9f` | **S6 — D8 반환 정규화** (아래 §S6) |

> ✅ **실앱 눈검증 통과** (사용자 확인): 서술형으로 뜸 / 전체 좁은 창에서 보임 / 다른 UI 에 안 가림. danger 는 빨강 박스로 강화 후.

---

## §S6 — D8 반환 정규화 (닫힘)

에이전트가 받던 반환이 4가지 관용구로 뒤섞여 있었다 (`{ok:true}`/`{operationId}`/`{error}`/`{status:'rejected',reason}`/도메인 페이로드). "진행중" 슬롯 없음, `unconfirmed` 두 의미. 이제 한 어휘: `{status:'done'|'error'|'aborted'|'rejected', operationId?, reason?, error?, ...}`.

- **설계**: Codex gpt-5.6-sol + Fable 5 **독립 수렴** (승인창 때와 같은 절차).
- **`stepMachine.start()` 에 additive nested `outcome`**: 완료 후 결과를 **실행 지역 변수로 캡처** (전역 `state.steps[step]` 을 반환 시점에 읽으면 abort 후 두 번째 실행이 slot 을 덮어 오보). 🔴 선행 거부 5종 top-level `{error}` 는 **renderer 계약이라 동결** — renderer 는 top-level `.error` 와 완료 시점만 읽고 `operationId`/`ok:true` 는 안 읽는다 (소비처로 확인). `outcome` 이 nested 인 이유: step throw 문구가 거부 토큰과 겹쳐도 renderer 토스트 오발 방지.
- **`toolCore.call()` 끝 단일 normalize choke point** (에이전트 전용). `normalizeToolResult` 는 **fail-CLOSED** — 비-D8 status / 미래 outcome / 미지 표식은 **throw** (done 지어내기 금지). "작업 실패(error)" 와 "결과를 모른다(isError)" 의 구분이 D8 의 존재 이유.
- **unconfirmed 분리**: grant 없음 = `reason:'unconfirmed'`, roster 미확정 = `reason:'characters-unconfirmed'`. rename 은 toolCore 매핑에서만, stepMachine 불변.
- **wait_batch 격리**: 배치 `status`/`error` 를 `batch:{...}` 안에 가둔다 (D8 status 와 충돌 방지).
- 🔴 **스펙 D8 텍스트도 갱신** (`docs/superpowers/specs/...v11.md:181`) — reason open set, `getStateLight()` 유령 심볼 제거, 낡은 줄번호 → 심볼. **이 파일은 gitignore 라 git 에 없다. 디스크 정본만 갱신됨.**
- Fable 리뷰가 잡은 **fail-open** (MEDIUM): 원래 normalizer 가 "모르면 done" 이었다 → 미래 커맨드/outcome 이 조용히 done 으로 샐 뻔. fail-closed 로 뒤집고 뮤테이션 8종으로 못박음.

> ⚠️ **`| tail` 로 파이프하면 exit code 가 `tail` 의 것이 되어 항상 0 이다.**
> `npm run test:run > /tmp/f.log 2>&1; echo $?` 로 **직접** 받아라.

### 정본 문서
1. **스펙 = 계약**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — **D9 ERRATA "(A) 채택 조건 5개"** 가 본문보다 우선.
2. **이전 핸드오프**: `handoff-2026-07-15-m2-gate-live.md` (§2 M2 구조, §3 실앱/패키징이 잡은 것 — **여전히 유효하다**)
3. 이번 작업 설계문: `docs/superpowers/plans/2026-07-15-approval-{payload-trust-boundary,presenters}.md`

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. **git 에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 이번에 한 것 (핸드오프 §5(1) — 닫혔다)

### (a) 신뢰 경계 — **뚫려 있었다**
아무도 `message` 속 args 와 `_meta.argsHash` 가 같은지 **검증하지 않았다.** message 만 변조하면 **사람이 A 를 보고 B 에 서명**한다.
→ adapter 는 **운반만** 한다 (`electron/agent/approvalPayload.js` 의 canonical 봉투 `{v:1,tool,args}`).
→ **main 이 대조**한다 (`elicitationResponder`): `decoded.tool===_meta.tool && hashArgs(decoded.args)===_meta.argsHash`. 불일치면 **묻지도 않고 decline.**
→ renderer 는 **구조화 args** 를 받는다 (문자열 재파싱 제거).
**결과: 표시된 args = grant 의 argsHash = 실행되는 args 가 증명된 동일물이다.**

### (b) 서술형 승인창
`src/agent/approvalPresenters.js` — **키 단위 describer**. 툴 단위 all-or-nothing 요약을 버렸다 (모르는 키 하나에 요약 전체를 포기하던 병).
- `presentApproval(tool,args,t)` → `lines[{text,paths,danger,headline}]` + `blocks`
- **residual**: 아무 line 도 선언하지 않은 leaf 는 **강제로 raw 노출**. → 서술이 원본을 **대체할 수 없다** (구조적으로).
- **headline → danger → 정보** 순. 무엇을 하는지가 먼저 온다.
- **presenter 가 null** (모르는 툴 / 계약 밖 타입) → 전체 raw + 경고 + **승인 버튼 disabled** (fail-closed).

### (c) 게이트 구멍 2개 — 리뷰가 파냈다
- 🔴 **`characters: null`**: presenter 의 `Array.isArray` 가드를 빠져나가 "명단 교체" 경고가 **사라지고 안심 문장만** 남았다. 실행부는 `characters = []` default 가 `undefined` 에만 걸려서 **확정 등장인물 전원 + voice 를 파괴**한다.
  → **zod 검증이 adapter(경계 밖)에만 있었다.** 이제 `toolCore.call()` 이 **grant 소비 전에** 같은 변환기(`electron/agent/jsonSchemaToZod.js`)로 모든 args 를 검증한다.
- 🔴 **`params.input`**: 에이전트가 `input.type` 을 non-gated 로 바꾸면 **등장인물 확정 게이트가 영구 우회**되고 로스터 강제가 꺼진다 (`rosterEnforced()` 와 하류 게이트가 둘 다 그 type 을 본다).
  → 에이전트 툴 표면에서 **`input` 제거**. `title` 만 좁게 열고, **pasted 경로일 때만** `{input:{title}}` 로 변환. `type` 은 절대 에이전트에게 열지 않는다.

### (d) 문구가 **거짓말**이었다 (전부 `stepMachine.js` 대조로 정정)
`setSpeakers` 는 **merge**(미참조 화자 보존)지 "저장"이 아니다 / `confirmSynopsis` 는 명단 **전체 교체** + synopsis.md **덮어쓰기** + 하류 게이트 **해제** / 모든 `*_start` 는 **하류를 pending 으로 초기화** / audio 는 **외부 TTS·SFX 비용** / `regenerate` 는 **"그 둘만"이 아니다** / `reviewOnly`+`scriptOverride` 는 **검수 변경 0건에도 덮어쓴다** / scenes 검수는 **roster 재기록으로 화자를 영구 소실**시킬 수 있다 / audio 는 재그룹 시 **사람이 검수한 프롬프트를 날린다** / `pastedScript` 는 **제목·옵션을 통째 교체(생략 시 소거)** / **무시되는 인자**엔 "(이번 실행에는 적용되지 않습니다)".

---

## 1. 작업 방식 (그대로 유효)

| 성격 | 담당 |
|---|---|
| **어려운 것** (설계, 코드 고고학, 동시성/identity/보안) | **Codex `gpt-5.6-sol`** — `mcp__codex__codex`, `sandbox: workspace-write`, `xhigh` |
| **적대적 리뷰** (findings 0 까지 loop) | **Fable 5** — Agent tool, `model: 'fable'` |
| **오케스트레이션 + 검증** | **Opus** — 🔴 **테스트/뮤테이션은 직접 돌린다.** Codex 는 샌드박스 loopback(`listen EPERM`) 때문에 3파일을 못 돈다. "전부 그린"이라는 보고를 그대로 믿지 마라 |

### 🔴 뮤테이션이 전부다 — 이번에도 **3라운드 연속** 같은 병이 나왔다
> **코드는 맞는데 테스트가 제품이 실제로 가는 길을 안 지나간다.**

이번에 뮤테이션으로만 잡힌 것:
- 화자 **항목**(배열 원소)의 타입 fail-closed 를 **아무 테스트도 안 밟았다** (root 만 덮여 있었다)
- residual 의 형제-접두사 과잉 커버(`/step` 이 `/stepX` 를 삼킴)를 구분하는 fixture 가 **없었다**
- `toolCore` 가 **스스로** `input.type` 을 지어내거나 `title` 을 생성 경로로 흘려도 **아무도 안 죽었다** (스키마만 막고 안쪽은 안 지켰다)

**하네스**: `mutate.mjs` — byte-exact `cp` 백업/복원 + md5 대조 + **NO-OP(패턴 불일치)를 통과가 아니라 사각지대로 보고** + 복원 후 baseline 재확인. (`git checkout -- <untracked> <tracked>` 로 복원하면 pathspec 에러로 **아무것도 복원 안 되고** 뮤테이션이 누적된다 — 예전에 "10/10 killed" 가 통째로 거짓이었다.)

### 🔴 앵커는 **심볼**로 써라
이번 diff 안에서 `STORY_STEP_DOWNSTREAM` export 가 stepMachine 상단에 6줄을 넣는 바람에 **presenter 의 줄번호 앵커 29개가 전부 −6 드리프트**했다 — **커밋도 되기 전에.** 전부 심볼 앵커로 교체했다 (`grep "stepMachine.js:[0-9]"` → 0건). **다시 줄번호로 쓰지 마라.**

---

## 2. 승인창 불변식 (깨면 게이트가 죽는다)

1. **서술이 원본을 대체하지 않는다** — grant 는 전체 인자 해시에 묶인다. residual 은 **항상 펼쳐서** 보여준다.
2. **앱이 만든다, 모델이 아니라** — presenter 는 args 만의 순수 함수다.
3. **모르는 것은 지어내지 않는다** — 모르는 툴/타입 → 서술 0 + 전체 raw + **승인 disabled**.
4. 🔴 **나쁜 요약은 없는 것보다 나쁘다 — 안심시키기 때문이다.**
5. **드리프트 락**: `APPROVAL_KEY_DECISIONS` ↔ 실제 `inputSchema` 키·타입 / `APPROVAL_DOWNSTREAM` ↔ `STORY_STEP_DOWNSTREAM` 을 테스트가 대조한다. **스키마에 키를 추가하면서 "서술할지 raw 로 흘릴지" 를 결정 안 하면 CI 가 터진다.**
6. **출하 게이트**: `toolCore.list()` 의 모든 G/B 툴은 presenter 가 있어야 한다. **M4 에서 `generate_videos` 를 넣는 순간 이 테스트가 빨간불이 된다** — presenter(과금 수량·크레딧 명시) 없이는 출하 못 한다.

---

## 3. 🔴 다음 할 일

### (1) 빚 — ~~S6~~ 완료(`89cbf9f`), M4 남음
~~**S6 — D8 결과 정규화.**~~ ✅ **닫혔다** (위 §S6). fire-and-forget 함정(실패·중단 턴을 done 오보)은 outcome 지역 캡처로 피했다.

**`generate_videos` / `video.admit` — M4.** 과금 툴인데 `video.admit` 이 없어서 **출하 툴 표에서 뺐다** (승인하면 grant 만 소진되고 아무 일도 안 일어났다). 🔴 현재 출하 정책표의 **B 는 의도적으로 0개**이고 `list()` 에 그 사실이 단언으로 박혀 있다 — M4 에서 되넣으려면 **의식적으로** 그 테스트를 고쳐야 한다. (게이트의 B 기계는 fixture B 툴로 계속 테스트된다.)

### (2) 실앱 눈검증 — **서술/스크롤/가림 통과**, danger 빨강 박스 **재확인만 남음**
사용자 확인: 서술형으로 뜸 / 전체가 좁은 창에서 보임 / 다른 UI 에 안 가림. **단 danger 를 빨강 박스(`e9abe2f`)로 바꾼 뒤의 재확인은 아직** — 승인창 다시 띄우면 위험 줄이 빨강 박스로 확실히 갈리는지 눈으로.
⚠️ 유닛 테스트가 원리적으로 못 잡는 부류가 있다 (승인창이 DOM 오버레이 아래 깔림, `WebContentsView` 는 z-index 로 못 이김, asar 안의 `spawn`…) — 최종 확인은 **`npm run pack` 패키징 + 터미널 실행**.
⚠️ `npx electron-builder --dir` 만 돌리면 vite/main 번들이 갱신 안 된다. **반드시 `npm run pack`.**
⚠️ 패키징 앱은 **터미널에서** 띄워라 — Finder 더블클릭은 `ELECTRON_RUN_AS_NODE` 함정을 재현 못 한다. dev 는 `env -u ELECTRON_RUN_AS_NODE npm run dev`.

### (3) 그 다음
M3 (에이전트의 눈 + Export) → M4 (Veo + 크레딧) → M5 (리서치 툴 7종).

---

## 4. 잡일 / 미측정

- **레거시 MCP HTTP 토큰 인증** — CORS 는 끊었지만 **같은 머신의 다른 프로세스는 여전히 닿는다.** 제품 결정 필요.
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패. 재현 안 됨.
- D23 잔여: `keyStoreMulti` 의 `anthropic` 슬롯이 **읽는 곳 0개**.
- **appx (MSIX)** — MS Store 낼 때만.
- 미측정: 장기 세션 중 `auth.json` refresh / 지속 thread 의 context 상한 / M0-3·4·6·7·14·15·16.
- **리뷰가 남긴 LOW (안전한 방향의 부정확 — 고칠 필요는 없지만 알고는 있어라)**: audio timingOnly 는 하류 리셋 후 prompts 를 done 으로 복원하는데 창은 무조건 초기화라고 말한다(실제보다 **나쁘게** 경고) / 생성 경로의 빈 문자열 `synopsis` 는 저장된 synopsis.md 폴백을 억제하는 미세 효과가 있는데 중립 표시(비파괴적).
