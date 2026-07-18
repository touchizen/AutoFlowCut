# YouTube 리서치 스텝 설계 (Spec)

> 상태: 설계. 작성 2026-07-07. **2026-07-07 개정: 자막·검색을 yt-dlp로 전면 전환**(아래 §0.1).
> 이 문서는 **구현 spec만** 정의한다. 코드는 포함하지 않는다.
> 근거는 실제 코드베이스(파일 경로 명시) + S0 실증 결과.

---

## 0.1 개정 이력 — S0 실증 후 자막·검색 방식 전환 (2026-07-07)

**S0 스파이크 실증 결과**: 초안의 "백그라운드 `WebContentsView` + `executeJavaScript` 5단 폴백(innertube get_transcript / poToken timedtext 스니핑)" 방식은 **실패**했다.
- ① innertube `get_transcript` POST → **HTTP 400 `FAILED_PRECONDITION`**(API key 유무·clientVersion 위조·ytcfg 컨텍스트 전부 무관하게 실패). YouTube가 이 내부 엔드포인트에 추가 precondition(SAPISID/봇 신호 등)을 요구.
- ② poToken 스니핑 → offscreen-attach + `video.play()`로 **재생은 실제로 개시됐으나(오디오 누출로 확인)** `performance` 리소스 엔트리에서 pot이 안 잡히거나 timedtext가 empty 반환. DOM "스크립트 표시" 패널도 프로그램 클릭으로 안 열림(YouTube 실험 UI `PAmodern_transcript_view`).
- **대조로 `yt-dlp`는 완벽 취득**: `yt-dlp --write-subs --write-auto-subs --sub-langs ko,en --skip-download --sub-format srv3` → 재생·poToken 불필요, 봇차단 자체 처리, 수동/자동생성 자막 모두 `<id>.<lang>.srv3` 파일로 저장. 검색도 `yt-dlp "ytsearchN:키워드" --flat-playlist --print` → 조회수·제목·채널·videoId·썸네일 취득.

**전환 결정**:
- 자막 취득: `WebContentsView`/poToken/offscreen-attach/5단 폴백/`makeResearchView` **전면 폐기** → **`yt-dlp` child_process** (`electron/api/youtube/fetchTranscript.js` + `ytDlp.js`).
- 검색: **YouTube Data API v3 / API key(BYOK) / keychain / quota 전면 폐기** → **`yt-dlp ytsearchN`** (`electron/api/youtube/searchVideos.js`).
- 파서: HTML split·pot 스니핑 파서 폐기 → **yt-dlp 출력(srv3 XML / WebVTT) 파서**(`electron/api/youtube/transcriptParse.js`, 순수).
- **유일한 외부 의존 = 시스템 `yt-dlp` 바이너리**(PATH 해석, 부재 시 `binary-not-found` 에러 + 설치 안내). YouTube key/쿠키/파티션/봇차단 수동개입 관련 결정 전부 무효.
- 초안의 D6/D7/D8/D17(자막 방식·폴백·세션), D5(검색 키), §3.1/§3.3/§3.7, 부록 B(취약성)는 아래 개정본으로 **대체**되며, 원문은 "S0에서 폐기된 접근"의 기록으로만 남긴다.

아래 표/섹션에서 **[폐기]** 표시는 S0 실증으로 무효화된 초안 결정, **[개정]**은 yt-dlp 전환 반영이다.

---

## 0. 목표 (한 줄)

키워드로 YouTube 인기 영상을 검색·선택하고 그 자막을 취득·구조분석·팩트체크해서 **검증된 시놉시스 컨텍스트**를 만든 뒤, 기존 시놉시스 스텝의 입력으로 주입하는 **선택적 리서치 스텝**을 시놉시스 앞에 추가한다.

---

## 1. 확정된 설계 결정 (표)

| # | 결정 | 값 | 근거 |
|---|---|---|---|
| D1 | 스텝 번호 체계 (UI) | `0 설정 · 1 리서치 · 2 시놉시스 · 3 시나리오 · 4 씬분리 · 5 오디오 · 6 프롬프트` | 시놉시스가 §v2.12 B에서 게이트인데 정식 번호(①)를 받은 패턴을 미러. 리서치도 동일. `src/components/story/StoryStepper.jsx` |
| D2 | 스텝머신 코어 변경 여부 | **불변** — `STEP_ORDER=['script','scenes','audio','prompts']`, `DOWNSTREAM` 그대로 | 리서치/시놉시스는 실행 스텝이 아니라 side action + UI 게이트. `electron/story/stepMachine.js:18`, `StoryStepper.jsx:9` |
| D3 | 리서치 실행 형태 | **side action** (`researchSearch`/`researchFetchTranscripts`/`researchAnalyze` 등 machine 메서드) — step status 불변 | `generateSynopsis`/`confirmSynopsis` side action 패턴 미러. `stepMachine.js:1141,1190` |
| D4 | **[개정]** 영상 검색 | **`yt-dlp "ytsearchN:키워드" --flat-playlist --print`** — id/title/view_count/channel/duration/thumbnail. ytsearch=관련성순이라 넉넉히(N=maxResults×3) 받아 view_count desc 정렬 후 상위 10개(§Q4) | S0 실증. ~~Data API v3~~ 폐기, quota·key 불요. `electron/api/youtube/searchVideos.js` |
| D5 | **[폐기]** 검색 키 저장 | ~~keyStoreMulti youtube provider~~ → **제거**. yt-dlp는 API key 불요 | Data API 폐기로 무효 |
| D6 | **[개정]** 자막 취득 방식 | **`yt-dlp` child_process**(`--write-subs --write-auto-subs --sub-langs ko,en --skip-download --sub-format srv3/json3/vtt/best`). 재생·poToken 불필요, 봇차단 yt-dlp 자체 처리 | S0 실증(§0.1). ~~WebContentsView/poToken/offscreen-attach/makeResearchView~~ 전면 폐기. `electron/api/youtube/fetchTranscript.js` + `ytDlp.js` |
| D7 | **[폐기]** 자막 폴백 체인 | ~~① innertube get_transcript → ② poToken timedtext → ③ baseUrl → ④ DOM~~ → **yt-dlp 단일 경로**(내부적으로 다중 클라이언트 폴백 처리) | S0에서 innertube 400 `FAILED_PRECONDITION`·pot 스니핑 실패 확인 |
| D8 | **[폐기]** main node fetch 직접 innertube | ~~비채택~~ → 무효(innertube 자체 폐기) | — |
| D9 | **[개정]** 자막 파서 / SRT 변환 | **순수 함수 모듈**(DOM·Electron·yt-dlp 의존 0, Node 단위테스트). 입력이 **yt-dlp 출력(srv3 XML / WebVTT)**. `pickCaptionTrack` 폐기(언어 선택은 yt-dlp `--sub-langs` + 파일명 lang 판정) | `netflix-srt` `srt.js` 패턴. srv3 `<p t d>텍스트`/`<p><s>단어` + vtt cue → 세그먼트 → SRT/텍스트. `electron/api/youtube/transcriptParse.js` |
| D10 | 구조 분석 | LLM(스토리 라우터, Claude/Codex 공통 — **양 어댑터 모두 `analyzeResearch` 구현 필수**, N1) — 선택된 다수 자막 종합해 공통 구조·논점 추출 | 기존 `structuredClaudeCall`/`structuredCall` JSON 출력 패턴. `llmClaude.js:166`, `llmGemini.js:111`. 라우터 등록 메서드는 부재 시 throw(`storyLlmRouter.js:27`) |
| D11 | 팩트체크 웹검색 | **Claude Agent SDK `WebSearch` 내장 도구** (`buildClaudeSdkOptions`의 `tools:[]`를 sdkExtra로 `['WebSearch']` 오버라이드). **팩트체크 스텝만 Claude 강제**(다른 스텝은 선택 엔진 유지), **라우터 우회 직접 호출**(M1) | Q1 확정. SDK 0.3.199 `WebSearch`(`sdk-tools.d.ts:749`), Options.tools는 `string[]`(`sdk.d.ts:1379`). Codex는 `webSearchMode:'disabled'` 하드코딩(`codexSdk.js:98`) |
| D12 | 리서치→시놉시스 연결 | **수동 주입**: 시놉시스 게이트 UI "리서치 컨텍스트 포함" 토글 + `generateSynopsis params.useResearch:true`일 때만 research.json 로드해 `opts.research`로 주입 | Q5 확정(자동 아님, M2). `stepMachine.js:1141` generateSynopsis, `prompts.js:84` buildSynopsisPrompt |
| D13 | 리서치 결과 영속 | fetch 완료 즉시 `research.draft.json`(자막+선택 메타) durable, commit 시 `research.json`(구조+팩트). `open()`/`getState()` hydrate에 research 상태 포함 | M6. machine은 story:open마다 재생성(`story-api.js:86`)이라 재오픈 유실 방지 필수. `storyStore` saveText/loadText(`storyStore.js:59-61`) |
| D14 | 리서치 선택성 | 신규 리서치 스텝은 **완전 선택(opt-in)** — 사용자가 안 쓰면 시놉시스 게이트는 현행 그대로 | 게이트 회귀 방지. legacy/imported 프로젝트 불변 |
| D15 | 검색 결과 개수 | **상위 10개** | Q4 확정 |
| D16 | **[개정]** 자막 언어 우선순위 | **한국어 → 영어 → 자동생성(asr)** — yt-dlp `--sub-langs ko,en` + `--write-auto-subs`(수동 우선, 없으면 자동). 취득 파일명 `<id>.<lang>.<ext>`의 lang으로 최우선 트랙 선택 | Q3 확정. ~~pickCaptionTrack~~ 불요 |
| D17 | **[폐기]** webContents 세션 | ~~익명 격리 persist:yt-research + 봇차단 로그인 폴백~~ → 무효(webContents 자체 폐기). yt-dlp가 봇차단 자체 처리, 쿠키 불요 | webContents 폐기로 무효 |
| D18 | **[신규]** yt-dlp 바이너리 | 시스템 PATH(`which`/`where`) 우선 + 알려진 위치(homebrew/pyenv shim 등) 탐색. 부재 시 `binary-not-found` 에러 + 설치 안내. 앱 번들 동봉은 후속 | 유일한 외부 의존. `electron/api/youtube/ytDlp.js` |

