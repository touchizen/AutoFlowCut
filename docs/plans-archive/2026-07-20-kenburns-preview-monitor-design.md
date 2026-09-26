# Ken Burns 프리뷰 모니터 — 설계 스펙 (v5)

> **v5 (구현 후 사용자 결정, 2026-07-20)**: Ken Burns 설정을 **둘로 분리** —
> `kenBurns`(export 적용 여부, Export 모달, **기본 on**) / `kenBurnsPreview`(모니터 표시 여부,
> Timeline 체크박스, **기본 off**). §2·§7·§8의 "체크박스=kenBurns 단일 토글" 서술은 이 결정으로
> 대체된다: Timeline 체크박스는 `kenBurnsPreview`를 토글하고, 프리뷰 KB 표시 조건은
> `kenBurnsPreview && kenBurns && exportIndex != null && !hasVideo && kb` — export가 적용하지
> 않는 효과를 모니터가 보여주지 않도록(WYSIWYG) 두 게이트를 모두 요구한다. 두 설정 모두
> useExportSettings/Context 단일 스토어에 있으며 나머지 배선·파라미터 재사용은 그대로다.

> self-render 후속. Timeline의 Ken Burns 체크박스를 실토글로 만들고, 프리뷰 모니터에서 줌/팬을
> **self-render export와 동일한 파라미터(`computeKenBurns` 재사용)** 로 실시간 표시한다.
> 목표는 **시각 동일**("Monitor에서 본 대로 self-render로 나온다"), 프레임 픽셀 완벽일치 아님.
>
> **v3 변경**(Codex gpt-5.6-sol + Fable 5 2라운드 리뷰 union 반영):
> - (A) ExportModal의 `scaleMode`/`renderMode`도 Context 바인딩 + **load-effect를 최초 1회로 제한**(Context 변경마다 미저장 편집 리셋되는 v2 신규 버그 수정).
> - (B) `scaleMode='none'`(기본값!)을 `cover` 근사 대신 **자연-대-출력 픽셀비로 정확 에뮬레이션**.
> - (C) "이미지-only 씬"을 순간 `!isVideoActive` 대신 **씬 단위 `resolveExportVideos(scene).length===0`** 로.
> - (D) **final-hold 파리티 제거**(CSS 타임라인 vs export rebased-contiguous 타임라인이 근본적으로 달라 무거움) → tolerance 문서화.
> - (E~H) Context value memo·saveSettings 함수형, exportIndex 객체참조 키, aspect Provider 주입, 프레임 검정 배경.
>
> **v4 변경**(3R findings 반영, 두 리뷰어 완전 수렴): 'none' extent를 **비클램프** `naturalW/spec.width`로(min은 크기 아닌 클립), KB transform을 **2-레이어**(`.atl-preview-kb` 프레임 크기)로, Provider memo를 안정 constituent dep으로, aspect→format 공유 매핑, base64 게이트, 순수 updater+effect persist, dup-id 문서화. (양 리뷰어가 두 BLOCKER 기하 수정을 산술로 확인: transform된 base 캔버스 span `[-(z−1)a, z−(z−1)a]`이 `z≥1`에서 `[0,1]` 덮음 → 클립된 콘텐츠 재진입 불가.)
>
> **v4 추가**(4R): 레거시 `.atl-preview-img max-width:100%` 리셋, 'none' 자연 dims를 `scene.upscaled_size||image_size`로 시드(첫-프레임 근사 제거), resetSettings와 persist effect 상호작용, 골든 테스트 assert 대상 `.atl-preview-kb`.
>
> **양 리뷰어 실측 확인(수정 불요)**: §5 CSS 공식(둘 다 산술 유도), §4 ratio 전달 경로(buildExportOptions→handleExportRender→prepareCloudRequest 저장→computeKenBurns, 추가 변환 없음), §3 index 순서 end-to-end 보존.

## 1. 스코프

