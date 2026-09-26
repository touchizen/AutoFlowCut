# 영상 등장인물 교체 (Wan 2.2 Animate) — 설계 검토

- 날짜: 2026-08-07
- 상태: **검토(design review) 단계.** 구현 미착수. 승인·플랜 전 단계.
- 선행 의존: `feature/multi-provider-genapi` 완료 (fal 게이트웨이 실키 검증 포함). **이 문서는 그것을 전제로 한다.**

---

## 0. 무엇을 만들려는가

Ref 탭의 캐릭터 레퍼런스 이미지를 써서, **외부에서 가져온 영상의 등장인물을 교체**한 영상을 만들고,
그 결과를 **프로젝트 씬으로 들여와** 기존 export(CapCut / 프리미어 / 자체 렌더) 경로를 그대로 태운다.

사용자 확정 사항(2026-08-07 브레인스토밍):

| 질문 | 결정 |
|---|---|
| 원본(driving) 영상 출처 | **외부 파일 (디스크/URL)** |
| 결과 행선 | **프로젝트 씬으로 들어옴** |
| 영상 길이 | **짧은 클립(~10초) 먼저**, 긴 영상 자동분할은 다음 마일스톤 |
| 프로바이더 | multi-provider 선행 완료를 전제 |

---

## 1. 결론

**Ref 탭에 붙일 기능이 아니다.** 앱에 없던 **네 번째 생성 모달리티(video→video)** 가 생기는 것이고,
Ref 탭은 캐릭터 *공급원*으로만 참여한다.

Ref 탭에 넣으면 안 되는 이유: Ref 탭([src/components/ReferencePanel.jsx](../../../src/components/ReferencePanel.jsx))은
"캐릭터 정의"의 자리다. 카드 하나 = 캐릭터 하나. 여기에 영상 입력을 넣으면 Ref 카드가 배치 job 으로 변질되고,
기존 배치(`refBatchActive` / `generatingRefs` / 스타일 카드 / Flow 동기화)와 수명주기가 얽힌다.

**추천: 새 생성 탭 + `submitVideo` 계약에 `sourceVideo` 추가 + stage `'v2v'` 확장.**

**진짜 비용은 모델이 아니라 "앱에 처음 들어오는 비디오 파일"이다.**

---

## 2. 실측 — 모델 계약 (fal 공식 문서, 2026-08-07 확인)

엔드포인트: `fal-ai/wan/v2.2-14b/animate/replace`
(자매 엔드포인트: `fal-ai/wan/v2.2-14b/animate/move`)

- **replace** — 영상 속 인물만 교체하고 **장면의 조명·색조를 보존**한다. ← 이번 목표
- **move** — 캐릭터 이미지가 영상의 동작을 따라 움직인다. 같은 배선에 라디오 하나로 얹힌다.

### 입력

| 필드 | 필수 | 값 |
|---|---|---|
| `video_url` | ✅ | 원본(driving) 영상 |
| `image_url` | ✅ | 교체해 넣을 캐릭터 이미지 |
| `resolution` | | `480p` / `580p` / **`720p` 가 천장** (기본 `480p`) |
| `seed` | | 재현용 |
| `guidance_scale` | | 기본 1 |
| `num_inference_steps` | | 기본 20 |
| `shift` | | 1.0–10.0 (기본 5) |
| `video_quality` | | low / medium / high(기본) / maximum |
| `video_write_mode` | | fast / balanced(기본) / small |
| `use_turbo`, `return_frames_zip`, `enable_safety_checker` | | |

### 출력

`video`(File), `prompt`(**자동생성된** 프롬프트), `seed`, `frames_zip`(옵션)

### 문서에 **없는** 것 — 설계에 직접 영향

- **`prompt` 입력이 없다.** 프롬프트는 오히려 *출력*이다.
- **`aspect_ratio` 입력이 없다.** 화면비는 원본 영상이 정한다.
- **`duration` 입력이 없다.** 길이도 원본 영상이 정한다.
- 최대 길이 상한이 문서에 명시돼 있지 않다 → **M0 스파이크에서 실측 필요.**

### 파일 전달

바이너리 auto-upload(SDK), hosted URL, base64 data URI 모두 허용.

---

## 3. 실측 — 현재 코드베이스와의 충돌 지점

> 앵커는 `feature/multi-provider-genapi` 브랜치 기준(미머지). 아래 4건은 전부 파일을 직접 열어 확인했다.

### 3.1 dispatcher 가 비디오 입력을 모른다 — **최우선 블로커**

[`electron/api/providers/dispatcher.js`](../../../electron/api/providers/dispatcher.js) 의 `generateVideo` 는
파라미터를 **명시 구조분해로 골라서** provider 에 넘긴다:

```js
const {
  prompt, image, endImage, referenceImages,
  aspectRatio, durationSeconds, model, seed, resolution,
} = params
const res = await provider.submitVideo({ prompt, image, endImage, ... }, engineDeps)
```