---

## 2. 아키텍처

### 2.1 스텝 배치 (코어 무손상 원칙)

스텝머신 코어(`electron/story/stepMachine.js`)의 `STEP_ORDER`/`DOWNSTREAM`은 **건드리지 않는다**. 시놉시스가 §v2.12 B에서 확립한 패턴을 그대로 따른다:

- **코어**: 리서치는 실행 스텝이 아니라 machine의 **side action 메서드**. step status(`state.steps`)를 만들지 않으므로 `start()`의 busy 가드(`previewing || synopsisController || steps.some(running)`)와 동일하게 `researchController` 뮤텍스만 추가.
- **UI**: `StoryStepper.jsx`에 `RESEARCH_KEY='research'`, `RESEARCH_META={ icon:'①', label:'리서치' }` 자리를 항상 렌더. 시놉시스는 ②로 밀린다. 활성/비활성은 prop(`researchEnabled`)이 가른다(시놉시스 `synopsisEnabled` 미러). 미사용/legacy는 회색 비활성.

```
StoryStepper 렌더 순서(§D1):
[0 설정] [① 리서치] [② 시놉시스] [③ 시나리오] [④ 씬분리] [⑤ 오디오] [⑥ 프롬프트]
  진입탭    게이트      게이트       script      scenes     audio      prompts
 (배지無)  (배지無)    (배지無)    ←── 코어 실행 스텝(status 배지) ──→
```

번호가 §v2.12 B에서 `script=②..prompts=⑤`였던 것이 리서치 삽입으로 `script=③..prompts=⑥`로 한 칸씩 밀린다. `STEP_META`의 icon만 갱신(라벨/키 불변).

### 2.2 main · renderer 분리

```
┌─ RENDERER (src/) ────────────────────────────────────────────┐
│ StoryView.jsx  (리서치 phase 렌더: 키워드 입력·카드그리드·선택·URL추가) │
│ useStoryPipeline.js (리서치 side action 호출 + story:research-* 구독) │
│ StoryStepper.jsx (① 리서치 pill)                              │
│ ResearchPanel.jsx (신규 — 카드그리드/자막상태/구조·팩트 표시)      │
│ (설정 YouTube key 탭 없음 — yt-dlp는 key 불요, §3.7 폐기)      │
└──────────────────────────────┬───────────────────────────────┘
                    IPC (preload.js 브릿지)
┌──────────────────────────────┴───────────────────────────────┐
│ MAIN (electron/)                                              │
│ ipc/story-api.js  (story:research-* 핸들러, guarded)          │
│ story/stepMachine.js  (researchSearch/FetchTranscripts/Analyze/│
│                        FactCheck/commit side actions)         │
│ api/youtube/searchVideos.js (신규 — yt-dlp ytsearchN 검색)     │
│ api/youtube/fetchTranscript.js (신규 — yt-dlp 자막 취득 오케)   │
│ api/youtube/transcriptParse.js (신규 순수 — srv3/vtt           │
│         → 세그먼트 → SRT/텍스트)                                │
│ api/youtube/ytDlp.js (신규 — yt-dlp 경로 해석 + child_process)  │
│ api/llm/prompts.js (buildResearchAnalyzePrompt/FactCheckPrompt)│
│ api/llm/{llmClaude,llmCodex}.js (analyzeResearch 양쪽 필수 N1; │
│                          factCheckClaims는 llmClaude만·DI주입)  │
└──────────────────────────────────────────────────────────────┘
```

**[개정] 전제**: 자막·검색은 **시스템 `yt-dlp` 바이너리를 main에서 `child_process`로 실행**한다. WebContentsView·poToken·offscreen-attach·makeResearchView·봇차단 수동개입·youtube key/파티션은 **전부 폐기**(§0.1 S0 실증). main process는 view를 안 만들고, yt-dlp가 자막 파일(srv3/vtt)을 임시 폴더에 받아오면 순수 파서로 세그먼트/SRT/평문을 만든다. 유일한 외부 의존은 yt-dlp 바이너리(부재 시 `binary-not-found` 에러).

---

## 3. 컴포넌트별 변경

### 3.1 자막 취득 — `electron/api/youtube/fetchTranscript.js` + `ytDlp.js` (신규) — **[개정] yt-dlp**

핵심 원리: **시스템 `yt-dlp`가 재생·poToken 없이 자막 파일을 취득**한다. yt-dlp는 다중 innertube 클라이언트·봇차단 우회를 내부적으로 유지보수하므로, YouTube 프론트엔드 변경에 대한 취약성이 yt-dlp 커뮤니티로 이관된다(초안의 HTML split·pot 스니핑 취약점 소멸).

**바이너리 경로 해석(`ytDlp.js`, D18)**: `resolveYtDlpPath()` — 시스템 PATH(`which`/win32 `where`) 우선, 실패 시 알려진 위치 탐색(`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.local/bin`, `~/.pyenv/shims`). 발견 캐시. 부재 시 `runYtDlp`가 `Error('binary-not-found')`. Electron GUI 앱은 로그인 셸 PATH가 없을 수 있어 **절대경로**로 `execFile` 실행한다. 타임아웃 시 `Error('timeout')`.

**오케스트레이터(`fetchTranscript.js`, main node 컨텍스트)**:
1. 임시 폴더(`mkdtemp`) 확보.
2. `runYtDlp(buildYtDlpSubArgs({ videoId, outDir, langs:['ko','en'] }))` 실행 — 인자:
   `--write-subs --write-auto-subs --skip-download --sub-langs ko,en --sub-format srv3/json3/vtt/best --no-warnings -o <outDir>/<id>.%(ext)s https://www.youtube.com/watch?v=<id>`.
