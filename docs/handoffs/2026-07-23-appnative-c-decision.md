# (c) 하이브리드 확정 — 앱 네이티브 실행 레이어 결정 근거

Codex(gpt-5.6-sol) + Fable 5 **독립 자문 합의**. 둘 다 코드 실측(브리프의 사실 오류까지 교차 수정).
사용자 "go" 로 (c) 확정.

## 결정
쇼핑 숏츠 = **작은 독립 shopping 실행기(plan 머신)가 워크플로우 소유 + UI 셸·씬 상태·생성·export 전면 공유.**
- **(b) 스토리 장르 아님**: 스토리 "장르"는 메타프롬프트 파일 교체 하나뿐(`electron/api/llm/metaPrompts.js:29`). 쇼핑은
  다른 상태기계(크롤→사실검증→plan 해시 승인→물질화→생성→검수). 60초 스코프는 스토리 4스텝(script/scenes/
  audio/prompts)을 하나도 못 씀 — 특히 audio(~700줄 TTS/SRT)는 Veo 네이티브 대사라 통째 우회. (b)=4스텝 전부
  `if(shopping)` 우회. 승인 게이트가 스텝 status(재실행 가능)로는 안 물림.
- **(a) 완전 독립 뷰도 아님**: 프로젝트 세션·씬 push·abort·token·stepper 재구현 = 과한 중복.

## 실측으로 교정된 사실 (내 브리프가 틀렸던 것)
- `src/services/storyInputTypes.js` **main 에 없음.** 입력타입은 `state.input.type` 리터럴(`'title'|'pasted'|'manual'`)이
  stepMachine·StoryView 에 흩어진 개별 분기. "상품 URL 을 입력타입으로 끼운다"의 플러그인 지점이 없음.
- `ModeSelector`/`ModeToggle` = **api/flow 백엔드 선택**(`useAppMode.js:8` `VALID_MODES=['api','flow']`), 콘텐츠 카테고리 아님.
- 콘텐츠 카테고리 축이 앱에 없음. 스토리 장르 선택도 Settings 아니라 **StoryView 대본 setup 폼**(`StoryView.jsx:794,1907`).
- Research 는 스텝 아님 — side action + 게이트 탭. 산출물 `research.json` 의 유일 소비처는 **시놉시스 프롬프트 주입 한 곳**
  (`stepMachine.js:2233`, `useResearch:true`일 때만), 하류 게이트 없음.
- `src/agent/`·`electron/agent/` **main 에 없음**(앱네이티브 확정).
- stepMachine 은 **2702줄**(브리프 3045 오기).
- 씬 스키마가 이미 `imagePath`(실사 제품) + `videoI2VPrompt`+duration(인물 i2v) 지원(`src/utils/parsers.js:73,122`,
  `src/utils/sceneMedia.js:52`). **물질화 renderer 계약 준비됨.**
- `sourceAudioPolicy`/`sourceAudioGain` 씬 스키마에 **없음**(grep 0) — 어느 안이든 신규 필드(=U4 리스크).

## 사용자 두 가설: 반대 → 재구성 (양쪽 수렴)
- 가설1(Research 가 상품 URL 도): ResearchPanel 유튜브 전용 + research 무게이트 → **반대**. 단 "URL 붙여넣으면
  시작" UX 는 옳음 → **ShoppingPanel 첫 화면**으로.
- 가설2(Settings 쇼핑 카테고리): 콘텐츠 타입은 앱 설정 아니라 프로젝트 속성 → **"새 프로젝트 생성 시 콘텐츠 타입
  선택"**으로.
- **합쳐진 그림**: 새 프로젝트 → 콘텐츠 타입 "쇼핑 숏츠" → StoryView 자리에 ShoppingPanel → 첫 화면=상품 URL 입력
  → 독립 plan 머신 → 씬표 승인 → 공유 씬/생성/export. `project.workflowType`(또는 유사) 필드 신설,
  project.json 영속(`useProjectData.js:407` payload 확장).