- **In**: 체크박스 실토글, export 설정 단일-소스 연동(Context), 프리뷰에 Ken Burns CSS transform, **출력 aspect + scaleMode에 맞춘 2-레이어 프레임**, 순수 스타일 함수 + 골든 테스트, exportable-필터 index 정합.
- **Out (문서화된 tolerance)**:
  - `cycle` 파라미터 — self-render `computeKenBurns`가 무시 → 프리뷰도 무시.
  - **비디오 포함 씬** — 사용자 결정: **Ken Burns는 비디오 없는 이미지-only 씬에만**(씬 단위 판정 §7). 비디오 씬은 모니터가 비디오 재생 유지, KB 미적용. self-render가 비디오→KB스틸로 대체하는 downgrade 경로(render.js:19)와의 발산은 스코프 밖.
  - **final-hold / rebased 타임라인** — 프리뷰는 모니터(CSV) 타임라인을 재생하고, self-render는 exportable 씬을 **연속 재배치(rebased-contiguous)** 한 타임라인 + audio 초과분을 `tpad`로 마지막 프레임 clone-hold(buildRenderPlan.js:243)한다. 두 타임라인은 중간 non-exportable 씬 또는 audio-tail이 있을 때만 갈린다(전부 exportable + audio가 씬 내면 동일). 이 차이(마지막 씬 이후 hold, rebase gap)는 **재현하지 않는다** — 시각 동일은 씬-로컬 모션 기준.
  - **프레임 양자화** — export는 `on/(frames−1)`로 마지막 프레임 정확 `p=1`; 프리뷰는 연속 `p=(t−start)/dur`. 짧은 씬에서 미세 차이(연속 근사).
  - **중복 scene id** — self-render `resolveInputs.js`가 이미지를 `Map<sceneId,path>`로 저장(중복 id는 마지막이 덮음)하는 **기존 export 한계**. 본 기능 스코프 밖 — 프리뷰의 exportIndex는 **객체 참조** 기반이라 KB 파라미터는 객체별 정확(§3). id 유일성은 export 정규화/검증 책임.

## 2. 진실의 소스 (상태 배선) — Context

**문제**: `useExportSettings()`는 호출부마다 독립 `useState`(localStorage만 공유, **런타임 라이브 동기화 없음**). 게다가 Ken Burns 체크박스가 있는 `AudioTimeline`은 **세 경로**에서 렌더된다:
- App → `LiveTimeline`(메인, 모니터 동반) → `AudioTimeline`
- App → `AudioPanel` → `AudioTimeline`
- `StoryView` → `LiveTimeline` → `AudioTimeline`

prop-drill은 `LiveTimeline`/`AudioPanel`/`StoryView` 시그니처를 모두 오염 → 침습적·오류유발.

**결정: React Context** (코드베이스 확립 관습: `src/contexts/ModeContext.jsx`, `AuthContext.jsx`, `useI18n.jsx`). App에서 `useExportSettings()` 1회 → `ExportSettingsProvider`로 공급. 소비처는 중간 컴포넌트 threading 없이 직접 consume + 라이브 동기화(Context 리렌더).

