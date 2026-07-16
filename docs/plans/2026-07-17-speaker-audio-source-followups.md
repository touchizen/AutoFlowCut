# 화자별 오디오 출처(mp3+SRT 가져오기) — 남은 작업

**상태**: 기능 동작함. 커밋 없음(전부 워킹 트리). 아래 4건 남음.
**실측 검증 완료**: 실제 무한야담2 프로젝트에서 narrator 227/230 정렬(98.7%).

---

## 1. [최우선] 오탐 — 자막에 있는데 "못 찾음"으로 실패

**증상** (실제 무한야담2 프로젝트, 2026-07-17 02:15 실행 로그):
```
narrator: 자막에서 227/230개 구간 찾음
narrator: 자막에서 못 찾은 세그먼트 3/230개 (s38-3, s97-1, s117-2)
→ story-audio-import-unmatched 로 실행 차단
```
227/230이 맞았는데 3개 때문에 전체가 막힌다. 사용자 왈 "분명히 있는데".

**프로젝트**: `C:\Users\tuxxo\OneDrive\문서\AutoFlowCut\무한야담2`
**소스**: `E:\무한야담\무한야담2.mp3` + `무한야담2.srt` (375 큐)

**첫 할 일**: 그 3개 세그먼트의 text를 본다.
```
node -e "const s=require('C:/Users/tuxxo/OneDrive/문서/AutoFlowCut/무한야담2/story/scenes.json');
for (const id of ['s38-3','s97-1','s117-2'])
  console.log(id, JSON.stringify(s.scenes.flatMap(x=>x.segments).find(g=>g.id===id)?.text))"
```

**유력 가설 (순서대로)**
1. **구두점만 있는 세그먼트** — `normalizeForAlign`이 공백/구두점/기호를 다 지우므로 `——`, `……` 같은 세그먼트는 빈 문자열이 되고, 지금 코드는 그걸 `missed`로 센다
   (`electron/story/srtImport.js`, "글자 없는 세그먼트" 분기 — Fable 라운드6 #4로 넣은 것).
   이 대본에 `입 안 가득 피 맛이 퍼졌고——` 류가 있어 쪼개지기에 따라 해당 가능.
   → 고치면: 빈 세그먼트는 missed가 아니라 **정렬 대상에서 제외**(오디오 없음이 정상). 단
     그러면 TTS 목록으로 흘러 "성우 미배정"이 되므로, import 화자의 빈 세그먼트는 **건너뛰되
     TTS도 안 하도록** 별도 처리 필요.
2. **LLM이 대본 문장을 미세하게 다듬음** — 어미/조사 변경은 정규화가 흡수 못 한다.
3. **숫자 표기 차이** — `열 냥` vs `10냥` 등.

**주의**: 정답이 "missed면 무조건 통과"는 **아니다**. 조용히 TTS로 흘리면 목소리가 섞인다
(그래서 지금 막고 있다). 옳은 방향은 (a) 진짜 오탐 원인을 없애거나, (b) 못 찾은 세그먼트만
TTS로 보내되 **사용자에게 명시적으로 알리고 동의를 받는** 것.

---

## 2. 열 정렬이 깔끔하지 않음 (스크린샷 확인됨)

`기본 성우` 버튼 x좌표가 행마다 다르고, `+mp3`/`+SRT`가 대부분 행은 세로 2줄인데 나레이션
행만 가로 1줄. 원인: 등장인물 `appearance` 텍스트 길이가 flex 레이아웃을 밀어낸다
(`SpeakerAudioSource`를 행에 끼워 넣으면서 깨짐).

→ `.story-voice-row`를 grid로 잡고 [화자 | 성우 | 출처] 열 폭을 고정.
파일: `src/components/story/StoryView.css`, `SpeakerAudioSource.css`

스크린샷: `C:\Users\tuxxo\OneDrive\사진\Screenshots\스크린샷 2026-07-17 022151.png`

---

## 3. drag & drop 타깃을 **등장인물 행 전체**로

지금은 `SpeakerAudioSource` 위젯 영역만 받는다 → 좁다. 행 전체(`.story-voice-row`)가 받아야 한다.
**표시는 지금 방식 유지**(칩 + 파일명)로 충분하다 — 사용자 확인함.

파일: `src/components/story/StoryView.jsx`(행), `SpeakerAudioSource.jsx`(onDrop 위임)

---

## 4. 등장인물별 진행 표시

하단 전체 진행(초시계)은 맞다. 거기에 더해 **화자 행마다** 진행이 보이면 좋겠다.
지금은 `import-align` / `import-cut` 로그로만 나온다.

→ `story:progress`의 `kind:'audio-segment'`가 이미 segId별로 온다. 세그먼트→화자 매핑으로
행별 카운터(예: `227/230`)를 만들 수 있다.

---

## 현재 상태

- **커밋 0개** — 전부 워킹 트리. `origin/main` 대비 0 ahead.
- 테스트: 3,023 통과 / 3 실패. **그 3개는 이 작업과 무관한 main의 기존 실패**
  (`noUserContentInLogs` 1건 = `electron/ipc/character.js:235`, `noLocaleBoundDomAnchors` 2건).
  `git stash`로 확인함.
- ⚠️ **`npm run test:run`은 실패가 있어도 exit 0을 낸다.** 숫자를 직접 봐야 한다. CI가 이걸
  쓰고 있으면 지금 실패를 못 잡고 있을 가능성이 크다(별건).

## 설계 요약 (되새김용)

```
speaker.voice = { provider: 'typecast', voiceId }        → ⑤가 TTS로 생성
speaker.voice = { provider: 'import', mp3Path, srtPath } → ⑤가 그 파일에서 잘라 씀
```
- **④ 씬 분리는 손대지 않는다** — 평소대로 LLM이 인물·SFX·감정까지 나눈다.
- ⑤가 매 실행마다 정렬한다(`alignSegmentsToSource`) — 결정적이고 싸다. 구간은 영속 안 한다.
- 나레이터 mp3는 인물 대사까지 나레이터가 읽은 것이다(F0 실측 138~144Hz 동일).
  그 자리의 mp3 오디오는 **버리고** 인물 TTS가 채운다.
- 잘라낸 조각은 TTS 산출물과 같은 모양(`audio/segments/{id}.wav` + 실측 durationMs)이라
  하류(타임라인·manifest·export·**GCF**)는 아무것도 안 바뀐다.
