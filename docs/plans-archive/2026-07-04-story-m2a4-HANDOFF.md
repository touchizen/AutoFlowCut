# Story M2a-4 — export/GCF 핸드오프

**날짜**: 2026-07-04
**BASE**: `a7df50e` (feature/story-pipeline) — M2a-1~3 + 자막중첩 버그픽스 + TTS 멀티provider/화자별엔진 완료, 전체 3964 pass
**스펙**: `docs/superpowers/specs/2026-07-04-story-m2-audio-design.md` §7(세그먼트→export 통합), §8(M2a-4)
**진행 원장**: `.superpowers/sdd/progress.md`

---

## 0. 한 줄 요약

audio 스텝이 **`story/audio/manifest.json`(세그먼트별 오디오 메타)을 이미 써두는데**, export가 그걸 안 읽는다.
manifest를 `prepareCloudRequest`가 읽어 **`story_narration` 전용 audioTrack**으로 변환하고, GCF 2개가 그 타입을 배치하게 잇는 게 M2a-4.

**⚠️ 사용자 지시(등록됨): GCF는 `test` 버전만 배포. prod 절대 안 함.**

---

## 1. 현재 상태 (무엇이 이미 있나)

- **manifest 산출 완료**: audio 스텝이 `<project>/story/audio/manifest.json` 작성 (`electron/story/manifest.js` buildManifest, `stepMachine.js` audio 스텝):
  ```json
  { "version":1, "pushRevision":7,
    "segments":[ { "id":"s001-1","type":"narration","speaker":"narrator","trackIndex":0,
      "audioPath":"<abs>/story/audio/segments/s001-1.mp3","startMs":0,"durationMs":2380 } ] }
  ```
  - `pushRevision`: prompts가 확정 스탬프(§7 revision 소유). 최초 정밀은 audio가 null→prompts가 재스탬프.
  - 세그먼트 파일: `story/audio/segments/<id>.<fmt>` (mp3/wav — provider별).
- **씬 timing/srt**: `story:pushScenes`로 project.json에 이미 반영(startTime/endTime/srtTrack). export는 이걸 그대로 씀.
- **GCF는 아직 무변경**: whisk2capcut/whisk2premiere 둘 다 story_narration 미처리(clean 상태 확인).

---

## 2. 통합 지점 (app)

### IP-A1 — prepareCloudRequest에 manifest 분기
- **파일**: `src/exporters/prepareCloudRequest.js`
- **시그니처**(:84): `prepareCloudRequest(project, options = {})`. options 구조분해(:85-96)에 `audioPackage` 있음 → **`storyAudio`(manifest) 추가**.
- **audioTracks 구성**(:240-296, `if (audioPackage) {...}`): 여기와 **배타**로 story 분기 추가 —
  - story 프로젝트면(§7: storyId 가진 씬 존재 or 앱이 storyProjectPath 보유) manifest.segments의 **narration**을 `story_narration` audioTrack으로:
    ```js
    cloudAudioTracks.push({ type:'story_narration', filename, timecodeMs: seg.startMs,
      durationMs: seg.durationMs, trackIndex: seg.trackIndex ?? 0 }) // vol은 GCF서 1.0
    audioFiles.push({ type:'narration', filename, path: seg.audioPath })
    ```
  - `pathMap`에 세그먼트 파일 추가(:299-308 로직 재사용).
  - **배타**: story면 manifest, 비-story면 기존 audioPackage(§7).
- **export 정합 검사(§7 HIGH신규2)**: `manifest.pushRevision === story.json.lastPushedRevision`일 때만 manifest 사용. 불일치(ack 미완/null)면 **export 차단 + 경고 배너**("오디오 타이밍 동기화 대기 중").

### IP-A2 — manifest locator (options에 story 경로 전달)
- **파일**: 호출부 `src/exporters/{capcutCloud.js:67, premiereCloud.js:83, vrewPacker.js:165}` — 모두 `prepareCloudRequest(project, options)`.
- 현재 export hook은 `audioPackage`만 넘김 → **story 경로를 모른다**(§7 MED신규). options에 **`storyProjectPath`(또는 `storyManifestPath`) 명시 전달** 필요.
- story 감지: 열린 프로젝트에 storyId 가진 씬 있으면 story 경로로 간주 → `<storyProjectPath>/story/audio/manifest.json` 로드. 없음/실패→오디오 없이 export(경고), stale→차단.
- App 배선: `src/App.jsx`의 export 트리거(capcut/premiere/vrew export 호출부)에서 storyProjectPath를 options에 실어줌. (storyProjectPath는 App:471 이미 계산됨.)

### IP-A3 — Vrew는 오디오 미배치, 실측 SRT만 (§7)
- Vrew는 자체 TTS라 mp3 미배치. `srtEntries`(실측 SRT)만 전달 — 기존 srtTrack→srtEntries 경로 그대로. **vrewPacker 무변경 가능**(audioTracks story_narration 무시).