3. 임시 폴더의 자막 파일(`<id>.<lang>.<ext>`) 중 **언어 우선순위(ko→en, §D16)**에 맞는 최우선 파일 선택(`pickSubFile` — 파일명 lang/ext 판정, `-orig` 접미면 auto). 없으면 `no-transcript`.
4. 파일 읽어 순수 파서(`parseSubtitle`)로 세그먼트 → SRT/평문.
5. 자체 생성한 임시 폴더는 `finally`에서 정리.

**abort/타임아웃**: yt-dlp는 `execFile` timeout으로 자연 종료(SIGTERM → `Error('timeout')`). 진행 중 취소는 프로세스 kill(후속 슬라이스에서 child handle 노출). LRU 캐시(videoId→transcript, TTL 1h)는 후속.

**반환 계약**: `{ videoId, ok, lang, isAuto, format:'srv3'|'vtt', segments:[{start,dur,text}], srt, plainText }` 또는 `{ videoId, ok:false, error:'binary-not-found'|'timeout'|'no-transcript'|'parse-failed'|'read-failed' }`.

> `isAuto`는 파일명 `-orig` 접미/힌트로만 판정하는 best-effort다(수동/자동만 있고 둘 다 없는 영상은 파일명이 동일 `<id>.<lang>.srv3`이라 구분 불가). 취득 성공·언어 우선순위가 본질이고 isAuto는 정보성이다.

### 3.2 자막 파싱/변환 — `electron/api/youtube/transcriptParse.js` (신규, 순수 함수) — **[개정] srv3/vtt**

DOM·Electron·yt-dlp 의존 0. 입력이 yt-dlp 출력(srv3 XML / WebVTT). `netflix-srt` `srt.js` SRT 변환 패턴 이식.

- `parseSrv3(xml)` — `<timedtext format="3">`의 `<p t="ms" d="ms">`. **수동**은 p 직접 텍스트, **자동생성**은 `<p><s ac>단어</s><s t>단어</s></p>` 조각 join. 빈 append 세그먼트(`<p a="1">\n</p>`)는 텍스트 필터로 제외. 엔티티 디코드(`&#39;` 등).
- `parseVtt(vtt)` — WebVTT cue(`HH:MM:SS.mmm --> HH:MM:SS.mmm`) 블록. NOTE/헤더/빈 cue 무시, 개행 합침, inline 타이밍 태그 제거.
- `parseSubtitle(content, formatHint)` — hint(srv3/vtt) 또는 내용 스니핑(`WEBVTT`/`<timedtext`)으로 분기. 빈/깨진 입력 → `[]`.
- `segmentsToSrt(segments)` — `,` 소수점, 1-base 인덱스, `start+dur=end`(dur 없으면 다음 시작/마지막 +3초 보정). `msToSrtTime`.
- `segmentsToPlainText(segments)` — 공백 join + 다중공백 정리.

세그먼트 계약: `{ start:<ms>, dur:<ms>, text }`. (문단 병합 `mergeSegmentsToParagraphs`·`pickCaptionTrack`는 폐기 — 언어 선택은 yt-dlp `--sub-langs`가, 병합은 후속 슬라이스 필요시.)

### 3.3 영상 검색 — `electron/api/youtube/searchVideos.js` (신규) — **[개정] yt-dlp**

`ytDlp.js`의 `runYtDlp` 재사용. **YouTube Data API v3 / API key / quota 전면 폐기** — yt-dlp 검색만.

- `searchVideos({ query, maxResults=10, fetchCount, dateFilter='none' }, { runYtDlp })` (§Q4 — 기본 상위 10개, **개선1: maxResults UI 지정 10/20/30**):
  1. `runYtDlp(['ytsearch<N>:<query>', '--flat-playlist', '--skip-download', '--no-warnings', '--print', '<view_count>␟<title>␟<channel>␟<id>␟<duration>␟<thumbnail>'])` (N=fetchCount 또는 maxResults×3 — ytsearch는 관련성순이라 여유분 취득. 구분자 = U+001F).
  2. `parseSearchLines(stdout)` — 줄당 1영상, 구분자 분해 → `{ videoId, title, channelTitle, viewCount, durationSec, thumbnailUrl }`. 필드 부족/`id=NA` 라인 스킵. view_count 비숫자 → 0. **썸네일 폴백(2026-07-08 실앱 확인)**: flat-playlist는 thumbnail이 NA/빈값인 경우가 많다 — `https://i.ytimg.com/vi/<id>/hqdefault.jpg` 표준 URL로 채워 소스 레벨에서 보장(카드 렌더도 동일 폴백 이중 방어).
  3. `sortByViewCount(videos, maxResults)` — **조회수 desc 정렬 후 상위 maxResults**(순수, 원본 불변). §Q4.