## 재사용 지도 (양쪽 `파일:라인` 교차 일치)
| 대상 | 코드 | 판정 |
|---|---|---|
| 상품/이미지 취득 | `electron/api/net/safeHttpFetch.js:84,90,453` | ✅ M1a 완료 |
| 상품 사실·할인 | `electron/api/commerce/coupangParser.js:328,488` | ✅ M1b 완료(page-asserted→사람검증) |
| 페르소나 identity | `src/services/storyCharacter.js:20,51` | 필드 재사용, **한국어 문법 빌더는 신규**(콤마 문법이 "a Korean woman in her 30s" 보장 못 함) |
| 씬 물질화 push/ack | `stepMachine.js:958`(sendPush)→`useStoryPipeline.js:283`(ack)→`useScenes` setScenes | 미러링(쇼핑 이벤트로) |
| 이미지·Veo i2v | `electron/api/genai.js:216`(generateImage)/`:541`(generateVideo i2v), `src/engine/engineApi.js:24` | 저수준 그대로. 승인/hash/journal 은 쇼핑 머신 소유 |
| 혼합 미디어 export | `src/exporters/prepareCloudRequest.js:114,183`, `src/utils/sceneMedia.js:21` | 실사=base image, i2v=overlay |
| durable store 패턴 | `electron/story/storyStore.js` → `shoppingPlanStore` 미러 | plan snapshot/hash/journal |
| 스텝퍼 UI | `StoryStepper.jsx`(props 주도) | 다른 STEP_ORDER 로 그대로 렌더 |

## 물질화·게이트·혼합 규칙 (합의)
- `product_still`: 크롤→로컬 저장 실사 이미지를 `imagePath`. **생성 호출 0회**, 영상·음성 없음.
- `persona_i2v`: 한국인 인물 시작 이미지 base → Veo i2v 결과 overlay. **Veo 네이티브 한국어 대사(음소거 금지).**
- plan 수정 시 승인 hash·물질화 revision·기존 생성/검수 결과 전부 stale.
- `approvedHash===currentPlanHash` + renderer 저장 ack 둘 다 맞아야 유료 생성 IPC 허용(스펙 D5.3/D7 그대로).

## MVP 최소 경로 (양쪽 동일)
1. 새 프로젝트 `shopping-short` + `9:16`. MVP=API 모드·쿠팡 URL 1개·CapCut 만.
2. `safeHttpFetch`→`parseCoupangProduct`→상품/이미지/sourceFacts, 이미지 로컬 저장.
3. 사용자 A(허용 사실)/B(금지 주장) 확정. page-asserted 자동 승격 안 함.
4. 단일 한국인 persona + 고정 템플릿, 5~8씬, `<60초` canonical plan.
5. 씬표(visualType/실사asset/대사·자막/claim/4·6·8초) 확인+명시 승인.
6. 승인 hash 저장→물질화. 제품 씬 생성 0회, 인물 씬만 이미지→Veo i2v.
7. 프레임 검수 + Veo 대사 인간 검수 통과 후 `storyAudio=null`/`audioPackage=null` CapCut export.
8. **U4 실물 검증**: CapCut cloud/GCF overlay 가 별도 `sourceAudio` 필드 없이 Veo 원음 보존하나? 실패면 GCF
   크로스레포 계약 확장이 MVP 완료 조건.

UI 최소: 새 뷰 골격 대신 **프로젝트에 shopping 마커 있으면 StoryView 자리에 ShoppingPanel 렌더.**

## 신규로 지어야 할 것
`electron/shopping/planMachine.js`(작은 상태머신 6상태 + shoppingPlanStore), plan validator/canonical hash(D5),
크롤→사실확인 UI, 씬표 승인 UI, 대사 검수 UI, 페르소나 한국어 프롬프트 빌더, project.workflowType 필드.
중복 위험: stepMachine wrapper 관습(operationId/token emit, controller 상호배제, 원자 저장) 재구현 — 수백 줄,
2702줄 머신에 도메인 두 개 동거보다 쌈.

## 이 설계가 틀릴 수 있는 지점 (양쪽 동일)
쇼핑 숏츠가 "증거 모델"이 아니라 그냥 또 하나의 스토리텔링 장르(리서치·TTS 나레이션·긴 대본)로 진화하면
(b) 4번째 장르가 맞았던 게 되고 (c) 별도 머신은 유지비만 남는다. → **MVP 는 증거 모델로 못박고 진행.**