신규 `src/contexts/ExportSettingsContext.jsx` (Codex#6 — `ModeContext`처럼 Provider 필수·폴백 제거, value 안정 memo):
```jsx
const ExportSettingsContext = createContext(null)
export function ExportSettingsProvider({ aspectRatio, children }) {
  const store = useExportSettings()   // { settings, updateSetting(안정), saveSettings(안정), isLoaded }
  // store 자체는 매 렌더 새 리터럴 → settings/isLoaded/안정함수만 dep 으로 memo (Codex#6: [store] 는 매번 recompute).
  const value = useMemo(
    () => ({ settings: store.settings, updateSetting: store.updateSetting, saveSettings: store.saveSettings, isLoaded: store.isLoaded, aspectRatio }),
    [store.settings, store.isLoaded, store.updateSetting, store.saveSettings, aspectRatio],
  )
  return <ExportSettingsContext.Provider value={value}>{children}</ExportSettingsContext.Provider>
}
export function useExportSettingsContext() {
  const ctx = useContext(ExportSettingsContext)
  if (!ctx) throw new Error('useExportSettingsContext must be used within ExportSettingsProvider')  // ModeContext 관습
  return ctx
}
```

**소비**: `const { settings, updateSetting } = useExportSettingsContext()`. 실앱·테스트 모두 **Provider로 감싼다**(폴백 없음 → 이중 인스턴스/스테일 원천 제거).
- **테스트 파급**(Fable r4#2, Codex r5#3): Provider 필수화로 **실제 `AudioTimeline`/`PreviewPanel`이 (mock 해소 후) 마운트되는** 테스트가 throw — `LiveTimeline`/`AudioPanel.*`/`PreviewPanel`/`sfx-prompt` 등. 공유 util `tests/utils/renderWithExportSettings.jsx`로 일괄 적용. **단 소비처를 mock하거나 순수-함수/소스만 읽는 테스트(예: `hoverPreview.test.js`, `App.emptyRefGateWiring.test.js`, 일부 StoryView/PreviewMonitor)는 wrapper 불요** — 실제 마운트되는 곳에만.
- (E) **`useExportSettings` 리팩터**(Codex#7 — 함수형 updater는 순수해야, StrictMode 2회 실행·try/catch 이탈):
  - `updateSetting`/`saveSettings`를 **순수 함수형** `setSettings(prev => ({ ...prev, ...newSettings }))` 로(같은-틱 clobber 제거, `useCallback([])` 안정화). **localStorage I/O는 updater 밖 effect로 분리**: `useEffect(() => { if (!isLoaded) return; try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {} }, [settings, isLoaded])`(초기 로드 전 저장 방지, 기존 try/catch 유지).
  - **`resetSettings` ↔ persist effect 상호작용**(Codex r4#3): reset이 key 제거 + `setSettings(DEFAULT)`면 effect가 곧바로 defaults를 다시 써 key를 복원 → 기존 reset 계약테스트(`useExportSettings.test.js:157`) 깨짐. → reset을 **"defaults persist"로 재정의**(key 제거 대신 defaults 저장, effect와 일관)하고 계약테스트를 그에 맞춤. (또는 1-pass 억제 ref — 재정의 쪽이 단순.)
- **App**: 트리를 `<ExportSettingsProvider aspectRatio={settings.aspectRatio}>`로 감싼다(모니터·타임라인·ExportModal 포함).
- **AudioTimeline**: `settings.kenBurnsPreview` / `updateSetting('kenBurnsPreview', !cur)` 체크박스(§8, v5). (LiveTimeline/AudioPanel/StoryView **무변경**.)
- **PreviewPanel**: KB 파라미터 + `settings.scaleMode`/`settings.renderMode` + `aspectRatio`(Context에서) consume → 프레임(§5.1)·transform(§5).
- **ExportModal**(핵심 배선 — Codex#1·#4, Fable#2·#7):
  - **Ken Burns(enabled/mode/scaleMin/scaleMax) + `scaleMode` + `renderMode`를 Context에 직접 바인딩**(로컬 useState 제거, `updateSetting` 즉시 반영). → 모달에서 이 값들 바꾸면 모니터 라이브 반영, 닫아도 유실 없음, **export가 프리뷰와 정확히 같은 값 사용**.
  - **load-effect(`ExportModal.jsx:96-110`)를 최초 1회로 제한**: 현재 `[isLoaded, savedSettings]` dep이라 Context 변경(=savedSettings identity 변경)마다 재실행되어 **미저장 로컬 편집(path 등)을 리셋하는 버그를 v2가 유발**. `didInitRef` 가드로 `isLoaded` 최초 true 때 1회만. Context-바인딩 필드는 이 effect에서 **제거**(Context가 소스).
  - 그 외 필드(경로/포맷/자막)는 기존 로컬 state 유지.
  - `createPortal`로 렌더되지만 **React Context는 portal을 건넌다**(Fable 확인) → 바인딩 정상.

## 3. 씬 진행률 · **index (export 정합)**

**index (핵심 정합 — Codex #2)**: self-render는 `scenes.filter(isExportableScene)`(useExport.js:471) → `buildExportProject(validScenes)` → `buildRenderPlan`이 그 배열을 `scenes.map((scene,index)…)`로 시드한다. 즉 **export index = exportable-필터된 순서 리스트에서의 위치**. 프리뷰가 원본 `scenes` 위치를 쓰면 앞에 pending/error 씬이 하나만 있어도 어긋나 random/pattern 방향이 통째로 바뀐다(routine 케이스).
- `isExportableScene`을 공유 util `src/utils/exportableScene.js`로 **추출**하고 `useExport.js`가 재import(동작 무변경). PreviewPanel도 import.
- PreviewPanel에서 `const exportableScenes = scenes.filter(isExportableScene)`; **객체-참조 키 Map**(Fable#9·Codex#6 — id는 누락 시 `undefined` 충돌/중복 덮어씀): `const idx = new Map(exportableScenes.map((s, i) => [s, i]))`. `sceneRanges` 엔트리에 `exportIndex = idx.get(scene) ?? null` 부착.
- **KB는 `exportIndex != null`일 때만 적용**(비-exportable 씬은 export에 안 들어가므로 프리뷰도 KB 없음 → 정적).

**진행률** `p`: 모니터 타임라인(CSV start/end)의 활성 씬 range에서 `p = clamp((playheadMs − startMs)/(endMs − startMs), 0, 1)`, `endMs<=startMs`면 `p=0`.
- 모니터는 **CSV 기반 타임라인**을 재생하므로 `p`는 CSV range로 산출(씬 내 0→1 진행은 export와 동일 의미). 프레임 양자화·rebased 타임라인 tolerance는 §1.
- `PreviewPanel`의 `scene` 메모가 range를 버리므로 **매칭 range 객체(startMs/endMs/scene/exportIndex)** 유지하도록 수정.
- **base64-only 씬 렌더 게이트**(Codex#4, r4#2): 현재 `imgPath = scene.imagePath||image_path||filePath`는 `scene.image`(base64)를 빠뜨려 exportable 씬이 "씬 없음"으로 뜬다(export는 렌더). → 렌더 게이트를 `resolveImageSrc({imagePath, image})`로 해결된 src 기준으로. **주의**: `resolveImageSrc` fallback은 `item.image`를 **그대로 반환**(formatters.js:334) → **raw base64(비-`data:`)면 브라우저가 상대 URL로 오해해 안 로드**. export `resolveInputs`는 raw base64도 decode(`pickDataSpec`). → raw면 MIME data URL로 **정규화**(작은 헬퍼, export와 대칭). 테스트는 data-URL·raw 둘 다 `onLoad`까지.
- **final-hold 미구현**(§1 tolerance): 마지막 씬 이후 tail은 기존대로("씬 없음") 두고 export의 tpad hold를 재현하지 않는다. rebased-contiguous 타임라인 재구성은 모니터의 CSV 재생 목적과 상충하고 총 duration도 PreviewPanel에 미공급 → 스코프 밖.

## 4. 단위 변환 (%↔ratio) — 공유 헬퍼 (Codex #7)

- `useExportSettings`: `kenBurnsScaleMin/Max`는 **%**(100~130). `computeKenBurns`: **ratio**. ExportModal buildExportOptions가 `Number(v)/100 || 1.0` / `|| 1.15`(ExportModal.jsx:220-221).
- 프리뷰가 raw NaN을 `computeKenBurns`에 넘기면 `sanitizeScales` 기본(1.0/1.3)이 export의 `||1.0`/`||1.15` 폴백과 **달라짐**(손상/레거시 저장 시).
- **공유 헬퍼** `src/utils/kenBurnsPreview.js`의 `toKenBurnsRatios(settings)` → `{ mode, scaleMin, scaleMax }`, export와 **동일 식**(`Number(v)/100 || 1.0`, max는 `|| 1.15`) 재현. ExportModal buildExportOptions와 프리뷰가 이 헬퍼를 공유(ExportModal도 이 헬퍼로 치환).
- **닫힘**(양 리뷰어 경로 추적 확인): self-render는 buildExportOptions의 ratio를 그대로 소비 — `handleExportRender`→`exportRenderVideo`→`prepareCloudRequest`가 `cloudRequest.kenBurns.scaleMin/Max`로 무변환 저장→`computeKenBurns`. 추가 변환 지점 없음.

## 5. anchor → CSS transform (핵심, 골든 테스트)

Codex 검증 완료: 공식 자체 정확. self-render zoompan(buildRenderPlan.js:218-228), 순간 zoom `z`·anchor `ax,ay`:
- crop 좌상단 `x=iw(1−1/z)ax`, 크기 `iw/z`. `ax,ay∈[0,1]`, `z≥1` → clamp `max/min`은 **no-op**. crop을 `W×H`로 채움.
- 정규화 crop: 좌상단 `(u0,v0)=((1−1/z)ax,(1−1/z)ay)`, 폭·높이 `1/z`.
- `transform-origin:0 0` + `transform: translate(tx,ty) scale(z)` → 스크린정규화 `z·u+tx_norm`. `u0→0`: `tx_norm=−z·u0=−(z−1)ax`. `u0+1/z→1`: 자기일관.

**순수 함수** `kenBurnsPreviewStyle(kb, p)` → `{ transform, transformOrigin }`:
```
z  = kb.startScale + (kb.endScale - kb.startScale)*p
ax = kb.startAnchor.x + (kb.endAnchor.x - kb.startAnchor.x)*p
ay = kb.startAnchor.y + (kb.endAnchor.y - kb.startAnchor.y)*p
txPct = -(z-1)*ax*100        // CSS translate %는 요소 자기 박스 기준(스케일 미적용)
tyPct = -(z-1)*ay*100
=> transformOrigin:'0 0', transform:`translate(${txPct}%, ${tyPct}%) scale(${z})`
```
- `kb = computeKenBurns(scene, exportIndex, toKenBurnsRatios(settings))`.
- transform 리스트 `translate(T) scale(z)`: 좌표에 scale(원점 0,0) 먼저 후 translate → `z·p+T`. translate %는 무변환 박스 기준 → 유도와 일치.
- 경계: `p=0→z=startScale`, `p=1→z=endScale`. `startScale=1`(정지)이면 identity. `-0`은 `0`으로.

### 5.1 두-레이어 프레임 = 출력 aspect + scaleMode 기저 배치 (Codex#1·#2 BLOCKER, Fable#1)

export는 zoompan **전에** `scaleTransform(scaleMode)`로 **출력 aspect 캔버스**를 만들고(base crop/pad), **그 다음** zoompan이 캔버스를 crop한다. 두 단계(순서)를 CSS로 재현하려면 **KB transform이 반드시 "프레임 전체 크기" 레이어에 적용**돼야 한다(§5 translate %는 요소 자기 박스 기준 → 축소된 `<img>`에 걸면 `-30%`가 프레임의 `-10%`가 되어 틀림 — Codex#2).

**구조(2 레이어)**:
1. **`.atl-preview-frame`** (뷰포트 = ffmpeg 출력 W×H): 출력 aspect(§아래) + `overflow:hidden` + `background:#000`(§H, ffmpeg `color=black` pad). 이게 KB의 [0,1]² 기준.
2. **`.atl-preview-kb`** (프레임과 **동일 크기 100%×100%**): `overflow:hidden` + `background:#000` + `transform-origin:0 0` + **`transform`=KB(§5)**. = zoompan이 작동하는 base 캔버스. translate %가 프레임 폭 기준 → §5 유도와 일치.
3. **`<img>`** (레이어2 안, scaleMode별 기저 배치):
   - `fill` → `width:100%;height:100%;object-fit:cover` (= ffmpeg `increase`+center crop, 정확 등가).
   - `fit` → `width:100%;height:100%;object-fit:contain` (검정 레이어에 letterbox = `color=black` pad, 정확 등가).
   - `none`(**기본값**) → **자연-대-출력 픽셀비 배치**. ffmpeg 'none': `scale=iw*upscale` → `crop=min(iw,canvasW)` → `pad(canvasW)`(canvasW=spec.width*upscale). **이미지 extent(클램프 전) = `naturalW*upscale/canvasW = naturalW/spec.width`**(upscale 상쇄), 세로 `naturalH/spec.height`. `min()`은 **크기가 아니라 클립**(레이어 `overflow:hidden`이 담당) — Codex#1: `min`을 크기로 쓰면 crop 케이스(이미지>출력)를 잃는다. img를 `width:${naturalW/spec.width*100}%; height:${naturalH/spec.height*100}%` (중앙 `left/top:50% + translate(-50%,-50%)`)로. box aspect=`(naturalW/sW·framePxW)/(naturalH/sH·framePxH)=naturalW/naturalH`=이미지 aspect → **왜곡 없음**. extent>100%면 레이어가 crop, <100%면 검정 pad. 3000×500→16:9는 156%×46%(가로 crop·세로 pad 동시) 정상 재현.
     - 필요 입력: 자연 dims + `spec=outputSpec(format, settings.renderMode)`. **dims**: `scene.upscaled_size || scene.image_size`(있으면)로 **첫 페인트 시드**하되, **`<img> onLoad`의 `naturalWidth/Height`로 항상 덮어씀**(Codex r5#1 — buildExportProject가 upscaled_size 미전달, ffmpeg는 디코드된 파일 dims 사용, history restore가 image_size 갱신 없이 이미지 교체 가능 → 메타는 stale 가능, onLoad가 진실). 메타·onLoad 둘 다 없는 창에서만 임시 `cover`. **stale-메타 회귀 테스트**(메타≠실제 dims → onLoad 후 실제로 정정).

**출력 aspect / spec 산출**: `aspectRatio`(Context 주입, `'16:9'|'9:16'`)를 **export와 동일 매핑**으로 format 변환 — `const format = aspectRatio === '9:16' ? 'portrait' : 'landscape'`(useExport.js:130 재사용, 공유 헬퍼 권장). `spec = outputSpec(format, settings.renderMode)`(`electron/render/buildRenderPlan.js`에서 import; renderer가 이미 electron import). 프레임 aspect=`spec.width:spec.height`. portrait/landscape × final/preview 4조합 테스트.

- `none`의 정확 CSS는 **실앱 눈검증 게이트**(§6). 골든 테스트는 transform 공식(레이어2)만.
- `aspectRatio`는 App `settings`(useAppSettings) 소유 → Provider가 Context value에 병합 주입(§2). PreviewMonitor passthrough 불요.

## 6. CSS 구조 (2 레이어, §5.1)

```
.atl-preview-frame   position:relative; overflow:hidden; background:#000;  // 출력 aspect (aspect-ratio: sW/sH), 중앙 배치
  └ .atl-preview-kb   position:absolute; inset:0; overflow:hidden; background:#000;
                      transform-origin:0 0; transform:<KB>;                 // 프레임 크기 = zoompan base 캔버스
       └ <img>        fill→100% cover / fit→100% contain / none→픽셀비 박스(중앙, translate(-50%,-50%))
```
- KB transform은 **`.atl-preview-kb`(프레임 크기)** 에만(§5.1 Codex#2). `<img>`엔 base 배치만.
- **레거시 규칙 리셋**(Codex r4#1): 현재 `.atl-preview-img { height:100%; width:auto; max-width:100%; object-fit:contain }`(AudioTimeline.css:80)이 `none`의 `width:156%`를 100%로 되돌려 crop 재발생. 새 구조의 img엔 `max-width:none`·`width/height`를 §5.1대로 명시(레거시 셀렉터와 분리하거나 덮어씀). 테스트는 **computed 사이즈**로 검증(인라인 문자열 아님).
- **비디오 오버레이·자막을 `.atl-preview-frame` 안으로 이동**(Fable r4#1): 현재 `<video>`(`position:absolute; inset:0; object-fit:contain`)·자막은 `.atl-preview-stage`(패널 aspect) 기준 → 새 프레임(출력 aspect)과 달라 이미지↔비디오 씬 전환 시 프레이밍 "pop"·자막 높이 불일치. 둘을 프레임(출력 aspect 박스) 자식으로 옮겨 video `contain` vs 프레임 = export 캔버스 프레이밍과 일치, 자막은 프레임 하단 기준. (KB transform은 여전히 `.atl-preview-kb`에만 — 비디오/자막은 transform 밖.)
- **프레임(과 그 안의 단일 `<video>`)은 무조건 마운트**(Fable r5#1): 이미지 유무·"씬 없음" 상태와 무관하게 `.atl-preview-frame`과 `<video>`는 항상 DOM에 존재 — T2V-only 씬(img 없음)의 비디오 호스트 유지 + 단일-video 영속 invariant(`currentSrcRef`가 element identity 전제, PreviewPanel.jsx:46) 보호. 조건부는 `<img>`·빈 상태 표시만.
- 프레임/레이어 aspect·`none` 픽셀비의 정확 CSS는 **실앱 눈검증 게이트**(순수 함수 골든 테스트와 분리).

## 7. 비디오 포함 씬 (사용자 결정 — Codex#3, Fable#4)

- **Ken Burns는 비디오 없는 이미지-only 씬에만.** 판정은 **씬 단위**(순간 `!isVideoActive`가 아님 — 짧은 tail 비디오 씬이 앞부분만 KB 받는 버그 방지): `const hasVideo = resolveExportVideos(scene).length > 0`(`src/utils/sceneMedia.js`). 비디오 포함 씬은 씬 전체에서 KB 미적용, 모니터는 기존대로 비디오 재생.
- 적용 조건: `settings.kenBurns && exportIndex != null && !hasVideo && !!kb`. 그 외 `transform` 미설정(기존 정적).

## 8. 체크박스 실토글 (AudioTimeline.jsx:1023-1039)

- `onClick preventDefault + toast` 제거. `<input type="checkbox" checked={settings.kenBurnsPreview} onChange={() => updateSetting('kenBurnsPreview', !settings.kenBurnsPreview)}> (v5)` 제어 컴포넌트. `readOnly/tabIndex={-1}` 제거(포커스·접근성 복원).
- 툴팁 유지, 문구가 "내보내기 시점에만"이면 갱신. `kenBurnsToast` 키 및 참조 제거(dead).

## 9. 파일 · 함수

| 파일 | 변경 |
|---|---|
| `src/utils/kenBurnsPreview.js` (신규) | 순수 `kenBurnsPreviewStyle(kb,p)`, `toKenBurnsRatios(settings)` |
| `src/utils/exportableScene.js` (신규) | `isExportableScene` 추출(공유) |
| `src/contexts/ExportSettingsContext.jsx` (신규) | Provider(aspectRatio 주입 + value memo) + `useExportSettingsContext` |
| `src/hooks/useExportSettings.js` | (E) `updateSetting`/`saveSettings` 순수 함수형 + localStorage는 effect로 분리(clobber·StrictMode 안전) |
| `src/hooks/useExport.js` | `isExportableScene` → util import(동작 무변경) |
| `src/components/AudioTimeline/PreviewPanel.jsx` | range 유지, `computeKenBurns`+`outputSpec` import(`../../../electron/render/…`), 2-레이어 프레임/transform, Context consume(scaleMode/renderMode/aspect), exportIndex(객체참조), naturalW/H onLoad('none'), 씬단위 hasVideo, **img 게이트에 base64(`scene.image`) 포함**(Codex#4) |
| `src/components/AudioTimeline/AudioTimeline.jsx` | 체크박스 실토글, Context consume |
| `src/components/AudioTimeline/AudioTimeline.css` | `.atl-preview-frame`/`.atl-preview-kb`(2 레이어, 출력 aspect + `overflow:hidden` + `#000`) + 레거시 `.atl-preview-img max-width` 리셋 |
| `src/utils/formatters.js` (또는 kenBurnsPreview.js) | raw base64 → data URL 정규화 헬퍼(§3, export `resolveInputs`와 대칭) |
| `src/components/ExportModal.jsx` | KB + `scaleMode` + `renderMode` Context 바인딩(즉시 updateSetting, 로컬 state 제거), **load-effect 최초 1회 가드(didInitRef)**, Provider 필수 |
| `src/App.jsx` | `<ExportSettingsProvider aspectRatio={settings.aspectRatio}>` 래핑 |
| `src/locales/{ko,en}.js` | `kenBurnsToast`/`Desc` 문구 정리 |

- LiveTimeline / AudioPanel / StoryView / PreviewMonitor 시그니처 **무변경**(Context로 대체).
- `src/utils/sceneMedia.js`의 `resolveExportVideos`는 기존 export(§7 재사용, 변경 없음).

## 10. 테스트 (TDD)

- **골든** `tests/utils/kenBurnsPreview.test.js`: `kenBurnsPreviewStyle` (kb,p) → 정확 transform 문자열. zoomIn(1→1.3) p=0/0.5/1, zoomOut, anchor 코너(0,0)/(1,1)/(0.5,0.5), identity(scale1→tx=ty=0). **뮤테이션**: `(z-1)`·`ax`·부호·`*100` 각각 뒤집으면 죽는지.
- **정합** parity 테스트: 같은 `computeKenBurns` 결과에서 프리뷰 `p=0.5` z가 export `linearExpression` 중점과 동일, crop-center 정규화 좌표 산술 대조. `toKenBurnsRatios`가 export의 `/100 || 1.0`/`||1.15` 폴백과 동일 값.
- **index 정합** `PreviewPanel`(또는 util): `[pending, done]`에서 done 씬의 `exportIndex`가 `scenes.filter(isExportableScene)` 위치(=0)와 일치(**객체참조 키** — id 누락/중복 씬도 안전). 비-exportable 씬은 KB 없음.
- **씬단위 비디오** `PreviewPanel`: 짧은 tail 비디오 씬 → 씬 **전체** KB 없음(앞부분도). 이미지-only 씬 → KB 있음. `resolveExportVideos` mock.
- **scaleMode 기저 배치** `PreviewPanel`: fill→cover, fit→contain, none→픽셀비 박스(naturalW/H mock; extent=`naturalW/spec.width` **비클램프** — 이미지>출력 crop 케이스와 3000×500→156%×46% 검증). KB transform은 `.atl-preview-kb`(프레임 크기)에만.
- **format/spec 매핑**: `aspectRatio='9:16'→portrait`, `'16:9'→landscape`; `outputSpec(format, renderMode)` 4조합(portrait/landscape × final/preview)로 프레임 aspect·none fraction 산출.
- **base64-only 씬**: `scene.image`만 있는 exportable 씬 → `<img>` 렌더 + KB 적용(“씬 없음” 아님). data-URL·raw base64 둘 다 `onLoad`까지.
- **비디오/자막 프레임 배치**(Codex r5#2): `<video>`·자막이 `.atl-preview-frame`의 자식이며 `.atl-preview-kb` 밖(DOM-parent assert). 이미지 숨김/비디오-only 씬에서도 프레임은 독립 마운트.
- **dims stale**(Codex r5#1): `scene.image_size`가 실제와 다른 씬 → onLoad 후 실제 dims로 정정되는지.
- **체크박스** `AudioTimeline.test.jsx`: 클릭 → `updateSetting('kenBurnsPreview',…)` 호출(v5), `checked` 반영, toast 미발생.
- **PreviewPanel**: KB on + still image → **`.atl-preview-kb`** transform/transformOrigin(Codex r4#5 — `<img>` 아님). 비디오 씬 → 없음. off → 없음.
- **ExportModal load-once(회귀)**: Context settings identity 변경(KB 토글)해도 미저장 로컬 필드(scaleMode 로컬이 없어졌으니 path/format 등) 리셋 안 됨(didInitRef 가드). KB/scaleMode/renderMode는 Context 값 반영.
- **Context 동기화(통합)**: Provider 아래 체크박스 토글 → PreviewPanel transform 반영(단일 인스턴스 공유 증명). value memo로 불필요 리렌더 없음.
- **saveSettings 함수형(회귀)**: 같은 틱 2회 `updateSetting`(예: kenBurns + kenBurnsMode) 둘 다 반영(clobber 없음).
- 회귀: `npm run test:run` 전체.

## 11. 검증 게이트

1. `npm run test:run` 그린 + 골든/뮤테이션.
2. Codex(gpt-5.6-sol xhigh) + **Fable 5** 크로스 리뷰 findings 0 loop.
3. **실앱 눈검증(필수)**: 체크 on → 프리뷰 줌/팬 → 동일 프로젝트 self-render export와 방향/느낌 대조. 프레임 클립·출력 aspect 육안 확인.

## 12. 미결/확인 필요

- **frame aspect / `none` 픽셀비 배치 정확 CSS** — 구현+눈검증에서 확정(golden은 transform 공식만).
- **닫힘(closed)**: self-render %→ratio 경로는 양 리뷰어가 추적 확인(buildExportOptions ratio가 prepareCloudRequest 저장 거쳐 computeKenBurns까지 무변환). `toKenBurnsRatios`는 buildExportOptions 식 재현.

## 13. 구현 순서 (마일스톤 — 리뷰 단위)

1. **M1 순수 로직**: `kenBurnsPreview.js`(`kenBurnsPreviewStyle`, `toKenBurnsRatios`) + `exportableScene.js` 추출 + 골든/뮤테이션/정합 테스트. (렌더 무관, 가장 안전.)
2. **M2 배선**: `ExportSettingsContext` + `useExportSettings` saveSettings 함수형 + App Provider + ExportModal Context 바인딩·load-once + AudioTimeline 체크박스. (상태 단일화. v5: 체크박스=kenBurnsPreview, 모달=kenBurns — 의도적으로 독립.)
3. **M3 프리뷰 렌더**: PreviewPanel range/exportIndex/씬단위 비디오 + 프레임 wrapper + scaleMode 기저 배치(fill/fit/none) + transform 적용 + CSS. (눈검증: 줌/팬 + self-render 대조.)
- 각 M 끝에 Codex+Fable 리뷰 findings 0.
