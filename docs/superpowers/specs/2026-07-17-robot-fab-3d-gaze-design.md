# 스펙 — Robot FAB 진짜 3D + 마우스 시선 추적

작성: 2026-07-17 / 브랜치 `feature/inapp-agent` / HEAD `a65df62`
선행: `docs/superpowers/plans/2026-07-16-claude-orchestrator-HANDOFF.md` §3 (미완 과제)

**개정 v6** — v1 은 교차 리뷰(Codex gpt-5.6-sol xhigh + Fable 5, 독립 병렬)에서 **Critical 3 로 구현 착수 불가**, v2·v3 도 각 Critical 1. 라운드마다 **각 리뷰어가 상대가 못 본 Critical 을 하나씩** 잡았다. 리뷰 이력은 §8, 전체 원장은 `.superpowers/sdd/progress.md`.

---

## 0. 무엇을 만드나

FAB 로봇을 (a) **진짜 입체**로 보이게 하고 (b) **눈이 마우스 포인터를 쫓게** 한다.

사용자 피드백: 현재(`285e302`) 입체감이 **"아주 살짝"** — 불충분.

**두 기능은 같은 구조 변경을 공유한다.** 따로 하면 같은 파일을 두 번 뒤집는다. 하나의 작업이다.

---

## 1. 왜 지금은 안 되나 (진단 — 코드로 확인함)

