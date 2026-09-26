# 플랜 — Veo 영상 오디오 볼륨 옵션 (2026-07-12)

**브랜치**: `feature/veo-audio-volume`
**제약**: **GCF 수정 절대 금지** (whisk2capcut / whisk2premiere 둘 다 손대지 않는다)

---

## 1. 문제

Veo가 만든 영상 클립에는 **끌 수 없는 오디오**가 들어 있다 (Gemini API가 `generate_audio=false`를 거부. Vertex AI만 지원하는데 그러면 BYOK 모델을 버려야 함). 그 결과 CapCut 타임라인에서 **Veo가 지어낸 대사·효과음이 TTS 나레이션 위에 풀 볼륨으로 깔린다.** 사용자는 매번 CapCut에서 손으로 음소거해 왔다.

## 2. 왜 기존 핸드오프 안(앱에서 `volume` 전송 + GCF 수용)이 틀렸나

핸드오프는 앱이 `cloudVideoOverlays`에 `volume: 0`을 실어 보내고 **GCF가 `segment.volume = overlay.volume ?? 0`으로 받게** 하자고 했다. 그런데:

- GCF의 영상 오버레이 세그먼트 빌더(`whisk2capcut/functions/index.suffixed.js:1193-1208`)는 **`segment.volume`을 아예 쓰지 않는다.** 템플릿(`capcut_video_segment_template.json`)의 `"volume": 1.0`을 그대로 물려받는다.
- 즉 **앱에서 `volume`을 보내도 GCF가 무시**한다 → GCF 수정 없이는 작동하지 않는 안이다.
- 그런데 GCF 수정은 금지다.

## 3. 실제 해법 — 앱이 이미 draft JSON을 손에 쥐고 있다

CapCut 드래프트 JSON은 GCF가 만들지만 **디스크에 쓰는 건 앱이다.**

- `src/exporters/capcutCloud.js:85` — `draftInfo`(전체 draft JSON)를 받아서
- `src/exporters/capcutCloud.js:143-159` — 이미 문자열 치환으로 **손보고 있고**
- `src/exporters/capcutCloud.js:166` — `writeCapcutProject`로 앱이 직접 쓴다.

→ **받은 draft JSON에서 Veo 영상 세그먼트의 `volume`만 앱에서 패치한다.** GCF 0줄.

`segment.volume`이 CapCut이 받아들이는 손잡이라는 근거: GCF 자신이 SFX에 쓰고 있다 — `index.suffixed.js:1580 — segment.volume = 0.5`, `:1323 — if (volume != null) segment.volume = volume`.

## 4. 옵션 설계 (하드코딩 0 아님)

Export 모달 설정(`useExportSettings`, localStorage `exportSettings`)에 추가:

| 값 | 의미 |
|---|---|
| `0` | **음소거 (기본값)** — 지금까지 손으로 하던 것 |
| `0.15` | 앰비언스로 살림 (대사 없는 클립용) |
| `1` | 원본 유지 (기존 동작) |

- 키: `videoAudioVolume`, 기본 `0`.
- `null`/`undefined`면 **패치하지 않는다** (구버전 설정 = GCF 기본 동작 유지).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/exporters/videoAudioVolume.js` (신규) | 순수 함수 `applyVideoAudioVolume(draftInfo, { videoFilenames, volume })` — 영상 오버레이 material을 참조하는 세그먼트에만 `volume` 주입 |
| `src/exporters/capcutCloud.js` | GCF 응답 수신 직후 패치 적용 (문자열 치환 **전**) |
| `src/hooks/useExportSettings.js` | `videoAudioVolume: 0` 기본값 |
| `src/components/ExportModal.jsx` | 선택 UI + `buildExportOptions()`/`persistOptions()` 배선 |
| `src/locales/{ko,en}.js` | 레이블 |
| `tests/exporters/videoAudioVolume.test.js` (신규) | 단위 |
| `tests/exporters/capcutCloud.videoAudioVolume.test.js` (신규) | 통합 (GCF 응답 → 패치 → write 페이로드) |

## 6. 핵심 위험 — 이미지도 `materials.videos`에 들어간다

CapCut draft 포맷에서 **정지 이미지도 `materials.videos` 배열**에 들어간다 (`type: 'photo'`). 그래서 "videos 배열 전체를 음소거"하면 안 된다 — 무해하긴 하지만 의도가 아니고, 나중에 이미지에 오디오가 붙는 순간 오작동한다.

**식별 규칙**: `prepareCloudRequest`가 만든 `videoOverlays[].filename` **집합**에 속하는 material만 대상으로 한다. material 매칭은 `material_name`(GCF `index.suffixed.js:1173 — material.material_name = filename`)으로, 세그먼트 매칭은 `segment.material_id`로 한다.

## 7. TDD 슬라이스

- **V1** `[U]` 영상 오버레이 material을 참조하는 세그먼트에만 `volume`이 붙는다. 이미지(`type:'photo'`) material 참조 세그먼트는 **불변**.
- **V2** `[U]` `volume: 0`이면 `segment.volume === 0`. `0.15`면 `0.15`. **`volume: null`/미지정이면 draft가 바이트 단위로 불변** (GCF 기본 유지).
- **V3** `[U]` `videoOverlays`가 없는(이미지만) 프로젝트는 draft 불변 + 예외 없음.
- **V4** `[U]` draft가 **문자열**로 와도(응답이 JSON string일 수 있음 — `capcutCloud.js:85`가 그 경우를 다룬다) 동작하고, 파싱 실패 시 **원본을 그대로 반환**(export를 깨뜨리지 않는다).
- **V5** `[H]` `exportCapcutPackageCloud`가 `videoAudioVolume` 옵션을 받아 GCF 응답을 패치한 뒤 `writeCapcutProject`에 넘긴다 — 전달된 `draftInfo` 문자열의 해당 세그먼트에 `"volume":0`이 있다.
- **V6** `[U]` 기존 SRT 경로 치환이 패치 뒤에도 그대로 동작한다 (회귀).

## 8. 범위 밖 (별건)

- **Premiere 경로**: 앱이 `premiereXml` 문자열을 받아서 이미 치환 후 쓴다(`src/exporters/premiereCloud.js:118,131`) → 같은 방식으로 앱-온리 패치가 **가능해 보인다.** 다만 `whisk2premiere/functions/index.suffixed.js`의 `videoOverlays` 처리부에 audio/gain/volume 코드가 **안 보인다** — Premiere XML에 영상 오디오가 실제로 실리는지 **실측 전에는 단정하지 않는다.** 실제 export 한 번 열어보고 별도 슬라이스로 처리한다.
- Veo 오디오 앰비언스 자동 활용(대사 없는 클립만 살리기)은 오디오 분석 툴이 필요 — M4 이후.