`video` 계열 입력이 아예 없다. **`sourceVideo` 를 뚫지 않으면 렌더러가 무엇을 넘기든 여기서 조용히 증발한다.**

> ⚠️ 이 자리는 과거에 `aspectRatio` · `seed` 거부 가드로 기능이 IPC 전에 죽었는데
> 전체 스위트는 초록이던 바로 그 패턴이다. **가드/화이트리스트는 실제 기본값과 전수 대조표로 검증할 것.**

### 3.2 기존 fal 비디오 어댑터를 그대로 못 쓴다

[`electron/api/providers/video/fal.js`](../../../electron/api/providers/video/fal.js) 는 현재:

- `image`(start image)를 **필수로 요구** — 없으면 `'fal video model requires a start image'`
- `endImage` 나 `referenceImages` 가 오면 `invalid-config` 로 **거절**
- `input` 을 `{ prompt, image_url, duration }` 으로 고정 조립

animate 는 start image 개념이 없고 prompt·duration 도 없다. → **모델별 input 조립 분기**가 필요하다.
(어댑터를 나눌지, 한 어댑터 안에서 모델 id 로 분기할지는 §5 에서 다룬다.)

### 3.3 stage 슬롯은 이미 있다 — 확장 지점으로 적합

[`src/utils/sceneProviderResolution.js`](../../../src/utils/sceneProviderResolution.js):

```js
export function getGlobalVideoProvider(settings = {}, stage = 't2v') {
  return settings?.generation?.video?.[stage]?.provider ?? 'google'
}
```

`t2v` / `i2v` 가 이미 stage 로 갈려 있다. **`v2v` 한 칸을 추가**하면 provider 선택·heal·씬 오버라이드가
기존 규칙을 그대로 탄다. 새 축을 만들 필요가 없다.

### 3.4 문제 없음이 확인된 것 (헛걱정 제거)

- `isValidFalEndpointId` ([`falClient.js:15`](../../../electron/api/providers/falClient.js))
  의 정규식 `/^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+$/i` 는 세그먼트 수 제한이 없고 `.` 을 허용한다.
  → 5-세그먼트 `fal-ai/wan/v2.2-14b/animate/replace` **통과한다.**
- 폴링(`checkVideoStatus`) · 핸들 인코딩(`encodeHandle`) · 취소(`cancelRegistry`) · 다운로드는
  **submit 이후 경로가 provider 공통**이라 100% 재사용된다. 새로 만들 것은 submit 뿐이다.
- `downloadPolicy` ([`falClient.js:109`](../../../electron/api/providers/falClient.js)) 는
  `https://fal.media` 만 allowlist. animate 결과 CDN origin 이 다르면 **다운로드가 거부된다** →
  M0 스파이크에서 실제 origin 확정 필요(PROVISIONAL 주석이 이미 그렇게 말하고 있다).

---

## 4. UI 배치 — 3안 비교

현재 생성 탭 구성 ([`src/App.jsx:775`](../../../src/App.jsx)):

```
'text' (T2I) | 'video-text' (T2V) | 'frame-to-video' (I2V) | 'list' | 'audio'
```

### 안 A — 새 탭 `video-animate` + stage `'v2v'` ← **추천**

- UI 는 [`FrameToVideoPanel.jsx`](../../../src/components/FrameToVideoPanel.jsx) 복제.
  그 패널이 이미 정확히 같은 모양이다: **행 = [Start 선택 | End 선택 | 프롬프트] → 배치 생성 → 씬**.
  animate 는 **행 = [원본 클립 | Ref 캐릭터 | 모드(replace/move)]**.
- 그 안의 `SceneSelect` 가 이미 **썸네일 드롭다운 + 디스크 업로드 + 갤러리 브라우징**을 한다
  → 캐릭터 고르는 UI 는 사실상 공짜.
- Ref 탭은 손대지 않는다. 캐릭터 공급원으로만 참조된다.

**대가:** 탭이 하나 늘고, 패널 복제분의 중복이 생긴다(공통화는 M3 리뷰에서 판단).

### 안 B — `frame-to-video` 탭 안에 "소스: 이미지 / 영상" 토글

탭을 안 늘려서 싸 보인다. 그러나 소스를 영상으로 바꾸는 순간
**프롬프트 · 길이 · 화면비 · Start/End 컨트롤이 전부 무의미**해져 절반이 비활성화된다.
**화면이 거짓말을 하게 된다.** 비추.

### 안 C — 독립 모달 도구 (파일 넣고 → 받고 → 끝)

구현은 제일 가볍지만 "결과가 프로젝트 씬으로 들어옴" 결정과 충돌. **탈락.**

---

## 5. 새로 만들어야 하는 것 (리스크 순)

### 5.1 비디오 임포트 경로 — 앱에 입구 자체가 없다 ★최대 리스크