### 배치 타입 계약 (§7)
| 세그먼트 | audioTrack 타입 | 배치 | GCF |
|---|---|---|---|
| narration | **`story_narration`(신설)** | timecodeMs=startMs, durationMs, trackIndex, vol 1.0 | whisk2capcut+premiere 배포 |
| sfx(M2b) | sfx_timed(기존) | — | 무변경 |
- **왜 전용 타입**: 기존 `voice`=SRT중앙스냅(fuzzy), `narration`=full mp3 vol0.5, `sfx_timed`=SFX 시맨틱 — 셋 다 세그먼트 나레이션에 부적합(스펙 조사 확인). timecodeMs 그대로·전용트랙·vol1.0은 전용타입만.
- trackIndex: M2a는 항상 0(단일트랙). 화자별 분리는 v2.

---

## 3. 통합 지점 (GCF — 크로스 레포)

### IP-G1 — whisk2capcut
- **파일**: `~/workspace/whisk2capcut/functions/index.suffixed.js` (⚠️ 실제 배포 소스는 **`index.suffixed.js`**, deploy.sh가 index.js로 복사 — CLAUDE.md 규칙).
- **위치**: `:1274` `if (audioTracks && audioTracks.length > 0)` 블록 — `:1275-1277`에서 `type==='voice'/'sfx_timed'/'narration'` 필터. **여기 `story_narration` 필터+배치 추가**:
  ```js
  const storyNarrItems = audioTracks.filter(a => a.type === 'story_narration')
  // 각 item: timecodeMs 위치에 전용 오디오 트랙 클립 배치, durationMs 길이, vol 1.0.
  // 기존 sfx_timed 배치(:1390~, startTimeUs=timecodeMs*1000) 패턴 참고.
  ```
- 함수명: **`generateCapcutJson`**. 배포: `cd ~/workspace/whisk2capcut/functions && ./deploy.sh test generateCapcutJson`

### IP-G2 — whisk2premiere
- **파일**: 오디오 배치는 index.suffixed.js가 아니라 **`src/premiereExport.js`**(index.suffixed.js:14 `generatePremiereProjectXML` import) + `premiere_generator.js`(audioClipTrack 템플릿 `:43,:597`). 소스 수정은 여기.
- story_narration을 audio clip 트랙으로 배치(premiere_generator.js audioClipTrack 템플릿 재사용, timecodeMs→In/Out).
- ⚠️ 수정은 **`index.suffixed.js`가 실배포 소스**지만 로직이 src/에 분산 — deploy.sh `SOURCES`에 premiere_generator.js/premiere_templates 포함됨(:48-49) 확인.
- 함수명: **`generatePremiereJson`**(+ generatePremiereReview). 배포: `cd ~/workspace/whisk2premiere/functions && ./deploy.sh test generatePremiereJson`

### GCF 규칙 (CLAUDE.md)
1. 소스 수정은 **`index.suffixed.js`**에 (실배포 소스). index.js 직접 수정 금지.
2. 배포는 **반드시 `./deploy.sh test <함수명>`** (함수명 필수, **test만**).
3. **`firebase deploy --only functions:xxx` 직접 실행 금지.**

---

## 4. 범위 분할 (권장 순서)

1. **M2a-4a (app, self-contained, TDD)**: IP-A1 manifest 분기 + story_narration audioTrack 변환 + IP-A2 locator + export 정합 검사. 단위테스트(manifest→audioTracks 변환, story/비-story 배타, 정합 차단). **GCF 없이 검증 가능.**
2. **M2a-4b (GCF whisk2capcut)**: IP-G1 story_narration 배치 → `./deploy.sh test generateCapcutJson` → CapCut 실export 확인.
3. **M2a-4c (GCF whisk2premiere)**: IP-G2 배치 → `./deploy.sh test generatePremiereJson` → Premiere 실export 확인.
4. **Vrew**: 무변경(실측 SRT만) — 회귀 확인만.

---

## 5. 착수 첫 액션
1. `src/exporters/prepareCloudRequest.js` audioTracks 블록(:240-296) + 호출부 3곳 재확인.
2. manifest→story_narration 변환 RED 테스트부터(app). GCF 전 app-side 완결.
3. GCF는 **test 배포 후 실제 CapCut/Premiere로 export해 오디오 위치 눈으로 검증**(GCF 로직은 실행해봐야 앎).

## 6. 작업 방식
- TDD(app), 마일스톤 끝날 때 Codex 리뷰(gpt-5.5/xhigh, findings 0). [[codex-review-per-milestone]]
- **prod 배포 절대 금지 — test만**(사용자 지시). 배포는 outward-facing이라 test도 사용자 인지하에.
- 완료 plan/spec은 `docs/plans-archive/`로 이동(CLAUDE.md).
