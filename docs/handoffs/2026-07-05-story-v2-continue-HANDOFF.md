# Story V2 이어가기 — 핸드오프 (V2-B 화자별 트랙 + V2-C BGM)

**날짜**: 2026-07-05
**브랜치**: `feature/story-pipeline` (working tree clean, 전부 커밋됨, **미푸시**)
**HEAD**: `c6009be`
**진행 원장**: `.superpowers/sdd/progress.md` (맨 아래)
**메모리**: [[autoflowcut-story-v2-character-reference]] [[autoflowcut-story-m3-review-loop]] [[autoflowcut-story-m2a-audio]]

---

## 0. 이번 세션 완료 (커밋됨)

| 커밋 | 내용 |
|---|---|
| `b14fba5`/`b302a96` | **M2b(SFX)** LLM 자동추출 + UI + 단건 테스트 버튼 + 드롭다운 컴팩트 |
| `b8aa011` | **0번 설정 탭** 분리 (스텝퍼 `[0 설정][① 대본]…`) + 대본 탭 '설정으로' 버튼 제거 |
| `82848bd` | **M3 대본 자동 검토·수정 루프** (옵션 토글, Claude 최대 3회, 실패 시 원본 유지) |
| `db96633` | **V2-A 캐릭터 레퍼런스 자동 등록** (speaker appearance→Ref탭 카드 + 씬 태그) |
| `c6009be` | **V2-A @멘션 방식 전환** (프롬프트에 `@이름` 주입 → Flow·API 둘 다 안정) |

전체 **4130 pass**. 각 마일스톤 Codex(gpt-5.5/xhigh) findings 0.
- M3: spec Codex 3R + code 2R = 0
- V2-A: spec 5R + code 4R = 0, 멘션 전환 code 2R = 0

## 0.1 남은 사용자 눈검증 (실앱, 실호출 — 코드 아님)
- **M3**: 대본 검토 토글 켜고 실제 대본 생성 → 검토/수정 배지·품질 확인(비용 발생).
- **V2-A**: 실제 대본 → 씬/프롬프트 push → Ref 탭에 character 카드 자동 등록 + 씬 프롬프트에 `@이름` 주입 확인 → [레퍼런스 생성]→[씬 생성] 시 캐릭터 일관성 확인.
- **M2b SFX**: 실제 대본에서 sfx 추출 품질 + ElevenLabs 실생성(비용).

---

## 1. 남은 V2 후보 (미착수)

### V2-B — 화자별 분리 오디오 트랙 (⚠️ 크로스레포 GCF)
현재 스토리 오디오는 **단일 나레이션 트랙**. 화자별로 CapCut/Premiere **멀티트랙**에 분리 배치.
- **참고**: M2a-4에서 story_narration을 단일 트랙(A1/trackIndex 0)에 배치했다. 이를 화자별 트랙으로 확장.
- **범위**: prepareCloudRequest(app) + **whisk2capcut/whisk2premiere GCF 배포**(크로스레포, index.suffixed.js 수정→`./deploy.sh test <함수명>`, ⚠️ **test만, prod 금지**). M2a-4b/4c 패턴 그대로.
- **착수 전 결정**: 트랙 배정 규칙(화자→trackIndex), 겹침 처리(같은 시각 다른 화자? 스토리는 serial이라 거의 없음), Vrew(자체TTS라 무관).
- **기존 앵커**: `src/exporters/prepareCloudRequest.js`(story_narration 분기), whisk2capcut `index.suffixed.js` audioTracks 배치, whisk2premiere `src/premiereExport.js` A1 라우팅. M2a-4 메모리/원장 참고.

### V2-C — BGM 생성/선곡
배경음악 생성(또는 선곡) → 타임라인 전체 길이에 배치. **SFX 파이프라인과 유사 구조**.
- **참고**: M2b(SFX)가 좋은 템플릿 — 세그먼트 대신 전체 길이 bgm 트랙. `electron/api/sfx/`(어댑터 패턴), export sfx_timed(→ bgm 트랙 타입) 참고.
- **결정 필요**: 생성 API(음악 생성 모델) vs 로컬 선곡, 볼륨/페이드, export 트랙 타입.

### (V2 스펙 §9 기타, 후순위)
다국어 동시 생성, 씬별 프롬프트 자동 QA 루프 등 — 필요 시.

### M3 릴리스 게이트 (코드 아님)
"정책 시행 확인/feature flag" = Anthropic 구독 크레딧 정책(2026-06-15 발표, 시행 연기) 시행 여부 확인 후, 미시행이면 Claude 경로를 flag 뒤로 숨기고 Gemini 단독 출시. 릴리스 시점 판단.

---

## 2. 작업 방식 (반드시 지킬 것)

- **TDD 필수**: RED→GREEN, 슬라이스별. 기존 테스트 갱신 시 옛 동작 고정분만.
- **마일스톤 끝 Codex 리뷰**: [[codex-review-per-milestone]] — `mcp__codex__codex` **model:'gpt-5.5', config.model_reasoning_effort:'xhigh'** (ChatGPT 계정이라 gpt-5.5-codex/gpt-5.2-codex 불가, 'gpt-5.5'만). spec 방향 리뷰 + 구현 후 코드 리뷰 각각 **findings 0까지 loop**.
- **spec/plan은 `docs/superpowers/{specs,plans}/`(gitignore=로컬)**. 완료 시 `docs/plans-archive/`(로컬)로 이동. 완료된 tracked handoff는 plans-archive로 옮기고 commit.
- **GCF 배포 규칙**: `index.suffixed.js` 수정 → `./deploy.sh <env> <함수명>`. ⚠️ **test만, prod 금지**(사용자 지시). whisk2capcut=`generateCapcutJson`, whisk2premiere=`generatePremiereJson`.
- **어려운 서브문제 → Fable 5 subagent**(model:'fable') [[use-fable5-for-hard-problems]].
- **커밋**: 사용자 OK 받고. 메시지 끝에 Co-Authored-By 라인. **푸시는 사용자 결정**(현재 전부 미푸시).

## 3. 재개 순서 (권장)
1. V2 중 하나 선택(V2-B 화자별 트랙 or V2-C BGM) → `superpowers:brainstorming`으로 설계 결정.
2. spec 작성 → Codex 방향 리뷰(findings 0).
3. TDD 구현(슬라이스별) → Codex 코드 리뷰(findings 0).
4. 커밋(사용자 OK) → 진행 원장·메모리 갱신.

## 4. 핵심 계약 요약 (V2-A, 이어질 작업 참고)
- **캐릭터 레퍼런스 = @멘션 방식**: Flow·API 모두 프롬프트의 `@이름`으로 레퍼런스 지정(태그는 Flow에 안 닿음). mapScene가 등장 캐릭터 `@speaker.name` 주입(`withMentions`), 공백이름은 멘션 불가→생략, 태그(`characters`)는 폴백. 동명 비-character 충돌 이름은 App 브리지에서 `stripMentionsForNames`로 평문화.
- **speaker 계약**: `{ id, name, appearance?, voice? }`. segment.speaker=id(≠name). appearance 승계(voice 미러). narrator=정규화 id/name 판정.
- **브리지(App onPushScenes)**: upsert 먼저(collision 파악)→collision 이름 멘션 평문화→importStoryScenes→setReferences+`saveCurrentProjectWithPayload({references})`. **referencesRef(동기 최신)+pushQueueRef 직렬화+프로젝트 전환 stale push throw**.