- **[개선2, 2026-07-08 / R1 보강] 일자 필터 `dateFilter`(none|week|month)**: flat-playlist는 `upload_date`를 안 준다(NA 확인). `week`/`month`면 ① **`ytsearchdate<N>:` pool**(업로드일순 — R1 m1: 조회수 상위 옛영상이 후보를 독점해 최근 영상이 잘리는 최신성 편향 제거)에서 조회수 상위 후보만(`min(maxResults×2, 30)` — R1 M3 상한, R1 m6: `SAFE_VIDEO_ID` 검증 후 URL 템플레이팅) ② **단일 yt-dlp 상세조회**(후보 watch URL 나열 + `--print '<id>␟<upload_date>'`, 비 flat, **timeout=후보수×5000ms** — R1 M3 스케일)로 upload_date 취득 → ③ 컷오프(`now-7d`/`now-30d`, UTC YYYYMMDD, 경계 포함) 이후만 필터 → 상위 maxResults(+`uploadDate` 메타 부착). **상세조회 실패/타임아웃 시 검색 전멸 방지 — flat 조회수 상위 폴백**(R1 M3, error 아님). **R2 MINOR: 폴백 시 결과에 `dateFilterFallback:true`를 실어**(dateFilter가 조용히 무시됨을 UI에 알림) `researchSearch` 반환→ResearchPanel이 "기간 필터를 적용하지 못해 전체 결과를 표시합니다" 안내(transient — 다음 성공 검색에서 해제, locale ko/en). 순수함수 분리: `dateFilterCutoff` / `parseUploadDateLines` / `filterByUploadDate`. 상세조회는 느리므로 **필터 선택 시에만** 실행(UI가 느림 힌트 표시). `none`(기본)은 현행 flat(`ytsearch`) 1회 호출 그대로. maxResults는 IPC에서 1~50 클램프(R1 m5).
- 에러: 빈 쿼리 → `{ error:'empty-query' }`(yt-dlp 미호출). yt-dlp 미설치 → `{ error:'binary-not-found' }`. 기타 → `{ error:<message> }`.
- `parseVideoIdFromUrl(url)`(수동 추가 보조 — watch?v=/youtu.be//shorts/)는 후속 슬라이스에서 추가(썸네일은 카드가 yt-dlp thumbnailUrl 사용).

> **자막 원문 재배포 금지는 §7 그대로.** 검색·자막 모두 yt-dlp 단일 의존이라 초안의 "검색 공식 API + 자막 비공식" 하이브리드 긴장은 소멸. ToS 회색지대(비공식 접근)는 여전하므로 §7 고지 유지.

### 3.4 구조 분석 — LLM (`llmClaude.js`/`llmCodex.js` + `prompts.js`)

`structuredClaudeCall`(`llmClaude.js:166`)/`structuredCall`(`llmGemini.js:111`) 패턴으로 JSON 출력. 신규 스키마 `RESEARCH_ANALYSIS_SCHEMA`(`electron/api/llm/schemas.js`에 추가).

- `analyzeResearch(transcripts, opts, ctx)` — 선택된 다수 자막(각 plainText)을 하나로 종합해 **공통 서사 구조 + 핵심 논점/주장**을 추출. 교차검증 흡수(여러 영상에 공통으로 나오는 논점 가중).
- 프롬프트 `buildResearchAnalyzePrompt(transcripts, opts)`(`prompts.js` 신규) — 출력: `{ structure:[{beat, summary}], claims:[{ claim, sources:[videoId] }], commonThemes:[...] }`.
- 라우터 배선: **구조 분석만** `storyLlmRouter.js`의 `METHOD_OPTION_INDEX`에 `analyzeResearch` 추가(선택 엔진 — Claude/Codex 공통). **라우터 등록 메서드는 두 어댑터 모두 구현 필수**(N1) — `wrapMethod`(`storyLlmRouter.js:22`)가 `adapter[method]` 부재 시 "does not implement analyzeResearch" throw(라인 27). 기존 generateScript/splitScenes 등 전부 llmClaude·llmCodex 양쪽에 있는 것과 동일하게 **`llmCodex.analyzeResearch`도 반드시 구현**(구조분석은 웹검색 불요라 Codex 가능). **`factCheckClaims`는 라우터에 넣지 않는다**(M1 — 아래 §3.5).

### 3.5 팩트체크 — Claude Agent SDK `WebSearch` (`llmClaude.js` + `claudeSdk.js`) — **팩트체크 스텝만 Claude 강제**

**핵심 제약**: 팩트체크는 LLM 내장 웹검색이 필요한데, Codex는 `codexSdk.js:98`에서 `webSearchMode:'disabled'`/`webSearchEnabled:false` 하드코딩이라 **불가**. Gemini 어댑터는 스토리 라우팅 대상이 아님(`llmGemini.js:85` 주석 "프로덕션 라우팅 대상 아님"). 따라서 **팩트체크 스텝만 Claude 강제**(Q1 확정 — 다른 스텝은 사용자 선택 엔진 유지).

- **라우터 우회 + DI seam(M1 + N4, 필수)**: `factCheckClaims`를 `storyLlmRouter.js`의 `METHOD_OPTION_INDEX`에 **넣지 않는다**. 라우터에 넣으면 `wrapMethod`가 `normalizeStoryLlmOptions`를 태우는데, 이 함수는 engine/model 조합을 검증해 없으면 throw한다(`src/utils/storyLlmCatalog.js` `normalizeStoryLlmOptions`: "Unknown Story LLM option: engine:model"). Codex opts에 `engine:'claude'`만 덮으면 `claude:gpt-5.5`(카탈로그에 없음) → 크래시.
  - **DI seam 보존(N4)**: stepMachine은 현재 모든 LLM을 주입된 `llm`(라우터)로만 호출하고 llmClaude를 직접 import하지 않는다(`stepMachine.js:13-14`엔 llm import 없음). 라우터를 우회하되 **static import는 피한다** — `createStepMachine` deps에 **`factCheck` 어댑터(=llmClaude.factCheckClaims)를 추가 주입**한다(`createStepMachine({..., factCheck})`, `story-api.js`/`main.js` 배선에서 `llmClaude.factCheckClaims` 바인딩 주입). machine은 `factCheck(claims, opts, ctx)`를 호출 → S7 통합테스트가 mock factCheck를 주입해 mockability 확보.
  - opts는 **강제 Claude 조합**으로 명시 구성(N5 — `{...DEFAULT_STORY_LLM}` 스프레드 금지: id/label/reasoningEfforts 잉여필드가 실려 오해 소지): `{ engine:'claude', model:'claude-opus-4-8', reasoningEffort:'off' }` 같이 **필요 필드만 명시**. 사용자가 고른 engine/model은 팩트체크에선 무시.
- `buildClaudeSdkOptions`(`claudeSdk.js:7`)는 현재 `tools: []`로 모든 내장 도구를 차단한다. 이 함수는 `...sdkExtra`를 마지막에 스프레드하므로, 호출부에서 `{ tools:['WebSearch'] }`를 extra로 넘기면 오버라이드된다.
  - 근거: Options.tools 타입은 `string[] | {type:'preset'}`(`sdk.d.ts:1379`), `WebSearch`는 SDK 0.3.199 내장(`sdk-tools.d.ts:749`).
  - `maxTurns: 2`도 팩트체크는 웹검색 왕복이 필요하므로 sdkExtra로 상향(예: `maxTurns: 8`) — 검색→읽기→판정.
  - `settingSources:[]`/`skills:[]`는 유지(오염 차단).
- `factCheckClaims(claims, opts, ctx)`(`llmClaude.js` 신규 export, machine엔 `factCheck` deps로 주입) — 각 claim을 웹검색으로 확인 → `{ claim, verdict:'supported'|'refuted'|'unverified', evidence:[{url,note}] }`. **verified(supported)만** 최종 컨텍스트에 채택.
- 프롬프트 `buildFactCheckPrompt(claims, opts)`(`prompts.js` 신규).
- **`llmCodex.factCheckClaims` / `error:'engine-unsupported'`는 만들지 않는다**(M1) — 팩트체크는 항상 Claude 강제라 엔진 미지원 분기 자체가 불필요. `research-factcheck` side action은 어떤 엔진 선택에서도 Claude로 실행된다.

### 3.6 UI — `src/components/story/ResearchPanel.jsx` (신규) + `StoryView.jsx`

**phase 상태 모델(MINOR 9, 인용 정정 N6)**: `StoryView.jsx`는 현재 `scriptPhase` enum(`setup`/`synopsis`/`editor`, 초기값 `320`, `stepperActive` 매핑 `393-394`, `synopsisEnabled` `402`)으로 대본 탭의 하위 화면을 가른다. 리서치는 여기에 **`'research'` 값을 추가**한다(별도 displayStep 신설 대신 scriptPhase 확장 — 시놉시스와 동일 게이트 계층). `stepperActive`(라인 393-394) 매핑에 `scriptPhase==='research' → 'research'` 추가. **`researchEnabled` 소스**: 시놉시스 `synopsisEnabled`(라인 402) 미러 — `scriptPhase==='research'` 이거나 (`input.type ∈ {title,pasted}` 이고 신규 프로젝트). legacy(`charactersConfirmed===undefined`)/imported(`type ∉ {title,pasted}`)는 회색 비활성(리서치는 신규 title/pasted 흐름에서만 활성).

**게이트 누출 방지(N2, 필수)**: `scriptPhase='research'`도 `displayStep`을 'script'로 강제한다(라인 389-391 — scriptPhase가 있으면 displayStep='script'). 그런데 하단 제네릭 컨트롤 suppression(라인 1662)은 `!(displayStep === 'script' && (scriptPhase === 'editor' || scriptPhase === 'synopsis'))`로, **research가 빠져 있어 리서치 phase에서 하단 [시나리오 생성]/primary가 노출돼 게이트가 우회된다**(시놉시스가 라인 1662에 'synopsis'를 넣어 막은 것과 동일 — 안 넣으면 회귀). → **라인 1662 suppression 조건에 `scriptPhase === 'research'`를 추가**: `!(displayStep === 'script' && (scriptPhase === 'editor' || scriptPhase === 'synopsis' || scriptPhase === 'research'))`. S9 테스트에 "research phase에서 하단 제네릭 컨트롤 미노출" 케이스 포함.

시놉시스 phase 렌더(`StoryView.jsx:1062` `scriptPhase === 'synopsis'`) 미러로 `scriptPhase === 'research'` 렌더 추가:
- **키워드 입력** → `researchSearch` 호출 → **영상 카드 그리드**(썸네일·제목·조회수·채널·업로드일, 체크박스 선택). 기본 10개(D15). **[개선1, 2026-07-08] 검색 개수 선택(10/20/30)** + **[개선2] 업로드 기간 드롭다운(전체/최근 1주일/최근 30일)** → `researchSearch({keyword, maxResults, dateFilter})`(dateFilter는 '전체'가 아닐 때만 전달 — §3.3 상세조회 분기, 느림 힌트 표시).
- **썸네일 폴백(필수, 2026-07-08)**: 카드 img는 `thumbnailUrl || https://i.ytimg.com/vi/<id>/hqdefault.jpg` — videoId만 있으면 무조건 렌더(flat 검색의 NA 썸네일 대응, §3.3과 이중 방어).
- **[개선3, 2026-07-08 / R1 M4·m2] 언어 필터(하이브리드)**: ① 순수함수 `filterByLang(videos, lang)`(ResearchPanel export) — 프로젝트 언어 기준 제목/채널 문자셋 1차 필터(ko=한글 포함, en=한글 없이 라틴). 전부 불일치면 필터 해제(빈 그리드 방지) + "언어 불일치 N개 숨김" 힌트. **숨기려는 카드라도 이미 선택된 것은 표시**(R1 m2 — 안 보이면 해제 불가 + fetch에 계속 포함되는 "보이지 않는 선택" 방지). ② **자막 언어 배지**: fetch가 취득한 실제 자막 lang이 설정 언어와 다르면 "한국어/영어 자막 없음" 배지. **근본 정확성(R1 M4)**: `researchFetchTranscripts`가 **프로젝트 언어를 자막 1순위**로 `fetchTranscript(videoId, { langs:[language,'ko','en'] })` 전달 — 안 하면 ko 고정이라 en 프로젝트에서 ko 자막이 잡혀 배지 거짓 + 분석이 다른 언어 자막으로. StoryView가 fetch에도 `currentOptions()`(언어)를 실어 배선.
- **URL 수동 추가** 입력(보조) → `parseVideoIdFromUrl` → 카드로 추가.
- **[개선5, 2026-07-08 / R1 M2·m4] [한꺼번에 분석]**: 기존 3버튼([자막 가져오기]/[구조분석]/[팩트체크])은 유지하고, 추가 버튼 1개가 선택 영상으로 `researchFetchTranscripts → researchAnalyze → researchFactCheck`를 **renderer에서 순차 await** 실행(main 신규 side action 없음 — 기존 액션 재사용). 단계 칩(자막→분석→팩트체크) 하이라이트 + videoId별 fetch 진행 배지 + `ElapsedTime`(StopwatchIcon) 총 경과시간. **자막 abort(부분성공 `{aborted:true}`) 시 다음 단계로 진행하지 않는다**(R1 M2 — fetch가 abort 시 반환에 `aborted:true`를 실어 auto 핸들러가 `error||aborted` 검사). claims 없으면 팩트체크 건너뛰고 완료하되 **팩트체크 칩은 'done'이 아니라 'skipped'로 구분 표기**(R1 m4). 중간 `{error}` 시 중단·에러 배너. 진행 중 개별/한꺼번에 버튼 모두 disable(단일 busy). **개별 액션 시작 시 이전 auto 진행 패널 클리어**(R1 m4 — 완료 패널 잔류 방지).
- 선택 확정 → `researchFetchTranscripts`(자막 취득 진행 표시: videoId별 상태 running/done/error, `story:progress` step-log 패턴 `stepMachine.js:147` 재사용). **취소 버튼(MINOR 4)**: 자막 취득은 최대 10개×수분이 걸릴 수 있으므로 진행 중 취소 버튼 필수 → `abort()` → machine이 `researchController.abort()` + `webContents.stop()`(§3.1 취소 처리).
- 자막 취득 후 → `researchAnalyze`(선택 엔진) → 구조/논점 표시 → `researchFactCheck`(Claude 강제, §3.5) → 검증 사실 표시.
  - **[개선4, 2026-07-08 / R1 B1·m3·M1] 팩트체크 채택 체크박스**: verdict 배지와 함께 각 주장에 채택 체크박스(기본 supported=체크, unverified/refuted=미체크). 채택은 **인덱스 기반**(R1 m3 — 동일 claim 문자열이 중복돼도 개별 토글, includes 중복 버그 방지). 커밋 시 `adoptedIndices`(체크된 인덱스 배열)를 전달 — machine `researchCommit`은 배열이 오면 `all.filter((_,i)=>adoptedIndices.includes(i))`가 명시 소스(미검증/반박 채택 가능, 해제한 supported 제외), **미전달이면 기존 supported만(기본 동작 회귀 유지)**. 채택 리셋은 배열 identity가 아닌 **내용 키(claim+verdict)** 기반(R1 M1 — researchSelect의 research-state emit로 새 배열이 와도 내용이 같으면 리셋 안 함). **B1(R1) 프롬프트 신뢰**: `buildResearchBlock`은 `research.json.verifiedClaims`(commit이 이미 큐레이션한 채택 목록)를 verdict 재필터 없이 그대로 [검증된 사실]로 주입 — 재필터하면 채택한 비-supported가 프롬프트에서 탈락해 개선4가 no-op이 된다.
- **[리서치 사용] 확정** → `commitResearch`(research.json 저장) → 시놉시스 phase로 진입.
  - **수동 주입(M2, Q5)**: commit은 리서치 결과를 저장할 뿐, 자동 주입하지 않는다. 시놉시스 게이트 UI에 **"리서치 컨텍스트 포함" 토글**을 두고, 켠 상태에서 시놉시스 생성 시 `generateSynopsis({ useResearch:true })`로 호출한다. 토글 off면 research.json이 있어도 주입 안 함.
- **[건너뛰기]** → `researchSkip`(draft 정리) → 리서치 미사용, 기존 시놉시스 게이트 그대로.
- **[폐기] 봇차단 수동 개입(M3)**: yt-dlp가 봇차단을 자체 처리하므로 view 표시/로그인 수동개입 없음. yt-dlp 실패 시 `no-transcript`/`binary-not-found` 에러 배지만.

`StoryStepper.jsx`: `RESEARCH_KEY='research'`/`RESEARCH_META={icon:'①',label:'리서치'}` 추가, `researchEnabled` prop(시놉시스 `synopsisEnabled` 미러), `onStepClick('research')` 라우팅. STEP_META icon 재배치(§2.1).

### 3.7 설정 — **[폐기]** YouTube API key 탭 없음

**YouTube Data API key 입력 UI·keyStoreMulti youtube provider·quota 처리 전부 폐기**(§0.1). yt-dlp는 API key가 불필요하므로 설정 탭이 없다. 유일한 요구는 시스템에 `yt-dlp` 바이너리 설치 — 부재 시 리서치 phase에서 `binary-not-found` 에러 + 설치 안내(`https://github.com/yt-dlp/yt-dlp#installation`, macOS `brew install yt-dlp`). `SettingsModal.jsx`·`keyStoreMulti.js` 무변경.

### 3.8 시놉시스 연결 — `stepMachine.js` + `prompts.js`

**영속/hydrate(M6)** — machine은 `story:open`마다 재생성되므로(`story-api.js:86`) durable 저장이 필수:
- `researchFetchTranscripts` 완료 즉시 `research.draft.json`(선택 videoId 메타 + paragraphs)을 store에 저장 → 재오픈 시 검색/선택/자막 유실 방지.
- `commitResearch({ analysis, verifiedClaims })` → `research.json`(구조+팩트) 저장 + `state.research = { hasResearch:true }`(마커) durable(`charactersConfirmed` durable 패턴 미러 — `state.research`는 `storyStore.load` 통과, defaultStoryState에 없어도 로드시 유지).
- `open()`/`getState()`의 hydrate 페이로드(`hydrateExtras`, `stepMachine.js:576`)에 research 상태(`hasResearch`, draft videos/analysis) 포함 → renderer가 재오픈 시 리서치 phase 복원.
- `researchSkip` → draft/research.json 정리(store에서 삭제 또는 무시 마커) + `state.research` 클리어.

**수동 주입(M2, Q5)**:
- `generateSynopsis`(`stepMachine.js:1141`)에 `params.useResearch` 추가. **`params.useResearch === true`일 때만** `research.json` 로드해 `buildLlmOptions(inputOptions, { metaPrompt, research })`로 주입(현행 `metaPrompt`/`synopsis` 주입과 동일 위치, 라인 1163). `research` 키는 `stripRuntimeControlOptions` denylist(`STORY_LLM_RUNTIME_CONTROL_KEYS`, `storyLlmCatalog.js`)에 없어 normalize를 통과한다(검증됨).
- `params.useResearch`가 falsy면 research.json이 있어도 주입 안 함 — 사용자 토글이 유일 스위치.
- `buildSynopsisPrompt`(`prompts.js:84`)에 리서치 블록 추가: `opts.research ? "아래 검증된 구조와 사실을 참고해 시놉시스를 작성하라(사실은 재구성·참고용, 원문 문장 복사 금지):\n<structure>\n<verified claims>"`.
- **선택성**: `opts.research` 없으면 프롬프트 무변경 — 기존 제목→시놉시스 회귀 없음(§D14).

---

## 4. 데이터 흐름

```
[사용자] 키워드 입력
   │ researchSearch(query)                       ← IPC story:research-search
   ▼
[main] searchVideos.searchVideos                 ← yt-dlp ytsearchN (key 불요)
   │  ytsearch<N> --flat-playlist --print → parseSearchLines → sortByViewCount(10)
   ▼
[renderer] 카드 그리드 렌더 → 사용자 체크 선택 (+ URL 수동 추가)
   │ researchFetchTranscripts([videoId...])       ← IPC story:research-fetch
   ▼
[main] fetchTranscript (yt-dlp child_process — 재생·poToken 불요)
   │  videoId별 yt-dlp --write-subs --sub-langs ko,en → <id>.<lang>.srv3
   │  transcriptParse (순수, srv3/vtt) → { srt, plainText, segments }
   │  즉시 research.draft.json durable 저장 (M6 — 재오픈 유실 방지)
   │  진행상황 story:progress(research-fetch, videoId별)
   ▼
[main] llm.analyzeResearch(plainTexts)           ← IPC story:research-analyze (선택 엔진)
   │  공통 구조 + claims 추출 (라우터 경유)
   ▼
[main] llmClaude.factCheckClaims(claims)         ← IPC story:research-factcheck
   │  Claude 강제(라우터 우회 직접 호출, M1) — WebSearch → supported만 채택
   ▼
[renderer] 구조·검증사실 표시 → [리서치 사용] 확정
   │ commitResearch({analysis, verifiedClaims})   ← IPC story:research-commit
   ▼
[main] research.json 저장 + state.research 마커 (자동 주입 안 함, M2)
   ▼
[시놉시스 phase] "리서치 포함" 토글 ON → generateSynopsis({useResearch:true})
   │  → research.json 로드 → opts.research 주입 → 기존 파이프라인
   토글 OFF → 기존 제목/붙여넣기 → 시놉시스 (리서치 미주입)
```

**영속 산출물**(`<project>/story/`): `research.draft.json`(fetch 직후 — 선택 메타 + paragraphs, M6), `research.json`(commit — analysis + verifiedClaims). 자막 원문 srt는 **로컬 재사용/검증용**으로 `research/transcripts/<videoId>.srt`(store.saveText) — **export 산출물엔 미포함**(§7 원문 복사 금지와의 긴장 해소, MINOR 7).

---

## 5. 크로스레이어 계약 (IPC 이벤트)

`electron/ipc/story-api.js`에 `guarded` 핸들러 추가(projectToken 검증, `story-api.js:66`). `preload.js`(라인 120~) 브릿지 + `onStoryEvent` valid 채널(라인 132)에 신규 이벤트 추가.

**R→M invoke (guarded)**:
| 채널 | 페이로드 | 반환 |
|---|---|---|
| `story:research-search` | `{ projectToken, query, maxResults? }` | `{ videos:[{videoId,title,channelTitle,thumbnailUrl,viewCount}] }` 또는 `{ error }` |
| `story:research-fetch` | `{ projectToken, videoIds:[] }` | `{ transcripts:[{videoId, ok, paragraphs?, error?}] }` |
| `story:research-analyze` | `{ projectToken, videoIds:[] }` | `{ analysis:{structure,claims,commonThemes} }` (선택 엔진, 라우터 경유) |
| `story:research-factcheck` | `{ projectToken }` | `{ verifiedClaims:[{claim,verdict,evidence}] }` (Claude 강제, M1 — engine-unsupported 없음) |
| `story:research-commit` | `{ projectToken, analysis, verifiedClaims }` | `{ ok:true }` |
| `story:research-skip` | `{ projectToken }` | `{ ok:true }` (draft/research.json 정리) |

> `generateSynopsis`는 기존 채널(`story:generate-synopsis`)에 `useResearch` 페이로드 필드 추가(M2) — 신규 채널 아님.

**M→R events**(`emit`, `send`의 `{projectToken, operationId, ...}` 계약 — `stepMachine.js:101`):
| 채널 | kind | 페이로드 |
|---|---|---|
| `story:progress` | `research-fetch` | `{ videoId, status:'running'\|'done'\|'error', lang?, isAuto? }` (기존 progress 채널 재사용. bot-blocked 폐기 — yt-dlp 자체 처리) |
| `story:progress` | `step-log` | 기존 step-log 재사용(리서치 로그) |
| `story:research-state` | — | `{ hasResearch, videos?, analysis?, verifiedClaims? }` (hydrate/복원용, 신규 채널; open/getState hydrate와 병행) |

**busy 뮤텍스**: machine에 `researchController` 추가. `start()`(라인 1209)/`generateSynopsis`(1143)/`confirmSynopsis`(1192)/`synthPreview`(1076)의 busy 가드에 `|| researchController` 추가 — 리서치 side action과 step/preview/synopsis/confirm 상호배제(MINOR 5 — confirmSynopsis 포함). `abort()`(1262)에 `researchController?.abort()` + `researchView?.webContents.stop()` 추가(대칭 중단, §3.1).

---

## 6. 에러 · 엣지 케이스

| 상황 | 처리 |
|---|---|
| **자막 없음**(영상에 CC 자체 없음) | yt-dlp가 자막 파일 미생성 → `{ ok:false, error:'no-transcript' }`. 카드에 "자막 없음" 배지, analyze에서 제외. 선택 자막 0개면 analyze 거부(`error:'no-transcripts-selected'`) |
| **[신규] yt-dlp 미설치** | `runYtDlp`가 바이너리 못 찾음 → `{ error:'binary-not-found' }`. UI가 설치 안내(`brew install yt-dlp` / yt-dlp releases). 리서치 phase 전체가 이 하나에 의존 |
| **[신규] yt-dlp 타임아웃** | `execFile` timeout(SIGTERM) → `{ error:'timeout' }`. 개별 videoId 실패는 나머지 진행(부분 성공 허용) |
| **파싱 실패**(srv3/vtt 구조 변경) | `parseSubtitle` → `[]` → `{ error:'parse-failed' }`(하드 크래시 금지 — try/catch). yt-dlp 업데이트로 완화 |
| **네트워크 실패** | yt-dlp가 non-zero exit + stderr에 에러 → `{ error:<message> }`. 개별 videoId 실패는 나머지 진행 |
| **팩트체크 미실행**(사용자가 팩트체크 스킵) | 구조분석만으로 commit 허용(`verifiedClaims=[]`). 엔진 선택과 무관(팩트체크는 항상 Claude 강제, engine-unsupported 분기 없음, M1) |
| **자막 취득 취소**(진행 중 취소 버튼) | `executeJavaScript` 취소 불가 → `researchController.abort()` + `view.webContents.stop()` + 진행 결과 무시(MINOR 4). 부분 저장된 draft는 유지 |
| **abort 중 커밋** | `researchController.signal.aborted` 검사 후에만 research.json 저장(stepMachine의 signal 가드 패턴, 라인 635 미러) |

---

## 7. 법적 · ToS 주의 (필수)

> ⚠️ **타인의 YouTube 자막 사용은 저작권 및 YouTube ToS의 회색지대다.**

- **비공식 API**: timedtext / innertube get_transcript는 공식 문서화되지 않은 내부 엔드포인트다. YouTube ToS는 자동화된 접근·스크래핑을 일반적으로 제한한다. 이 기능은 **개인 리서치·재구성 참고용**으로만 설계하며, 자막 원문을 그대로 재배포하거나 영상으로 출력하지 않는다.
- **저작권**: 자막(대본)은 원저작자의 저작물이다. 리서치 스텝의 산출물은 **여러 소스를 종합·재구성한 새 시놉시스**이지, 특정 자막의 복제가 아니다. `analyzeResearch`는 공통 구조/논점만 추출하고, `factCheckClaims`는 사실만 검증한다 — 원문 문장 복사 금지(프롬프트에 명시).
- **UI 경고**: 리서치 phase 진입 시 1회 고지("참고·재구성 용도. 타인 자막의 무단 복제·재배포는 저작권 침해가 될 수 있습니다"). `research.json`에 소스 videoId를 기록해 출처 추적 가능하게 한다.
- **소유자 자막 API 미사용 이유 명시**: 공식 `captions.download`는 소유자 전용이라 이 용도엔 쓸 수 없어 비공식 경로를 택한 것 — 이 한계를 문서/UI에 남긴다.
- **자막 원문 로컬 저장 vs 복사 금지(MINOR 7)**: `research/transcripts/<videoId>.srt`는 **로컬 참고·검증용**으로만 저장하고, CapCut/Premiere export 산출물이나 최종 영상엔 **원문 그대로 포함하지 않는다**. 시놉시스로 재구성된 결과만 파이프라인 하류로 흐른다. 프롬프트에도 "원문 문장 복사 금지"를 명시(§3.8).
- **[개정] 익명성**: yt-dlp는 사용자 Google 쿠키 없이 익명으로 자막·검색을 취득한다(webContents 파티션·로그인 폴백 폐기). 사용자 개인 세션과 결합하지 않아 ToS 리스크가 낮다. 비공식 접근(yt-dlp의 innertube 사용)이라는 회색지대는 여전하므로 위 고지 유지.

---

## 8. 확정된 결정 (Q1~Q5)

리뷰 Fable R1에서 아래로 **확정**(더 이상 미해결 아님).

| # | 질문 | 확정 |
|---|---|---|
| Q1 | 팩트체크 엔진 | **팩트체크 스텝만 Claude 강제**(다른 스텝은 선택 엔진 유지). 라우터 우회 직접 호출(M1, §3.5) — engine-unsupported 분기 없음 |
| Q2 | **[폐기]** 리서치 webContents 세션 | ~~익명 격리 persist:yt-research + 봇차단 로그인~~ → 무효. yt-dlp가 익명·봇차단 자체 처리(§0.1) |
| Q3 | 자막 언어 우선순위 | **한국어 → 영어 → 자동생성(asr)**. `pickCaptionTrack(tracks, ['ko','en'], { allowAsr:true })`(M4, §3.2) |
| Q4 | 검색 결과 개수 | **상위 10개**(yt-dlp ytsearch로 N=30 취득 후 view_count desc 상위 10 — quota 개념 없음) |
| Q5 | 리서치→시놉시스 주입 | **수동**(자동 아님, M2). 시놉시스 게이트 "리서치 포함" 토글 + `generateSynopsis({useResearch:true})`일 때만 주입 |

---

## 9. TDD 슬라이스 (RED → GREEN)

각 슬라이스는 실패 테스트 먼저 → 최소 구현 → 통과. 순수 함수 우선(테스트 용이), webContents/IPC는 통합. 러너는 **vitest**(CLAUDE.md), 컴포넌트는 vitest + RTL(프로젝트에 Playwright 없음, MINOR 6).

| 슬라이스 | 종류 | RED(실패 테스트) → GREEN |
|---|---|---|
| **S0 자막취득 스파이크(완료 — 방향전환)** | 스파이크 | ✅ **완료**. webContents+poToken 방식 **실패**(innertube 400, pot 미포착), **yt-dlp로 전환 확정**(§0.1). 실 영상 en 수동·ko asr·검색 모두 yt-dlp로 취득 성공. 산출: 실측 srv3/vtt fixture(`tests/fixtures/youtube/{manual-en.srv3,auto-ko.srv3,manual-en.vtt}`) |
| **S1 파싱/SRT 순수 ✅** | 단위 | ✅ **완료**. `tests/electron/api/youtube/transcriptParse.test.js`: 실측 srv3(수동/자동)·vtt fixture → 세그먼트, `parseSrv3`/`parseVtt`/`parseSubtitle`(자동분기), `segmentsToSrt`(`,` 소수점 `msToSrtTime`), `segmentsToPlainText`, 빈/깨진 입력 `[]`. → `transcriptParse.js` 구현됨 |
| ~~S1b 페이지 JS 순수 서브함수~~ | — | **폐기**(HTML split·pot 스니핑 파서 소멸 — §0.1) |
| **S2 검색 ✅** | 단위 | ✅ **완료**. `tests/electron/api/youtube/searchVideos.test.js`: `parseSearchLines`(구분자 분해, NA→0, 필드부족 스킵), `sortByViewCount`(조회수 desc 상위 N, 순수 불변), `searchVideos`(ytsearchN 인자·`--flat-playlist`·binary-not-found·empty-query 계약). → `searchVideos.js` 구현됨 |
| **S3 자막 취득 오케스트레이터 ✅** | 통합 | ✅ **완료**. `tests/electron/api/youtube/fetchTranscript.test.js`: `buildYtDlpSubArgs`(인자 계약), child_process mock으로 자막 파일 생성→파싱→srt/plainText, ko→en 파일 선택, no-transcript/binary-not-found/timeout. + `ytDlp.js`(경로 해석·execFile·timeout). → 구현됨 |
| **S4 구조 분석** | 단위 | `llmClaude.analyzeResearch` queryImpl mock: 다수 자막 → RESEARCH_ANALYSIS_SCHEMA JSON, structured→text 폴백, 스키마 검증(assertSchema 패턴). → 구현 + prompts |
| **S5 팩트체크 WebSearch(Claude 강제)** | 단위 | `buildClaudeSdkOptions` extra로 `tools:['WebSearch']`·`maxTurns` 오버라이드 검증(claudeSdk.test.js), `factCheckClaims` mock: supported만 채택. **machine이 주입된 `factCheck` deps로 호출(라우터 우회, N4) + Codex 선택이어도 명시 Claude 조합(`{engine:'claude',model:'claude-opus-4-8',reasoningEffort:'off'}`, N5) 강제** — `claude:gpt-5.5` normalize throw가 안 나는지 회귀. → 구현 |
| **S5b llmCodex.analyzeResearch(N1)** | 단위 | `llmCodex.analyzeResearch` 존재 + 라우터가 Codex 엔진에서 throw 없이 위임(`storyLlmRouter.js:27` 회귀). → llmCodex 구현 |
| ~~S6 키 저장~~ | — | **폐기**(yt-dlp는 API key 불요 — §0.1) |
| **S7 machine side action + 영속/hydrate(M6)** | 통합 | `stepMachine` researchSearch/Fetch/Analyze/FactCheck/commit/skip: busy 뮤텍스(step/preview/synopsis/**confirm** 상호배제, MINOR 5), abort 대칭, **주입된 `factCheck` mock으로 팩트체크 호출(N4 seam)**, **fetch 후 research.draft.json durable + open/getState hydrate에 research 상태 포함(재오픈 복원)**, commit→research.json, **generateSynopsis({useResearch:true})만 주입 / falsy면 미주입(M2)**, skip→정리. → 구현 |
| **S8 시놉시스 연결(수동)** | 단위 | `buildSynopsisPrompt`: opts.research 있으면 리서치 블록 주입, 없으면 무변경(회귀 고정). `research` 키 normalize 통과 확인. → prompts 수정 |
| **S9 UI** | 컴포넌트(vitest+RTL) | ResearchPanel: 카드그리드 렌더·선택·URL추가, 자막 상태 표시, **취소 버튼(MINOR 4)**, yt-dlp 미설치(binary-not-found) 안내, StoryStepper ① 리서치 pill 활성/비활성(researchEnabled 소스), scriptPhase='research' 라우팅, **research phase에서 하단 제네릭 컨트롤 미노출(N2 게이트 누출 회귀)**, "리서치 포함" 토글, ToS 고지 1회. → 구현 |

> **착수 순서**: ✅ S0(완료 — yt-dlp 전환) → ✅ S1/S2/S3(yt-dlp 파서·검색·자막 오케 구현완료) → S4/S5/S5b → S7 → S8/S9. S1b/S6는 폐기. yt-dlp 전환으로 view 생명주기(N3)·pot 검증 슬라이스 소멸.

---

## 10. 비목표 (YAGNI)

- innertube 직접 호출·webContents 자막 취득(§0.1 — yt-dlp로 대체).
- yt-dlp 앱 번들 동봉(이번 슬라이스는 시스템 yt-dlp, 부재 시 에러+안내 — codex 바이너리 번들 패턴은 후속).
- 자막 자동 번역(yt-dlp 취득 트랙만, 재번역 X).
- 채널/재생목록 단위 리서치(단일 영상 자막만).
- 자막 원문 영상 출력·재배포(§7 — 참고·재구성만).
- Codex/Gemini 팩트체크(웹검색 미지원 — 팩트체크는 항상 Claude 강제, §D11/M1).
- 리서치 컨텍스트 자동 주입(수동 토글만, §D12/M2).
- 리서치 결과 버전 관리·diff(단일 research.json 스냅샷).
- 실시간 조회수 갱신·트렌드 분석.
- 자막 취득 병렬 다중 프로세스(순차 처리 + 후속 LRU 캐시로 충분, rate 제한이 오히려 유리).
- self-hosted 프록시/서버 폴백(yt-dlp가 봇차단 자체 처리 — 불필요).

---

## 부록 A. 변경/신규 파일 요약

**신규(✅ = S0에서 이미 구현·테스트 완료)**:
- ✅ `electron/api/youtube/ytDlp.js` (yt-dlp 경로 해석 + child_process 러너, D18)
- ✅ `electron/api/youtube/fetchTranscript.js` (yt-dlp 자막 취득 오케스트레이터)
- ✅ `electron/api/youtube/transcriptParse.js` (순수 파싱 — parseSrv3/parseVtt/parseSubtitle/segmentsToSrt/segmentsToPlainText)
- ✅ `electron/api/youtube/searchVideos.js` (yt-dlp 검색 — parseSearchLines/sortByViewCount/searchVideos)
- ✅ 테스트: `tests/electron/api/youtube/{transcriptParse,searchVideos,fetchTranscript}.test.js` + `tests/fixtures/youtube/{manual-en.srv3,auto-ko.srv3,manual-en.vtt}`
- (후속) `src/components/story/ResearchPanel.jsx`
- (후속) 테스트: `tests/**/{stepMachine(확장),claudeSdk(확장)}.test.js` + `tests/components/story/ResearchPanel.test.jsx`

> ~~youtubeSearch.js / youtubeTranscript.js(webContents) / transcriptPageFns.js / YouTubeKeyTab.jsx / useYouTubeKey.js~~ — **폐기**(yt-dlp 전환, §0.1).

**수정**:
- `electron/main.js` — **무변경**(makeResearchView·view 생명주기 폐기. yt-dlp 모듈은 story-api에서 직접 import). ~~makeResearchView/getResearchView/disposeResearchView~~ 폐기.
- ~~`electron/api/keyStoreMulti.js`~~ — **무변경**(youtube provider 폐기).
- `electron/story/stepMachine.js` (research side actions + `factCheck` deps 주입(N4) + researchController 뮤텍스(confirm 포함) + abort 대칭 + research.draft/research.json 영속 + hydrateExtras research 상태 + generateSynopsis params.useResearch)
- `electron/ipc/story-api.js` (story:research-* guarded 핸들러 — `searchVideos`/`fetchTranscript` 직접 호출 + factCheck 바인딩 주입(N4). ~~view DI 트리거~~ 폐기)
- `electron/api/llm/llmClaude.js` (analyzeResearch + **factCheckClaims**)
- `electron/api/llm/llmCodex.js` (**analyzeResearch** — N1 필수 복원: 라우터 등록 메서드라 두 어댑터 모두 구현해야 throw(`storyLlmRouter.js:27`) 안 남. 구조분석은 웹검색 불요라 Codex 가능. **factCheckClaims는 Codex에 안 만듦** — Claude 강제, 라우터 우회, M1)
- `electron/api/llm/claudeSdk.js` (buildClaudeSdkOptions는 이미 sdkExtra 오버라이드 지원 — 검증만; WebSearch용 maxTurns extra 경로 확인)
- `electron/api/llm/prompts.js` (buildResearchAnalyzePrompt/FactCheckPrompt + buildSynopsisPrompt 리서치 블록)
- `electron/api/llm/schemas.js` (RESEARCH_ANALYSIS_SCHEMA, FACTCHECK_SCHEMA)
- `electron/api/llm/storyLlmRouter.js` (METHOD_OPTION_INDEX에 **analyzeResearch만**(양 어댑터 구현) — factCheckClaims는 라우터 우회 + factCheck DI, M1/N4)
- `electron/preload.js` (storyResearch* 브릿지 + generateSynopsis useResearch 필드 + onStoryEvent valid에 story:research-state)
- `src/components/story/StoryStepper.jsx` (RESEARCH_KEY/META, 번호 재배치 ②→③.., researchEnabled)
- `src/components/story/StoryView.jsx` (scriptPhase 'research' 확장 렌더/라우팅/stepperActive, 리서치 포함 토글)
- `src/hooks/useStoryPipeline.js` (research side action 호출 + story:research-state 구독 + generateSynopsis useResearch)
- ~~`src/components/SettingsModal.jsx` (YouTubeKeyTab 탭)~~ — 폐기(무변경)
- locales ko/en (리서치 라벨/ToS 고지 + yt-dlp 미설치 안내)

## 부록 B. 자막 취득 실현가능성 · 취약성 — **[개정] yt-dlp**

- **S0 실증 결론**: 초안의 webContents+innertube+poToken 방식은 **실패**(§0.1). yt-dlp가 재생·poToken 없이 완벽 취득 → **yt-dlp 단일 경로로 확정**.
- **가장 취약한 지점**: yt-dlp의 YouTube extractor는 YouTube 변경 시 깨질 수 있으나, **yt-dlp 커뮤니티가 유지보수**한다(우리 코드가 아님). 사용자가 `yt-dlp -U`로 업데이트하면 복구. AutoFlowCut 측 취약면은 (a) srv3/vtt 파서(구조 변경 시 — 순수 fixture 테스트로 회귀 감지), (b) 파일명 lang 판정, (c) 바이너리 경로 해석뿐.
- **완화**: (1) 각 단계 try/catch 격리(하드 크래시 금지), (2) 순수 파서 분리 + 실측 fixture 회귀 테스트, (3) yt-dlp 부재/타임아웃/파싱실패를 명확한 error 코드로 분류(부록 §6).
- **의존 리스크**: 유일한 외부 의존 = 시스템 yt-dlp 바이너리. 부재 시 `binary-not-found` + 설치 안내. 앱 번들 동봉(codex 바이너리 패턴)은 후속 슬라이스에서 검토.
- **결론**: yt-dlp 전환으로 초안 대비 취약면·유지보수 부담이 크게 감소. YouTube 변경 종속성은 yt-dlp 커뮤니티로 이관됨.