모든 어댑터가 이미지를 `dataUrl(image)` = **base64 로 IPC 에 태운다**.
영상은 20~200MB 라 base64(≈+33%)로 렌더러↔main 을 건너면 피크 메모리가 몇 배로 튄다.

**설계 방향:** main 프로세스가 **파일 경로**로 받아 fal storage 에 업로드하고,
렌더러/프로젝트에는 **URL(또는 핸들)만** 흘린다. 렌더러가 영상 바이트를 만지지 않는다.

**막힌 곳:** [`falClient.js`](../../../electron/api/providers/falClient.js) 에 **업로드 함수가 없다.**
`fetchFalAsset` 은 결과 다운로드 전용이다. → 신규 필요.

### 5.2 해상도 · 화면비의 권위가 역전된다

지금 파이프라인은 **프로젝트 `aspectRatio` 가 권위**다. 그런데 animate 결과의 화면비는 **원본 영상**이 정하고,
fal 은 **720p 가 천장**이다.

- 세로 숏츠 프로젝트에 가로 원본 → export 에서 레터박스
- 1080p/4k 씬과 섞이면 품질이 튄다

→ **임포트 시점에 화면비·해상도를 프로브해서 검사 + 경고.**
프로브는 기존 `src/utils/videoMetadata.js` 재사용 후보(**미확인 — 실제 시그니처 확인 필요**).

### 5.3 원본 오디오의 운명이 미확인

결과 영상에 원본 클립의 오디오가 남는지/드롭되는지 문서에 없다.
남으면 export 타임라인의 오디오 정책(씬 간격·무음 처리)과 충돌할 수 있다.
→ **M0 스파이크 실측 항목.**

---

## 6. 씬 모델의 어색한 점

**animate 씬은 프롬프트가 없다.** 그런데 씬/CSV 에서 프롬프트는 1급 필드다.

**제안:** 프롬프트 칸에 `클립파일명 @캐릭터` 형태의 **읽기 전용 라벨**을 넣고, 제출에는 쓰지 않는다.
fal 이 자동생성 프롬프트를 *출력*으로 돌려주므로, 완료 후 그 값을 표시용으로 채워 넣는 것도 가능하다.

씬의 비디오 경로 필드는 기존 매핑을 따른다
([`src/hooks/useVideoScenes.js:44`](../../../src/hooks/useVideoScenes.js) — `videoPath ↔ videoT2VPath`).
animate 결과를 어느 슬롯에 넣을지(기존 슬롯 재사용 vs 신규)는 M1 에서 결정.

---

## 7. 마일스톤

| | 내용 | 게이트 |
|---|---|---|
| **M0** | **실키 스파이크(코드 아님).** fal 키로 animate/replace 1발 — ① 업로드 방식 ② 최대 길이 상한 ③ 결과 오디오 유무 ④ 과금 ⑤ 결과 CDN origin ⑥ 큐 status 문자열 | 6개 항목 실측 기록. **`downloadPolicy` origin 확정** |
| **M1** | 계약 확장: `sourceVideo` 파라미터 + stage `'v2v'` + `VIDEO_MODELS` provisional 엔트리 + fal animate submit 분기 | fixture 테스트, 뮤테이션 |
| **M2** | 비디오 임포트: 파일 선택 → 메타 프로브 → main 업로드 → 핸들. 렌더러는 바이트를 안 만짐 | 대용량 파일 메모리 실측 |
| **M3** | 새 탭 UI(FrameToVideoPanel 복제) + 배치 + 결과 씬 물질화 | **실앱 눈검증** |
| **M4** | (범위 밖 · 나중) 긴 영상 자동 분할·재조립 | |

---

## 8. 미확인 / 단정하지 않은 것

CLAUDE.md 규칙("확인 안 한 것은 단정하지 말고 스파이크로 미룰 것")에 따라 명시한다.

1. animate 엔드포인트의 **최대 입력 영상 길이** — 문서에 없음
2. 결과 영상의 **오디오 트랙 유무**
3. 결과 **CDN origin** 이 `https://fal.media` 인지
4. **과금 단위/단가**
5. `src/utils/videoMetadata.js` 의 실제 시그니처가 임포트 프로브에 쓸 만한지
6. WaveSpeed 에도 같은 모델이 있는지 / 입력 계약이 같은지 (fal 기준으로만 검토함)
7. fal SDK 의 storage 업로드 API 정확한 형태

---

## 9. 범위 밖 (이번에 안 한다)

- 긴 영상(분 단위) 자동 분할·재조립 — M4
- 다중 인물 동시 교체
- 얼굴만 교체(face swap) 계열
- 원본 영상을 앱이 편집(트리밍/크롭)하는 기능 — 임포트 시 **검사·경고까지만**
- Ref 탭 UI 변경 — **건드리지 않는다**

---

## 참고

- <https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace/api>
- <https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/move/api>