### 1.1 "도는 종이" 문제
[`ChatPanel.css:95-105`](../../../src/components/agent/ChatPanel.css#L95) 이 평면 SVG **한 장**(`<img>`)을 통째로 `rotateY` 한다 → 회전해도 **명암이 안 따라 움직이고**(그라디언트가 SVG 안에 고정) 부위별 **시차가 없다**(모든 픽셀이 같은 Z). 그라디언트 명암은 **정지 상태의 볼륨**은 만들지만 **회전의 볼륨**은 못 만든다.

### 1.2 🔴 눈 추적은 지금 구조에서 **불가능하다**
[`ChatPanel.jsx:706`](../../../src/components/agent/ChatPanel.jsx#L706) 이 `<img src={robotUrl}>` 다. **`<img>` 로 로드된 SVG 내부에는 바깥 CSS 도 JS 도 닿지 못한다.** 현재 눈 애니메이션(`robot-look`, [`Robot.svg:55-59`](../../../src/assets/Robot.svg#L55))이 SVG 파일 안에 박혀 있는 이유가 그것이고, 고정 키프레임이라 마우스를 못 따라간다.

→ 눈 추적은 `<img>` 를 버려야만 가능하고, §1.1 의 해결책도 **똑같이** `<img>` 를 버려야 한다. **수렴한다.**

### 1.3 🔴 현재 hover 는 **이미 깨져 있다** (리뷰가 발견)
[`ChatPanel.css:107`](../../../src/components/agent/ChatPanel.css#L107):
```css
.agent-chat-fab:hover img { animation-play-state: paused; transform: rotateY(0deg) rotateX(0deg); }
```
**`paused` 애니메이션은 정지 시점의 값을 계속 적용한다** — 실행 중인 애니메이션이 author 선언을 이기기 때문이다. 즉 저 `rotateY(0deg)` 은 **죽은 선언**이고, 현재 hover 는 "정면 고정"이 아니라 **돌던 포즈에서 얼어붙는다**.

→ 이건 **고칠 대상이지 물려받을 계약이 아니다.** (v1 은 이 동작을 "기존 동작 유지"로 인용했다 — 깨진 걸 계약으로 베낀 것.)

### 1.4 검증된 사실 (설계의 토대)
- SVG **내부** 요소의 `transform-style: preserve-3d` 는 브라우저 지원이 부실하다 → **쓰지 않는다.**
- 그러나 **`<svg>` 요소 자체**는 평범한 CSS 박스다 → `preserve-3d` + `translateZ` 가 **제대로 먹는다.**
- ⚠️ **`perspective` 에 대한 정확한 진술** (v2 는 여기서 틀렸다): perspective 가 없어도 **시차 자체는 생긴다.** 정사영에서도 `rotateY(24°)` 는 Z 차 14px 을 `14×sin(24°) = 5.69px` 의 가로 이동으로 투영한다 — 이 값이 바로 §2.0 의 D 측면 노출값이다. perspective 가 **더하는 것**은 깊이별 축소/확대(foreshortening)와 좌우 비대칭이다(perspective 150 에서 셸 양쪽 edge 이동 ≈ 5.18px / 7.09px, perspective 없으면 양쪽 다 5.69px).
  → **그래도 `perspective: 150px` 은 반드시 보존한다** — 사용자가 눈으로 통과시킨 D preset 의 **구성요소**이기 때문이다. 근거는 "없으면 3D 가 0" 이 아니라 **"없으면 사용자가 승인한 그 물건이 아니다"** 다.

---

## 2. 설계

### 🔴 2.-1 구현 방법: **스파이크에서 포팅한다. 이 산문에서 재유도하지 마라.**

리뷰 3라운드에서 나온 **Critical 6개 중 5개가 같은 모양**이었다:

> *"스파이크는 이 seam 을 정확히 처리한다 — 스펙이 그 말을 안 했다."*

단위(동적/정적 둘 다) · 씬 루트 크기 · 개구부 · 코플레인 0.5px · perspective 소비자. **전부 [보존된 스파이크](./2026-07-17-robot3d-calibration-spike.html)에 이미 동작하는 코드로 있었고, 산문으로 옮겨 적는 과정에서 흘렸다.** 이 스펙의 churn 은 설계 문제가 아니라 **작동하는 코드를 자연어로 재작성하려 한 것**이 원인이다.

→ **CSS/마크업 생성 로직은 스파이크에서 포팅한다.** 대조 대상이 산문이 아니라 코드라 "스펙이 X 를 안 적었다" 유형이 **구조적으로 못 생긴다.**

**포팅 대상** (스파이크 = 참조 구현):
| 무엇 | 스파이크 위치 |
|---|---|
| 그라디언트 `<defs>` 6종 (stop 색·`userSpaceOnUse` 좌표 포함) + **0×0 홀더 패턴** | :29-35, :378-405 |
| 개구부 path (`SHELL_WITH_APERTURE`, evenodd) | :514 |
| 압출 슬라이스 생성 (공식 + 색 보간 + `z + 'px'`) | :524-530 |
| 씬 루트 / 레이어 CSS (48×48, absolute inset:0, 평면화 property 없음) | :207-245 |
| 정적 z/perspective 의 `'px'` 부착 | :591-598 |
| 동적 gaze var 의 `'deg'`/`'px'` 부착 + fallback | :256, :640-663 |
| 레이어 마크업 순서 | :537-566 |

**포팅하지 않는 것** (§2.0 화이트리스트 참조): 시간 안무(`robot-turn` 키프레임) / `robot-look` / reduced-motion 동작 / hover / 복귀 semantics / `.perspective-box` **구조**(§2.1 참조 — 스파이크의 구조 선택이지 계약이 아니다).

**이 스펙의 역할**: 건설 설명서가 아니라 **계약**이다 — 상수(§2.0) · 순수 함수 진리표(§2.4) · 상태 머신(§2.5) · 테스트·뮤턴트(§3) · 눈검증(§5).

### 2.0 🔴 숫자는 추론으로 정하지 않는다 — visual spike 가 정한다

리뷰(Codex)가 v1 의 전제를 수학으로 흔들었다: FAB 72px − 패딩 12px → 아이콘 **~48px**. 깊이 8px 을 14° 로 돌리면 측면 노출 `8×sin(14°) ≈ 1.94px`; perspective 220px 포함 시 양쪽 edge 차이 **~1.5–2.5px**. 압출 6장이면 층당 투영 간격 **0.39px**, 9장이면 **0.24px**.

→ **기하학적 두께가 아니라 1–2px 색 띠로 보일 수 있다 = 또 "아주 살짝".**

그리고 v1 은 gaze 시 yaw 를 24°→14° 로 **줄였다**(시선 리얼리즘). 리뷰 지적: **사용자가 상호작용하는 바로 그 순간 3D 신호가 가장 약해진다.** "머리가 덜 돌아야 사실적" 과 "입체로 보여야 한다" 가 정면충돌한다.

**이 트레이드오프는 계산으로 못 푼다.** 캘리브레이션 스파이크(보존본: `2026-07-17-robot3d-calibration-spike.html`, 이 스펙 옆)로 **사용자가 48px 에서 눈으로 확정했다.**

### ✅ 확정 (2026-07-17, 사용자 눈검증)

4개 완성된 후보(A 평면 기준선 / B 은은 / C 뚜렷 / D 과감)를 실제 48px 로 나란히 놓고 **"A 보다 확실히 나은 게 있나"** 하나만 물었다. (묻는 방식을 찾기까지의 과정은 `.superpowers/sdd/progress.md`.)

| | 측면 노출 @yaw | 사용자 판정 |
|---|---|---|
| depth 8 (1차 기본값) | ~1.94px | **"확실히는 아니고, 약간"** ← 폐기 조건에 걸림 |
| B 은은 (depth 6) | ~1.45px | — |
| C 뚜렷 (depth 10) | ~3.42px | — |
| **D 과감 (depth 14)** | **~5.69px** | ✅ **"확실히 나음"** |

🔴 **교훈**: 추론으로 고른 기본값(depth 8)이 정확히 **"안 보이는 구간"** 이었다. 이 숫자들은 재협상 대상이 아니다 — 바꾸려면 스파이크를 다시 돌려 사용자에게 물어라.

| 파라미터 | v1 추정 | **확정 (D)** |
|---|---|---|
| `perspective` | 220px | **150px** |
| 압출 depth | 8px | **14px** |
| 압출 slice 수 | 6–9 | **10** |
| `z-face` | 9 | **14.5** ⚠️ |
| `z-glass` | (미정) | **12.9** |
| `z-eyes` | 8 | **12.5** |
| `z-screen` | 7 | **10** |
| `z-limb` (= 전구 = 스템) | 4 | **6** |
| `z-ground` (접지 그림자) | (미정) | **-1** (승인된 스파이크 그대로 — §2.1) |
| `maxYaw` | 14° | **24°** |
| `maxPitch` / `maxEye` | 8° / 2.6px | **8° / 2.6px** (미검증 — §5 눈검증에서 확인) |
| gaze `radius` | 320px | **320px** (미검증 — 동상) |

### 🔴 "스파이크가 정본" 의 **범위** — 넓게 말하면 거짓이다

[`2026-07-17-robot3d-calibration-spike.html`](./2026-07-17-robot3d-calibration-spike.html) (이 스펙 옆). 리뷰가 위 표를 그 파일의 `D` preset(:478~) 및 CSS(:207-245)와 **필드별로 대조**했고 전부 일치한다.

| 무엇 | 정본 | 이유 |
|---|---|---|
| 지오메트리 / Z 값 / depth / slices / perspective / perspective-origin / maxYaw·Pitch·Eye / radius / 압출 색 / 개구부 / 레이어 배치 | ✅ **스파이크** | 사용자가 눈으로 판정한 건 이 파일이다 |
| **시간 안무** (`robot-turn` 키프레임, `robot-look`, reduced-motion) | ✅ **현재 프로덕션** ([`ChatPanel.css:100`](../../../src/components/agent/ChatPanel.css#L100)) | 스파이크는 이걸 검증하지 않았다 |

⚠️ **v4 의 "값이 갈리면 스파이크가 이긴다" 는 너무 넓었고 실제로 위험했다** (리뷰가 잡음):
- 스파이크의 `robot-turn` **0% 는 `rotateY(-24deg)`** 인데 **현재 프로덕션은 0% 가 정면(`rotateY(0)`)** 이다. §2.5 의 CSS-only 복귀는 **0% 가 identity 인 것을 전제**한다 → 스파이크를 정본으로 따르면 시선에서 0° 로 부드럽게 돌아온 직후 **0° → -24° 로 스냅**한다. transitionend race 를 없애고 **다른 모양의 스냅**을 만들 뻔했다.
- 스파이크엔 `robot-look` 자체가 없고, reduced-motion 에서 head 애니메이션을 끄지도 않는다. 제품은 **둘 다** 요구한다.

→ **`robot-turn` 의 0% 가 identity 임을 테스트/뮤턴트로 핀한다** — §2.5 복귀 계약이 거기 얹혀 있다.

#### 회전 순서 — 하나를 고른다
3D 회전은 **교환법칙이 성립하지 않는다.** 스파이크는 `rotateX(pitch) rotateY(yaw)`, v4 계약은 `rotateY(yaw) rotateX(pitch)` 였다 — pitch 8° / yaw 24° 에서 **다른 자세**다.
→ **채택: `rotateY(yaw) rotateX(pitch)`** (현재 프로덕션 [`ChatPanel.css:101-104`](../../../src/components/agent/ChatPanel.css#L101) 의 순서). 근거: `maxPitch` 는 **아직 미검증**이라(§5) 스파이크가 그 축에 대해 아무것도 증명하지 않았다 → 제품 관습을 따르고 눈검증에서 확인하는 게 정직하다.

#### 복귀 duration
`--robot-return-duration` **하나**를 head/eyes 의 `transition-duration` 과 `animation-delay` **양쪽에** 쓴다. 두 값을 따로 적으면 drift 한다(v4 는 값 자체가 없었다).

### 🔴 확정값은 **테스트로 핀한다** (R2 Critical — v2 는 안 했다)

v2 는 숫자를 표에만 적었다. 리뷰 지적: 구현자가 `perspective 220 / depth 8 / slices 6 / maxYaw 14` 를 넣어도 — **사용자가 "약간" 으로 FAIL 판정한 바로 그 설정** — "perspective 존재 / Z 강증가 / screen<eyes<face" 를 전부 만족해 **모든 자동 게이트를 통과한다.** 즉 **오늘 사용자의 눈으로 산 유일한 성과에 회귀 방지가 하나도 없었다.**

→ 확정값을 **단일 상수 계약**으로 만든다:
```js
// src/components/agent/robotConfig.js
export const ROBOT_3D = Object.freeze({
  perspective: 150, perspectiveOrigin: '50% 50%', depth: 14, slices: 10,
  zFace: 14.5, zGlass: 12.9, zEyes: 12.5, zScreen: 10, zLimb: 6, zGround: -1,
  maxYaw: 24, maxPitch: 8, maxEye: 2.6, radius: 320,
})
```
⚠️ 전부 **숫자**다 → CSS 로 나갈 때 **`px` 를 붙여야 한다**(§2.6 단위 계약). 이 값들을 그대로 var 에 넣으면 3D 가 통째로 죽는다.
`robotConfig.test.js` 가 이 값들을 **정확히** assert 한다(관계가 아니라 값). 근거 주석: *"이 숫자는 추론이 아니라 2026-07-17 사용자 눈검증(A/B/C/D @48px)의 산물이다. 바꾸려면 스파이크를 다시 돌려라."*

⚠️ **`z-face` 는 14 가 아니라 14.5 다** — depth 14 면 최전방 압출 슬라이스가 정확히 Z14 에 앉아 **코플레인**이 된다(페인트 순서 비결정). Codex 가 스파이크 빌드 중 잡아 0.5px 띄웠다. **이 값을 14 로 "정리" 하지 마라 — 버그다.**

🔵 **D 채택의 부수 효과**: `maxYaw` 24° = 자동회전과 동일 → 리뷰가 잡은 *"gaze 진입 시 3D 신호가 최약"* 문제가 **사라진다**. 대가로 v1 의 "머리가 눈보다 덜 돌아야 사실적" 이라는 의도는 **폐기됐다** — 추론보다 눈이 이긴다.

⚠️ **잔존 위험**: D 는 **판때기(slab)로 보일 위험**이 가장 큰 후보다. 사용자가 스파이크에서 통과시켰으나 그건 **정지 배경의 격리된 로봇**이었다. §5 눈검증에서 **실앱 맥락**(도킹/Flow/스크롤 위)으로 재확인한다.

**폐기 조건 (통과함)**: 스파이크가 "레이어드가 평면보다 확실히 낫다" 를 증명하지 못하면 설계 폐기. 기준선은 현재 구현. → **D 로 통과.**

### 2.1 레이어 구조

`<img src={robotUrl}>` → **`RobotIcon.jsx`** (신규). 부위별 인라인 `<svg>` 를 절대배치로 겹치고 컨테이너에 `preserve-3d`.

#### 🔴 씬 루트 계약 — **다섯 번째 무동작 입구** (v4 는 `preserve-3d` 한 줄만 적었다)
자식 `<svg>` 가 전부 `position:absolute` 라 **부모의 intrinsic size 에 기여하지 않는다.**

- **크기 없음 → 안 보임**: 구현자가 `.robot-icon { position: relative }` 만 주면 grid item 이 **0×0** → `inset:0; width:100%` 인 레이어도 **0×0** → **로봇이 통째로 안 보인다.** DOM·레이어·var·애니메이션 테스트 **전부 초록.**
- **평면화 → 3D 사망**: 레이어를 담으려고 `overflow: hidden` 을 넣으면 — 흔한 본능이다 — `transform-style: preserve-3d` 의 **used value 가 `flat` 이 된다.** `translateZ` 도 `perspective` 도 다 선언돼 있는데 자식이 먼저 평면화되어 **3D 만 조용히 죽는다.**

```css
/* perspective 는 FAB 이 소유한다. 값은 CSS 리터럴이 아니라 ROBOT_3D 에서 온다 — 아래 참조 */
.robot-icon {
  position: relative;
  width: 48px; height: 48px;      /* 🔴 없으면 0×0 */
  transform-style: preserve-3d;
  overflow: visible;              /* 🔴 hidden 이면 preserve-3d → flat */
}
.robot-icon-layer { position: absolute; inset: 0; width: 100%; height: 100%; }
```

⚠️ **스파이크의 `.perspective-box` 래퍼는 포팅하지 않는다.** 스파이크는 perspective 를 FAB 이 아니라 중간 요소에 두는데(:207-214), 그건 **스파이크의 구조 선택이지 계약이 아니다.** 제품에선 perspective 를 **`.agent-chat-fab` 에 유지**하고(이미 거기 있다), 씬 루트 요건(48×48 + preserve-3d)은 **`.robot-icon` 자체로** 충족한다 — **새 래퍼 불필요.**
*(리뷰가 잡은 충돌: 스파이크 구조를 그대로 수입하면 perspective 위치를 `.agent-chat-fab` 에 핀하는 테스트가 **올바른 구현을 빨갛게 만든다.** 둘이 기하학적으로 동치인 건 아이콘이 정중앙이라서일 뿐이다 — 72px FAB, 대칭 padding 12 → 두 origin 이 같은 점.)*

#### 🔴 `perspective` 의 **소비자를 정의한다** — 여섯 번째 입구
v5 까지 `ROBOT_3D.perspective = 150` 은 **아무도 안 읽는 상수**였다. §2.1 다이어그램에 CSS 선언으로만 나타나고, **그 값을 그 선언에 연결하라는 문장이 없었다.**

**그 결과** (리뷰가 cascade 를 실측):
- `robotConfig.test.js` 가 150 assert → **초록** (아무것도 소비 안 함)
- perspective 위치 테스트 → **초록**
- 뮤턴트 15(150→220)를 config 에 적용 → config 테스트가 죽임 → **KILLED** (렌더와 무관)
- **실제 computed perspective = 220px / origin 50% 45%** — 사용자가 FAIL 판정한 값이 라이브

**메커니즘**: [`ChatPanel.jsx:23`](../../../src/components/agent/ChatPanel.jsx#L23) 이 `ChatPanel.css` 를 컴포넌트 import(:10-12) **뒤에** import 한다 → 번들에서 `RobotIcon.css` 가 **먼저** 온다 → §2.3 을 따라 `.agent-chat-fab { perspective: 150px }` 를 RobotIcon.css 에 쓰면 **동일 specificity 인 [`ChatPanel.css:94`](../../../src/components/agent/ChatPanel.css#L94) 의 `220px` 가 cascade 에서 이긴다.**

→ **계약**: perspective / perspective-origin 을 **`ROBOT_3D` 에서 FAB 호스트의 inline style 로 write** 한다(§2.6 단위 규칙 적용 → `` `${ROBOT_3D.perspective}px` ``). inline style 은 cascade 를 이기고, **config 테스트가 렌더를 실제로 지킨다.**
→ **§4 가 `ChatPanel.css:91-110` 철거를 명령한다** (아래).

#### 🔴 `@keyframes robot-turn` 은 **문서 전역 이름**이다
[`ChatPanel.css:100-105`](../../../src/components/agent/ChatPanel.css#L100) 가 남은 채 `RobotIcon.css` 가 같은 이름을 정의하면 **번들 순서상 ChatPanel.css 가 이겨 RobotIcon.css 의 키프레임이 조용히 죽는다.**
→ **키프레임의 소유 파일을 한 곳으로 지정하고 중복 정의를 금지한다.** (§2.0 화이트리스트상 안무는 **프로덕션이 정본**이므로 `robot-turn` 은 `ChatPanel.css` 에 **남기고** `RobotIcon.css` 는 정의하지 않는다.)

🔴 **`.robot-icon` 에 grouping property 금지**: `overflow: hidden` / `opacity < 1` / `filter` / `clip-path` / `contain: paint` — **전부 `preserve-3d` 를 `flat` 으로 만든다.**
→ **테스트**: 씬 루트가 0 아닌 크기를 가지는가 / `preserve-3d` 가 선언됐는가 / 평면화 property 가 **없는가**. **뮤턴트**: width·height 제거 / `overflow: hidden` 추가.
*(보존된 스파이크 :207-245 가 정본 — 48×48 perspective box, 100% stack, absolute inset:0 레이어, 평면화 property 없음.)*

```
.agent-chat-fab            perspective / perspective-origin
                           🔴 ROBOT_3D 에서 **inline style** 로 write (CSS 리터럴 금지 — 아래)
└ .robot-icon              preserve-3d + 48×48 + overflow:visible
  ├ 접지 그림자             translateZ(-1)    z-ground  ← 승인된 스파이크 그대로 (아래)
  ├ 팔 + 안테나 스템        translateZ(6)     z-limb
  ├ 셸 압출 ×10            translateZ(0 .. 14), 뒤일수록 어둡게, 전부 개구부
  ├ 스크린(오목)            translateZ(10)    z-screen
  ├ 눈 + 미소              translateZ(12.5)  z-eyes
  ├ 유리 하이라이트          translateZ(12.9)  z-glass
  ├ 셸 앞면                translateZ(14.5)  z-face
  └ 안테나 전구             translateZ(6)     z-limb  (= 스템과 동일 평면)
```

#### 🔴 압출 Z **공식** (값 목록만으론 부족 — R2)
```
z_i = depth × i / (N - 1),  i = 0 .. N-1    // 양 끝점 포함
```
depth 14 / N 10 → `0, 1.5556, 3.1111, 4.6667, 6.2222, 7.7778, 9.3333, 10.8889, 12.4444, 14`

⚠️ **공식을 안 적으면 조용히 깨진다**: 구현자가 `depth × (i+1)/N` 이나 `× i/N` 을 쓰면 최전방 슬라이스가 **12.6** 에 앉아 `z-face 14.5` 아래 **1.9px 공기층**이 생긴다 — `z-face` 를 14.5 로 둔 근거(최전방 슬라이스 14 보다 0.5 앞)가 통째로 무너지는데 **"Z 강증가" 테스트는 통과한다.** (보존된 스파이크 :524-526 가 정본.)

**Z 전수 검증** (리뷰가 전체 집합 `{-1, 0, 1.556..14, 6, 10, 12.5, 12.9, 14, 14.5}` 로 대조):
- 코플레인 **없음**. 최소 간격: `z-limb 6` ↔ 슬라이스 `6.2222` = **0.222**, `z-glass 12.9` ↔ `z-eyes 12.5` = **0.4** ✓
- `z-eyes 12.5` ↔ 최근접 슬라이스 `12.4444` = 0.0556px — 코플레인 아니고, 모든 슬라이스에 개구부가 있어 불투명 지오메트리와 안 겹친다 ✓
- `z-screen 10` 앞의 슬라이스 `10.8889 / 12.4444 / 14` **3장** — "모든 슬라이스에 개구부" 규칙이 덮는다 ✓
- 24° 에서 개구부 터널이 **자기봉합**: 스크린 가장자리 뒤 shear 밴드는 바로 뒤 슬라이스가 덮고, 눈은 eyeX+시차 합쳐도 개구부 여유 **~1.8px** 유지, 팔은 측벽 부채꼴 안에 든다 ✓
- `z-limb 6` 의 팔 **안쪽** 접합부는 전방 슬라이스에 가리고 바깥(x=8..13 / 51..56)은 보인다 — **현재 SVG 도 팔을 셸보다 먼저 그리므로 오클루전이 일관된다** ✓
- `z-face 14.5` ↔ 슬라이스 `14` = 0.5px. 🔴 **이 0.5 를 "정리" 하지 마라 — 14 로 두면 코플레인이다.**

#### 접지 그림자 — **승인된 대로 둔다** (리뷰어 둘이 갈렸고, 내가 raw 로 판정)
현재 [`Robot.svg:72`](../../../src/assets/Robot.svg#L72) 는 ellipse `(32,49.5) r15×2.2` 를 셸 **다음에** 그려 바닥을 어둡게 하는 **2D 눈속임 오버레이**다.

- **Codex**: 스펙의 "맨 뒤" 는 새 paper design 이다 — ellipse 가 대부분 셸 안쪽이라 뒤에 두면 가려 사라진다 → 앞면과 같은 평면으로 **옮겨라**.
- **Fable**: 보존된 스파이크가 **정확히 `.layer-ground { translateZ(-1px) }`** 이고 **사용자는 그 상태의 D 를 승인했다.** 스펙은 승인된 물건을 충실히 기술한 것이지 지어낸 게 아니다. **승인된 모습을 "고치려고" 옮기지 마라.**

**판정: Fable 이 맞다.** 스파이크 파일을 열어 `.layer-ground { transform: translateZ(-1px); }` (:238)를 확인했다. v3 이 이걸 "고친다" 며 옮긴 건 **과잉교정** — 사용자가 본 적 없는 모습으로 바꾸는 것이고, 그러면 그 승인이 더 이상 이 설계를 덮지 못한다.

→ **`translateZ(-1)` 유지.** 결과적으로 이 레이어는 **거의 죽은 장식**이다(슬라이스 z=0 뒤에 가리고, `x<19.2 / x>44.8 / y>51` 의 가장자리 조각만 비친다).
⚠️ **사용자는 그림자가 안 보이는 걸 몰랐고 나도 몰랐다** — 승인은 **사용자가 볼 수 없었던 디테일까지 덮지 않는다.** → **§5 눈검증에서 결정: 유지 / 삭제.** (옮기는 선택지는 없다 — 그건 재검증이 필요한 새 모습이다.)

#### 🔴 개구부(aperture) — v1 의 Critical 결함
셸은 **구멍 없는 불투명 `rect 13,17 38×34`** 다. `preserve-3d` 는 **진짜 깊이 정렬**을 하므로, 앞면(Z9)이 스크린(Z7)과 눈(Z8)을 **전 각도에서 덮는다** → **얼굴 없는 흰 로봇**. v1 은 구멍을 안 뚫었다.

**규칙**: 셸 앞면 **및 `Z >= z-screen` 인 모든 압출 슬라이스**는 스크린 모양 구멍을 가진 path 여야 한다 (`fill-rule="evenodd"` 로 셸 외곽 + 스크린 rect 를 서브패스로).

*(스파이크 구현 노트: Codex 는 **모든** 슬라이스에 구멍을 뚫었다 — 조건부보다 단순하고 안전하다. 슬라이스가 스크린보다 뒤여도 구멍이 있어 손해가 없다. 이 방식을 채택한다.)*

#### 코플레인 금지
v1 은 압출을 `0..8`, 눈을 `8` 에 둬서 **최전방 슬라이스와 눈이 같은 평면** → 페인트 순서 비결정. **어떤 두 레이어도 같은 Z 를 갖지 않는다** (전구·스템은 예외 — 아래).

#### Z 근거 (v1 의 틀린 근거 교체)
- **전구**: 셸 `rect` 는 y=17 부터인데 전구는 `circle cx=32 cy=8 r=4` — **셸 밖**이라 애초에 오클루전이 없다. v1 은 "앞으로 튀어나온다" 를 근거로 댔는데 **틀렸다**. 진짜 이유는 **스템과 같은 Z 여야 회전 중 전구가 스템 끝에 붙어 있는다** (핸드오프의 Z12 면 전구가 스템에서 옆으로 미끄러져 분리돼 보인다). → 전구·스템은 **의도적으로 같은 Z**.
- **눈**: v1 은 "눈(Z8)이 셸보다 더 크게 움직여서 그 시차가 3D 신호의 전부" 라고 썼는데 **틀렸다.** 시차는 Z 에 비례하므로 눈(Z8)은 **앞면(Z9)보다 덜** 움직인다. 참인 진술은: 눈은 **후방·중간 압출 층 대비** 더 움직인다. 3D 신호는 **층들 사이의 상대 시차 전체**에서 나오지 눈 하나에서 나오지 않는다.
- ⚠️ v1 의 Z 값(9/7/8/4)은 **물리적 추론일 뿐 실측이 아니다.** §2.0 스파이크가 확정한다.

### 2.2 압출 — 덩어리감
셸 실루엣(개구부 포함)을 Z 0→depth 에 여러 장 겹치고 뒤쪽일수록 어둡게(`#5A6A85` → `#B9C6DE` 보간). 회전 시 층들이 서로 다른 속도로 미끄러지며 옆면을 만든다.

장수·깊이는 §2.0 스파이크가 정한다. **판정 기준: 줄무늬(banding)로 보이면 실패, 연속된 두께로 보여야 한다.** 성능: 정적 SVG 레이어 10장은 이번 범위에서 수용한다(애니메이션은 컨테이너 하나). 실앱 눈검증/프로파일링 전엔 최적화하지 않는다.

### 2.3 🔴 인라인 SVG 의 `<style>` 은 전역이다
[`Robot.svg:39-67`](../../../src/assets/Robot.svg#L39) 의 `<style>` 셀렉터는 `.eye` / `.eyes` / `.antenna` 다. `<img>` 로 로드될 땐 격리돼 안전하지만, **인라인하는 순간 HTML 문서의 전역 CSS 가 된다** (JSX 포함, 위치 불문).

→ 인라인 SVG 에 `<style>` 을 **넣지 않는다.** 스타일은 `RobotIcon.css` 에서 `.robot-icon` 하위로 스코프한다.

⚠️ **예외 2건** (v5 의 "모든 스타일" 은 만족 불가능한 규칙이었고, 그 문장이 여섯 번째 입구의 함정을 만들었다):
1. **`perspective` / `perspective-origin`** — 회전하는 요소의 **조상**(`.agent-chat-fab`)에 있어야 하므로 구조상 `.robot-icon` 스코프 밖이다. → `ROBOT_3D` 에서 **inline style** 로 write 한다(§2.1).
2. **` robot-turn`** — 문서 전역 이름이라 스코프 불가. → `ChatPanel.css` 가 소유하고 `RobotIcon.css` 는 정의하지 않는다(§2.1).

### 2.4 시선 추적 — 순수 함수 seam

jsdom 은 레이아웃 계산을 안 한다(`getBoundingClientRect` 가 0) → 추적 각도를 DOM 테스트로는 **증명할 수 없다.** 수학을 순수 함수로 빼면 단위 테스트와 뮤테이션이 진짜로 물린다. (원장 교훈: *소스 문자열 핀 대신 순수 술어 + 진리표*.)

```js
// src/components/agent/robotGaze.js — DOM 무의존, 순수
// 전제조건: radius > 0. (radius=0 이면 dx/radius = 0/0 = NaN.)
computeRobotGaze({ fabCenter, pointer, radius, maxYaw, maxPitch, maxEye })
  → { engaged, yaw, pitch, eyeX, eyeY }
```

**진리표** — ⚠️ **비제품 fixture 다.** (radius=320, **maxYaw=14**, maxPitch=8, maxEye=2.6, fabCenter={0,0})

🔴 이 표의 `maxYaw=14` 는 **제품 값(24)이 아니다.** 순수 함수는 **임의 파라미터에서** 동작해야 하므로 fixture 로 임의값을 쓰는 게 옳고, 제품 상수를 여기 끌어오면 사용자가 나중에 재튜닝할 때 이 표가 이유 없이 깨진다. **대신 제품 값은 `robotConfig.test.js` 가 §2.0 의 상수 계약으로 따로 핀한다.** 두 테스트는 다른 것을 지킨다 — 여기는 **수학**, 저기는 **사용자가 눈으로 산 숫자**.
*(v2 는 이 구분 없이 표만 뒀다 → 리뷰 지적: FAIL 판정난 설정이 전 게이트를 통과할 수 있었다.)*

| pointer | engaged | yaw | pitch | eyeX | eyeY | 이 행이 죽이는 뮤턴트 |
|---|---|---|---|---|---|---|
| `{0,0}` | true | 0 | 0 | 0 | 0 | 오프셋 상수 주입 |
| `{320,0}` (우, 반경 끝·경계) | true | **+14** | 0 | **+2.6** | 0 | 부호 반전 / 스케일 / `<` vs `<=` |
| `{-320,0}` (좌) | true | **-14** | 0 | **-2.6** | 0 | 부호 반전 |
| `{0,-320}` (위) | true | 0 | **+8** | 0 | **-2.6** | yaw/pitch 축 뒤바뀜 |
| `{160,0}` (우, 절반) | true | +7 | 0 | +1.3 | 0 | 선형성 — 이진 on/off 뮤턴트 |
| `{321,0}` | **false** | 0 | 0 | 0 | 0 | 경계 |
| **`{260,260}`** (dist≈367.7) | **false** | 0 | 0 | 0 | 0 | 🔴 **`dist<=radius` → `abs(dx)<=r && abs(dy)<=r`** (원형 vs 사각형) |

*(리뷰 둘 다 이 표의 산술을 행별로 검증했다: `hypot(260,260)=367.6955 > 320` 확인, 각 행이 주장한 뮤턴트를 실제로 죽인다. v1 에 있던 `{320,0}` 중복 행은 제거했다.)*

**부호 규약**: `yaw>0` = 포인터가 오른쪽일 때 로봇의 **오른쪽 면이 보이도록** 돈다. `pitch>0` = 포인터가 **위**일 때 얼굴이 위를 향한다. CSS `rotateX` 부호는 구현이 이 규약에 맞춰 고르고 눈검증으로 확인한다.

**clamp 는 넣지 않는다.** `engaged` 가 `dist<=radius` 를 요구하므로 `|dx| <= dist <= radius` → `dx/radius ∈ [-1,1]` 이 항상 참(radius>0 전제). clamp 는 **dead code** 이고 죽는 뮤턴트가 없다. 추측성 기능 금지.

### 2.5 🔴 상태 머신 — v1 의 Critical 결함이 여기 있었다

**v1 의 치명적 누락**: idle 은 컨테이너에 CSS `animation: robot-turn`(transform 을 애니메이트), gazing 은 **같은 요소의 같은 속성**에 `transform: rotateY(var(--robot-yaw))`. **실행 중인 애니메이션은 author 선언(인라인 스타일 포함)을 이긴다** → **gazing 이 조용히 아무것도 안 한다.** var 는 60fps 로 써지고 jsdom 테스트는 전부 초록인데 실앱은 추적 전무. (원장의 "테스트 6013 초록인데 실앱 데드락" 패턴.)

**`animation-play-state: paused` 는 해법이 아니다** — paused 애니메이션도 transform 을 계속 점유한다. §1.3 이 그 실물 증거다.

**우선순위**: `reduced-motion > hover > gazing > idle`

🔴 **우선순위의 *메커니즘*을 명시한다** (R2 M-1 — v3 은 순서만 적고 배선을 안 적었다). hover 는 CSS 의사클래스, gazing 은 data 속성 + 매 프레임 var 쓰기다. `.agent-chat-fab:hover .robot-icon` 이 `[data-motion-state="gazing"] .robot-icon` 을 이기는지는 **specificity 우연**이고, 그 상태로는 **뮤턴트 9(hover 우선순위 제거)를 작성할 수조차 없다.**
→ **hover 를 CSS 에 맡기지 않는다.** 포인터가 FAB 위인지도 `computeRobotGaze` 와 같은 rAF 경로에서 판정해 **`data-motion-state` 하나가 네 상태를 전부 소유**한다(`idle` / `gazing` / `hover` / `reduced`). 단일 owner = 우선순위가 코드로 표현되고 테스트·뮤테이션이 가능하다.

**hover 히트 형상**: JS 판정은 gBCR 이라 **사각형**인데 FAB 은 `border-radius:50%` 라 CSS `:hover` 는 **원형**이다 → 모서리 지대가 어긋난다. **JS 쪽을 원형으로 맞춘다**(`dist <= 36px`, FAB 72px 의 반지름) — §2.4 의 원형 판정과 같은 규약이고, 어차피 `dist` 는 이미 계산돼 있다.

**hover 중 눈**: 머리는 정면 고정, **눈은 계속 추적한다** (머리만 멈추고 눈이 따라오는 게 "쳐다보는 중" 으로 읽힌다). ⬜ **§5 눈검증 항목** — 이건 추론이다.

| 상태 | 조건 | transform owner | 메커니즘 |
|---|---|---|---|
| **idle** | 포인터 반경 밖 | `robot-turn` 애니메이션 | 기본 |
| **gazing** | 포인터 반경 안 | var-driven `transform` | 🔴 **`animation: none`** (`paused` 아님) |
| **hover** | 포인터가 FAB 위 | 정면 고정 `rotateY(0)` | 🔴 **`animation: none`**. §1.3 의 버그 수정 |
| **reduced-motion** | `prefers-reduced-motion` | 정면 고정 | 리스너 **미등록**, 애니메이션 없음 |

배선: ref 로 컨테이너에 `data-motion-state` 를 토글한다. 상태 전이는 저빈도이므로 React state 든 `classList` 든 무방하다(§2.6 의 매-프레임 제약과 무관).

**눈도 동일한 충돌이 있다**: 캔드 시선 `robot-look` 이 `.eyes` 그룹의 transform 을 점유하므로 eyeX/eyeY var 도 같은 토글이 필요하다. **깜빡임 `robot-blink` 은 자식 `.eye` 의 별도 transform 이라 중첩 구조를 유지하면 공존한다** — gazing 중에도 깜빡여야 한다.

#### 전이 semantics
- **gazing 중 transition 금지**: `transition: transform` 이 살아 있으면 매 프레임의 var 쓰기가 각각 transition 을 **재타게팅**해 추적이 늘어진다. transition 은 **상태 전이 시에만** 건다.

#### 🔴 gazing→idle 복귀 — v2 의 "transitionend 후 재부착" 은 **데드락이다**
v2 는 *"0 복귀 transition 완료 후 애니메이션 재부착"* 이라고 썼다. 리뷰가 실패 시나리오를 냈다:

> 포인터가 **FAB 중심**에 있어 gaze transform 이 **이미 `0deg`** 인 상태에서 창을 벗어난다 → idle 리셋이 transform 을 0 으로 "다시" 설정해도 **값이 안 변하니 transition 이 시작되지 않고** → `transitionend` 가 **영영 안 온다** → 그 이벤트를 기다리던 재부착이 **영구 정지**.

같은 병의 다른 입구: 복귀 중 재진입 / 패널 open 으로 transition 취소 / stale `transitionend` 가 새 gazing 을 idle 로 덮어씀. v2 는 상태를 4개로 뒀지만 "애니메이션 없이 0 으로 돌아가는 중" 은 **실질적 5번째 상태**다.

→ **채택: JS 없는 CSS-only 해법** (리뷰 제안, race 자체가 존재하지 않음):
idle 애니메이션에 **0 복귀 duration 만큼 `animation-delay`** 를 주고 **`animation-fill-mode: none`**. delay 동안 underlying transform 이 transition 으로 0 에 도달하고, delay 가 끝나면 `robot-turn` 의 0% 키프레임(= `rotateY(0)`)이 **그 지점에서 이어받는다**. `transitionend` 도, generation guard 도, 5번째 상태도 필요 없다.

*(JS 시퀀싱을 고집한다면 `returning` 상태 + generation guard + "이미 0" 폴백 + cleanup 을 전부 명시하고 테스트해야 한다. 그 복잡도를 살 이유가 없다.)*

🔴 **눈에도 똑같이 적용한다** (R2 M-2 — v3 은 머리/`robot-turn` 만 썼다): `robot-look` 을 재부착하면 **눈 translate 가 0% 키프레임으로 스냅한다**. 같은 `animation-delay` + `fill-mode: none` 을 `.eyes` 에도 건다.

### 2.6 배선

```
window pointermove → rAF 스로틀 → getBoundingClientRect(FAB) → computeRobotGaze()
                                → ref.current.style.setProperty('--robot-yaw', `${yaw}deg`)
```

#### 🔴 단위 계약 — **JS 숫자가 CSS 로 건너가는 모든 지점** (v3 Critical, v4 는 절반만 고쳤다)

**불변식 (인스턴스 목록이 아니라 이것을 지켜라)**:
> **JS 숫자가 CSS custom property 로 나가는 순간, 그 seam 이 단위를 붙인다. 예외 없음.**

숫자를 그대로 내보내면 → `rotateY(14)` / `translateZ(14.5)` = 유효하지 않은 `<angle>`/`<length>` → CSS 는 **invalid at computed-value time** 으로 처리 → **그 `transform` 선언 전체가 `none` 으로 붕괴**.

| var | 타입 | 단위 | 출처 |
|---|---|---|---|
| `--robot-yaw` / `--robot-pitch` | `<angle>` | **`deg`** | `computeRobotGaze` (동적, 매 프레임) |
| `--eye-x` / `--eye-y` | `<length>` | **`px`** | `computeRobotGaze` (동적) |
| `--robot-perspective` | `<length>` | **`px`** | `ROBOT_3D` (정적) |
| `--z-face` / `--z-glass` / `--z-eyes` / `--z-screen` / `--z-limb` / `--z-ground` | `<length>` | **`px`** | `ROBOT_3D` (정적) |
| `--slice-z` ×10 | `<length>` | **`px`** | 압출 공식 (정적) |

🔴 **v4 는 동적 절반만 고치고 정적 절반을 열어뒀다.** `ROBOT_3D.zFace` 는 숫자다 — `style={{'--z-face': ROBOT_3D.zFace}}` 면 `translateZ(14.5)` → **모든 레이어 transform 이 `none` → Z 전체가 평면으로 붕괴.** exact-value config 테스트도, Z 관계 테스트도, 개구부 테스트도 **전부 초록.** 실패 유형은 **네 번째 입구**로 똑같다.

**이게 이 스펙이 반복해서 저지른 병이다**: 지목된 **인스턴스**를 고치고 **종류**를 안 고침. (`active={!open}` 때도 같았다 — §2.6 "포인터가 사라진다는 구멍의 종류다" 를 쓰면서 단위는 인스턴스로만 고쳤다.)

**게이트가 없다** — jsdom 은 var 를 합성하지 않으므로 "var 를 썼나" 도 "var 를 소비하나" 도 **양쪽 다 초록**이다.
→ **테스트**: 렌더된 **모든** 레이어의 transform 문자열이 `translateZ(<number>px)` 인지 + perspective 가 실제로 `150px` 인지 + `setProperty` 로 쓰인 문자열이 단위로 끝나는지.
→ **뮤턴트**: 동적 단위 제거 / **정적 Z 단위 제거** / **perspective 단위 제거**.

🔴 **소비자는 fallback 을 쓴다**: `translate(var(--eye-x, 0px), var(--eye-y, 0px))`. §2.5 의 idle 리셋이 var 를 **지우는데**(unset) fallback 없는 소비자와 겹치면 그 프레임에 **invalid-at-computed-value → `transform: none`** 이 뜬다 — 같은 병의 또 다른 입구. (보존된 스파이크 :256 가 fallback 을 쓴다. 또 정답이 거기 있었다.)
*(보존된 스파이크는 이 seam 을 **전부** 처리한다 — 동적 :660-663 `'deg'`/`'px'`, 슬라이스 :529-530 `z + 'px'`, 정적 z/perspective :591-598 `'px'`. 정답이 세 번 다 손에 있었는데 계약으로 승격을 안 했다.)*

**React state 를 매 프레임 쓰지 않는다** — 60fps 리렌더가 난다. `ref` 로 CSS custom property 를 직접 write 한다.

⚠️ **정직한 서술** (v1 은 과장했다): `style.setProperty` 도 매 프레임 main-thread style recalc 을 일으킨다. 이 방식이 피하는 건 **React reconciliation** 이지 main-thread 작업 전부가 아니다. `var()` 로 해석된 최종 `transform` 값은 정상 보간되며 layout 을 유발하지 않는다 — 이 서브트리 크기·Electron 환경에서 타당하다. 캐싱은 실측 전엔 넣지 않는다.

#### 🔴 포인터가 사라지는 경로 (v1 누락 — 둘 다 잡음)
`pointermove` 만으로는 "반경 밖" 을 항상 관측할 수 없다:
- 커서가 창 **밖**으로 나가면 이벤트가 끊긴다. FAB 는 우하단이라 마지막 위치가 FAB 중심에서 ~75px → **영구 gazing 고착**.
- 커서가 **네이티브 WebContentsView**(Flow 도킹) 위로 가면 DOM 이벤트가 삼켜진다 — 이 레포의 **기록된 사고 유형**이다.

→ `window` blur / `document` pointerleave 에서 **idle 리셋**.

#### 리스너 수명
FAB 는 패널이 열려도 **언마운트되지 않는다** — [`ChatPanel.css:90`](../../../src/components/agent/ChatPanel.css#L90) 이 `visibility:hidden` 일 뿐이다(`is-hidden` 클래스, [`ChatPanel.jsx:699`](../../../src/components/agent/ChatPanel.jsx#L699)). 숨겨진 FAB 에 매 포인터 이동마다 rAF + gBCR 이 돈다.
→ `active={!open}` 으로 리스너를 걸고, cleanup 에서 **pending rAF 도 취소**한다. `prefers-reduced-motion` 은 **mount-time 계약**으로 한다(런타임 변경 미지원 — 명시).

#### 🔴 "포인터가 사라진다" 는 **구멍의 종류**다 — 인스턴스만 막으면 안 된다
v3 은 지목된 두 경로(window blur / WebContentsView)를 막았다. 리뷰 지적: **`active={!open}` 해제 자체가 세 번째 경로이고, 그건 내가 앞의 둘을 고치면서 만든 것이다.**

> 시선 추적 중(`data-motion-state="gazing"`, `animation:none`, var transform) → FAB 클릭 → 패널 open → `active=false` 로 **리스너 해제** → **stale 상태와 var 가 그대로 남는다** → 패널 dismiss → FAB 이 **시선 도중에 얼어붙은 채, idle 애니메이션 없이** 재등장. 다음 pointermove 가 올 때까지 (키보드 dismiss 면 **무한정**).

→ **계약**: `active` 가 false 로 가는 **순간**(또는 true 로 돌아오는 순간) **강제로 `idle` 로 리셋하고 var 를 지운다.** 테스트는 뮤턴트 12 계열에 넣는다.
**교훈**: 구멍 목록을 늘리지 말고 **"비활성화·언마운트·이탈 = 항상 idle 리셋"** 이라는 **단일 불변식**으로 적어라 — 안 그러면 네 번째가 또 나온다.

---

## 3. 🔴 TDD 1단계 = 기존 테스트를 뒤집는 것

[`tests/components/agent/robotFabAsset.test.js`](../../../tests/components/agent/robotFabAsset.test.js) 가 **옛 설계를 "의도" 로 핀해놨다**: SVG 파일을 `readFileSync` 하고, SVG **내부** 키프레임 존재를 요구하고, CSS 소스 문자열을 정규식으로 긁는다. 셋 다 새 설계에서 **거짓이 되어야 맞다**. 원장의 `agentModelWiring.integration.test.js` 케이스와 같은 패턴 — **TDD 1단계는 새 테스트가 아니라 이 파일을 뒤집는 것이다.**

*(정정: v1 은 이 파일이 `<img>` 사용을 핀한다고 썼는데 부정확하다. `readFileSync(Robot.svg)` 자체는 `<img>` 를 핀하지 않는다 — CSS 정규식 `\.agent-chat-fab img` 가 **간접적으로** 핀한다.)*

| 테스트 | 무엇을 |
|---|---|
| `robotGaze.test.js` | §2.4 진리표 전체 (**비제품 fixture**) + `radius>0` 전제 |
| **`robotConfig.test.js`** | 🔴 §2.0 동결 객체를 **값으로** **전부** assert: `perspective 150 / perspectiveOrigin '50% 50%' / depth 14 / slices 10 / zFace 14.5 / zGlass 12.9 / zEyes 12.5 / zScreen 10 / zLimb 6 / zGround -1 / maxYaw 24 / maxPitch 8 / maxEye 2.6 / radius 320`. 압출 첫·끝 Z = `0 / 14`, 장수 = `10`. **사용자 눈검증의 회귀 방지** |
| `RobotIcon.test.jsx` | 레이어 존재 / **Z 관계**(아래) / 개구부 / 눈이 DOM 에 / `<style>` 없음 / 🔴 **perspective 의 *위치* + *값*** (아래) / 🔴 **씬 루트: 0 아닌 크기 + `preserve-3d` + 평면화 property 없음** / 🔴 **모든 레이어 transform 문자열이 `translateZ(<n>px)`** / 🔴 **그라디언트 6종 정의+사용** / reduced-motion |
| `RobotIcon.gaze.test.jsx` | gBCR 목킹 → pointermove → var 쓰기 / 🔴 **`ROBOT_3D` 에서 유래한 *정확한 문자열*** (반경 끝 → `'24deg'` / `'2.6px'` — 리터럴 뮤턴트를 죽인다) / 🔴 **var 소비 확인 — 머리(`rotateY(var(--robot-yaw))`)와 눈(`translate(var(--eye-x, 0px))`) 양쪽** / `data-motion-state` 전이 / blur·pointerleave·**`active` 해제** → idle / **이미-0 복귀**(§2.5 데드락) / 언마운트 시 리스너+rAF 해제 |

🔴 **바인딩을 핀하지 않으면 상수는 장식이다** (리뷰 R3 Critical): `robotConfig.test.js` 가 동결 객체만 보고, 호출부가 `ROBOT_3D.maxYaw` 대신 **리터럴 `14`** 를 넘기면 — **뮤턴트 전부 KILLED 유지, 전 테스트 초록, 제품은 FAIL 판정값으로 렌더.** 그래서 gaze 테스트가 **ROBOT_3D 로 계산된 결과 문자열**을 assert 해야 한다.

**삭제**: `robotFabAsset.test.js`.

#### Z "단조성" 이 아니라 **명명된 관계** (v1 자기모순)
v1 은 "Z 사다리 단조성" 을 테스트하라고 썼는데, §2.1 의 사다리는 DOM 순서로 `4 → 0..8 → 9 → 7 → 8 → 4` 라 **비단조**다 — 그 assert 는 설계 자체에 대해 빨갛다. 진짜 불변식으로 핀한다:
- 압출 슬라이스: Z **강증가** + 색 **단조 어두움** + **양 끝점 = `0` / `depth`** (§2.1 공식)
- `z-screen < z-eyes < z-glass < z-face`
- 전구 Z **==** 스템 Z
- 코플레인 없음 — **전체 집합**(그림자·팔·슬라이스 10장·스크린·눈·유리·앞면)에 대해

#### 🔴 `perspective` 는 **존재가 아니라 위치**를 핀한다
perspective 는 **회전하는 요소의 *조상***에 있어야 한다. `.robot-icon` **자신**에 걸면 그 자식들만 원근을 받고 **컨테이너 자신의 `rotateY` 는 정사영으로 남는다** — C3 의 유령. 그런데 "`perspective` 가 CSS 에 있나" 식의 존재 검사는 **양쪽 다 통과한다.**

**진짜 불변식** (클래스 이름이 아니라 **topology**): *perspective 는 회전하는 `.robot-icon` **자신이 아니라** 그 조상에 적용된다.*
→ 테스트를 `.agent-chat-fab` 문자열에 과적합시키지 마라. 중간 wrapper 를 쓰는 정상 구현까지 빨갛게 만든다 (보존된 스파이크가 실제로 그렇다 — `.fab` 이 아니라 `.perspective-box` 에 둔다, :207).
**제품에선 `.agent-chat-fab` 에 둔다** — 이건 CSS 법칙이 아니라 **구조상 선택**이다(이미 거기 있고 wrapper 를 더할 이유가 없다).

삭제 예정인 [`robotFabAsset.test.js:30`](../../../tests/components/agent/robotFabAsset.test.js#L30) 이 정확히 `.agent-chat-fab { perspective: }` 를 핀하고 있었다 — **대체 테스트는 그 정밀도를 유지해야 한다.** `perspective-origin` 도 함께 핀한다: **승인된 스파이크는 `50% 50%`, 현재 프로덕션은 `50% 45%`** → **`50% 50%` 로 간다**(승인된 값).

### 뮤테이션 대상 (급소)
**순수 함수** (진리표가 죽인다):
1. `dist<=radius` → `abs(dx)<=r && abs(dy)<=r` (원형→사각형) — 대각선 행
2. `yaw` 부호 반전 — 좌/우 행
3. `eyeX` 가 `maxEye` 대신 `maxYaw` 스케일 — 값 행
4. yaw/pitch 축 뒤바뀜 — 위 행
5. `engaged` 항상 true — 경계 행

**🔴 소비자 뮤턴트** ("var 가 써졌나" 만 검사하면 아래가 전부 살아남는다):
6. `.eyes` 의 `transform: translate(var(--eye-x), ...)` **삭제**
7. 🔴 `.robot-icon` 의 `rotateY(var(--robot-yaw)) rotateX(var(--robot-pitch))` **삭제** — 머리 소비자. R2 지적: v2 는 눈 소비자만 뮤턴트로 뒀다
8. gazing 의 `animation: none` **제거** (= C1 버그 재도입)
9. hover 우선순위 **제거**
10. `perspective` **제거**
11. reduced-motion 가드 제거
12. blur/pointerleave idle 리셋 제거

**🔴 캘리브레이션 뮤턴트** (R2 Critical — 사용자 눈검증의 회귀 방지. 없으면 FAIL 판정난 설정이 전 게이트를 통과한다):
13. `depth` 14 → **8** (사용자가 "확실히는 아니고, 약간" 으로 FAIL 판정한 값)
14. `slices` 10 → **6**
15. `perspective` 150 → **220**
16. `maxYaw` 24 → **14**
17. `zFace` 14.5 → **14** (= 최전방 슬라이스와 코플레인 재도입)
18. 압출 공식 `i/(N-1)` → **`i/N`** (= 최전방 슬라이스가 12.6 으로 내려앉아 앞면 아래 공기층)

**🔴 무동작 seam** (§2.6 단위 계약 / §2.1 씬 루트 — 전부 "전 게이트 초록 + 실앱 사망"):
19. **동적** var 단위 제거 (`` `${yaw}deg` `` → `yaw`) = gaze transform 이 `none`
20. 🔴 **정적** Z 단위 제거 (`` `${zFace}px` `` → `zFace`) = **모든 레이어 transform 이 `none` → Z 전체 평면화**
21. 🔴 **perspective** 단위 제거 (`150px` → `150`)
22. 🔴 씬 루트에서 **`width`/`height` 제거** = 0×0 = 로봇 안 보임
23. 🔴 씬 루트에 **`overflow: hidden` 추가** = `preserve-3d` → `flat` = 3D 사망
24. `perspective` 를 조상이 아니라 **`.robot-icon` 자신**에 이동 = 컨테이너 rotateY 가 정사영
25. `active` false 전이 시 **idle 리셋 제거** = 패널 닫으면 FAB 이 시선 도중에 얼어붙은 채 재등장
26. 🔴 `robot-turn` **0% 를 non-identity 로** (예: `rotateY(-24deg)`) = §2.5 CSS-only 복귀가 스냅

**🔴 바인딩 뮤턴트** (여섯 번째 입구 — 상수가 렌더에 안 닿는 것. 전부 "config 테스트 초록 + 제품은 FAIL 값"):
27. 🔴 gaze 호출부가 `ROBOT_3D.maxYaw` 대신 **리터럴 `14`** 를 넘김
28. 🔴 `perspective` 를 `ROBOT_3D` 가 아니라 **CSS 리터럴**로 (= `ChatPanel.css:94` 의 220px 가 cascade 로 이김)
29. 🔴 `ChatPanel.css:91-110` 을 **철거하지 않음** (= 위와 같은 결과)
30. 🔴 그라디언트 `fill="url(#shell)"` → **평면 단색** (= §1.1 이 그라디언트에 귀속시킨 정지 볼륨이 사라짐)
31. `<defs>` 홀더를 `display:none` 으로 (= paint server 참조가 깨질 수 있는 패턴)

🔴 **뮤테이션 전에 반드시 커밋한다.** 미커밋 상태에서 복원하면 작업이 통째로 날아간다(이전 세션에 두 번 당할 뻔, Task 5 는 실제로 날아감).
🔴 **하네스부터 검증한다** — baseline `exit 0` 을 **눈으로 확인**하고서 KILLED 판정을 믿는다. 판정 로직이 조용히 실패하면 KILLED 가 전부 가짜다.

⚠️ **cascade 는 jsdom 이 증명 못 한다.** 뮤턴트 7·8·9 는 jsdom 에서 "선언이 있는가" 수준까지만 핀된다. **실제 시각 결과는 §5 눈검증이 유일한 게이트다.**

---

## 4. 범위 밖 / dead code

**안 한다**: 로봇 **디자인 변경**(같은 로봇을 입체로 세우는 것이지 새로 그리는 게 아니다) / 핸드오프 §4 의 Minor 들(QA 배너 z-index, 도크 z 역전, 접근성 후속).

#### 🔴 **승인된 시각 변화** — "실루엣/색/비율 유지" 는 작은 데서 세 번 거짓이다 (R2 M-3)
아래 셋은 **사용자가 승인한 스파이크 D 에 이미 존재한다.** 그러므로 **허용**이다 — 그러나 **기록해둔다. 어느 방향으로도 "고치지" 마라.**
1. **유리(12.9)가 눈(12.5) 앞으로 갔다** — 원본 [`Robot.svg:74`](../../../src/assets/Robot.svg#L74) 은 유리를 눈(:75-78) **전에** 그려서 **눈이 위에** 있다. 페인트 순서가 뒤집혔다.
2. **미소 하단이 잘린다** — path 최대 y 42.7 + stroke 1.25 = 43.95 > 개구부 하단 y 43 → 전방 슬라이스 재질에 **~0.95 SVG 단위(48px 기준 ~0.7px)** 클립.
3. **접지 그림자의 AO 효과 상실** — 셸 바닥을 어둡게 하던 기능이 사라진다(§2.1).

**dead code 정리** (Karpathy 3 — 내 변경이 만든 것만):
1. `src/assets/Robot.svg` + [`ChatPanel.jsx:12`](../../../src/components/agent/ChatPanel.jsx#L12) `import robotUrl` → **삭제**.
2. 🔴 [`ChatPanel.css:91-110`](../../../src/components/agent/ChatPanel.css#L91) → **철거한다** (v5 까지 이 블록은 **주인이 없었다** — 아무도 지우라고 안 했다).
   - `:94` `perspective: 220px; perspective-origin: 50% 45%` → **삭제** (이제 ROBOT_3D 가 inline 으로 write. **남겨두면 cascade 로 이겨서 사용자 FAIL 값이 라이브가 된다** — §2.1)
   - `:95-99`, `:107`(깨진 hover), `:108-110`(reduced-motion) → `<img>` 대상 규칙이므로 **삭제/이관**
   - `:100-105` `@keyframes robot-turn` → **남긴다** (안무 정본, §2.0 화이트리스트). 단 `.robot-icon` 을 대상으로 갱신.
   ⚠️ **v5 의 §7 앵커 주석 ":94 — 교체 시 증발 주의" 는 "저 줄을 지켜라" 로 읽혀 함정을 강화했다.** 경고하려던 문장이 함정을 만들었다 — 지금은 철거 명령이다.

🔴 **그라디언트 정본** (리뷰 지적 — v5 의 "기하학 정본은 §7 로 옮겨간다" 는 **그라디언트에 대해 거짓**이었다): §7 은 **기하만** 기록하고 stop 색·`userSpaceOnUse` 좌표가 **없다.** `Robot.svg` 를 지우면 음영의 레포 내 정본은 **스파이크 HTML 뿐**이다.
→ 그라디언트 6종은 **스파이크에서 `RobotIcon.jsx` 로 포팅**(§2.-1)하고, **§3 이 정의+사용을 핀한다**(삭제되는 `robotFabAsset.test.js:21-26` 의 정밀도 승계).
→ `<defs>` 배치는 스파이크 패턴을 따른다: `position:absolute; width:0; height:0; overflow:hidden` 홀더 (:29-35). 🔴 **`display:none` 을 쓰지 마라** — display:none SVG 안의 paint server 참조는 브라우저 이력상 깨진 전례가 있는 패턴이다.

## 5. 완료 기준

1. 전체 스위트 GREEN (현재 **664 files / 7322 tests** — 리뷰가 직접 실행해 확인) + `npm run build` exit 0
2. 뮤테이션 §3 **서른한 종** 전부 KILLED (하네스 baseline exit 0 확인 후)
3. Codex + Fable 적대 리뷰 **findings 0** (직전 findings 첨부, 0 까지 loop)
4. 🔴 **사용자 눈검증 — 유일한 진짜 게이트.** jsdom 은 cascade 도 "입체로 보이는지" 도 증명 못 한다:
   - **평면 기준선보다 확실히 나은가** (§2.0 — 아니면 설계 폐기)
   - 🔴 **실앱 맥락에서 판때기(slab)로 보이지 않는가** — D 는 slab 위험이 가장 큰 후보다. 스파이크는 **정지 배경의 격리된 로봇**이었다. 도킹/Flow/스크롤 위에서 재확인
   - 회전 시 **부위별 시차**가 보이는가
   - **얼굴이 보이는가** (개구부가 실제로 뚫렸는가 — v1 의 Critical 2)
   - 🔴 **접지 그림자가 보이는가** (§2.1 — 승인된 스파이크에선 안 보였다. 없는 게 나으면 지운다)
   - 마우스를 근처로 가져가면 **머리가 돌고 눈이 쫓는가** (C1 이 실제로 고쳐졌는가)
   - 눈/전구가 얼굴에서 **떨어져 떠 보이지 않는가**
   - 압출이 **줄무늬로 보이지 않는가** (10장 @depth14 → 층당 1.56px)
   - hover 시 **정면으로 고정**되는가 (§1.3 버그가 고쳐졌는가)
   - gazing→idle 복귀가 **스냅하지 않는가** (§2.5) — 특히 **포인터가 FAB 중심에 있다가 창 밖으로** 나가는 경로
   - `maxPitch 8` / `maxEye 2.6` / `radius 320` 이 맞는가 (**미검증 잔여 3종** — 스파이크가 안 물어봤다)

## 6. 역할
- **저작**: Codex `gpt-5.6-sol` (`mcp__codex__codex`, `sandbox: workspace-write`, `model_reasoning_effort: xhigh`)
- **적대 리뷰**: Codex + Fable 5 **독립 병렬** (v1 에서 각자 상대가 못 본 Critical 을 하나씩 잡았다 — 이 조합을 유지한다)
- **검증**: Opus 직접 — 전체 스위트 실행 + raw diff 대조 + 뮤테이션
- **최종 판정**: 사용자 눈

🔴 test 명령엔 반드시 `cd /Users/tuxxon/workspace/AutoFlowCut &&` — 세션 cwd 가 프로젝트가 아니다.

## 7. 앵커 (HEAD `a65df62` — 리뷰어 둘이 **각각 독립적으로** 전수 대조해 일치 확인)

| 파일 | 무엇 |
|---|---|
| `src/components/agent/ChatPanel.jsx:12,706` | `import robotUrl` + `<img src={robotUrl}>` — 교체 지점 |
| `src/components/agent/ChatPanel.jsx:694` | FAB 는 패널이 열려도 언마운트 안 됨 |
| `src/components/agent/ChatPanel.css:80` | FAB 72px + padding 12px → 아이콘 ~48px (§2.0 수학의 근거) |
| `src/components/agent/ChatPanel.css:90` | 숨김은 `visibility:hidden` 뿐 |
| `src/components/agent/ChatPanel.css:94` | `perspective: 220px` — 🔴 **교체 시 증발 주의**(§8 C3) |
| `src/components/agent/ChatPanel.css:95-105` | `robot-turn` |
| `src/components/agent/ChatPanel.css:107` | 🔴 **깨진 hover** (§1.3) |
| `src/assets/Robot.svg` | 64×64 viewBox. 셸 `rect 13,17 38×34 rx12` / 접지그림자 `ellipse 32,49.5 r15×2.2` / 스크린 `rect 17,21 30×22 rx8` / 유리 `rect 17,21 30×13 rx8` / 눈 `circle r4 @(26,32),(38,32)` / 미소 `path M25 40c2.2 1.8 4.5 2.7 7 2.7s4.8-.9 7-2.7` / 팔 `M13 29H8v12h5M51 29h5v12h-5` / 스템 `M32 17V10` / 전구 `circle r4 @(32,8)` |
| `src/assets/Robot.svg:39-67` | 전역 누출 위험 `<style>` (§2.3) |
| `src/assets/Robot.svg:55-59` | `robot-look` (캔드 시선 — gazing 과 충돌, §2.5) |
| `tests/components/agent/robotFabAsset.test.js` | 뒤집을 대상 (§3) |

---

## 8. 이 스펙의 리뷰 이력

v1 은 교차 리뷰에서 **Critical 3 으로 사망**(구현 착수 불가), v2 는 Critical 1, v3 은 Critical 1. 라운드마다 **각 리뷰어가 상대가 못 본 Critical 을 하나씩** 잡았다 — 이 조합(Codex gpt-5.6-sol + Fable 5, 독립 병렬)을 유지할 것.

**전체 findings 원장과 각 라운드에서 뭐가 틀렸는지는 `.superpowers/sdd/progress.md`** ("Robot FAB 3D + 시선추적 — 스펙 리뷰 원장"). 여기 두면 40줄을 구현자가 스크롤로 넘겨야 하고, 스펙과 함께 썩는다.

🔴 **이 설계에서 세 번 반복된 실패 유형 하나만 기억하면 된다**: *전 게이트 초록 + 실앱 완전 무동작*. 입구가 세 개였다 — 애니메이션이 static transform 을 이김(C1) / `perspective` 증발(C3) / CSS var 단위 누락(C-1). **jsdom 은 cascade 를 합성하지 않으므로 이 병을 하나도 못 잡는다. §5 눈검증이 유일한 그물이다.**
