# 오디오 스키마 (Audio & SFX)

인물별 대사 음성(TTS)과 음향효과(SFX) 파일의 구조.

## 디렉토리 구조

```
voice_samples/
├── generate_tts.py          ← TTS 생성 스크립트
├── generate_sfx.py          ← SFX 생성 스크립트
├── typecast_voice_catalog.md ← 음성 카탈로그
├── sfx/                     ← 음향효과
│   ├── 01_주판/
│   │   ├── abacus_beads_01.mp3
│   │   ├── click_01.mp3
│   │   └── ...
│   ├── 02_환경음_바람/
│   ├── 02_환경음_빗소리/
│   ├── 02_환경음_새소리/
│   ├── 03_침묵_호흡/
│   ├── 04_발소리/
│   ├── 05_금속_타격_문/
│   ├── 06_붓소리/
│   └── 07_군중/
├── {인물명}/                ← 인물별 대사 TTS
│   ├── {인물}_{번호}_{타임코드}.mp3
│   └── ...
└── .audio_review.json       ← 오디오 리뷰 상태
```

## TTS (대사 음성)

### 생성 API: Typecast

```
API: https://api.typecast.ai/v1/text-to-speech
인증: ~/.typecast/credentials
```

### 대사 데이터 구조 (generate_tts.py)

```python
# (캐릭터명, 번호, 타임코드, 대사, 감정)
("소은", 1, "01:59", "서른한 푼이요.", "normal")
("곽 주사", 5, "10:30", "이 집안이 흔들리고 있소.", "angry")
```

### 캐릭터별 음성 매핑

```python
VOICES = {
    "인물명": ("voice_id", "model"),  # model: ssfm-v21 또는 ssfm-v30
}
```

### 출력 파일명 규칙

```
{인물명}/{인물}_{번호}_{타임코드}.mp3
예: 소은/소은_01_0159.mp3
```

### 감정 파라미터

| 감정 | 설명 |
|------|------|
| `normal` | 기본 |
| `happy` | 밝은/기쁜 |
| `sad` | 슬픈 |
| `angry` | 화난/강한 |

## SFX (음향효과)

### 생성 API: ElevenLabs

```
API: https://api.elevenlabs.io/v1/sound-generation
인증: ~/.elevenlabs/credentials
```

### SFX 데이터 구조 (generate_sfx.py)

```python
# (폴더, 파일명, 영문 프롬프트, 길이(초))
("01_주판", "abacus_beads_01.mp3",
 "Wooden abacus beads clicking gently, traditional Korean counting", 3)
```

### SFX 카테고리

| 카테고리 | 폴더 | 예시 |
|----------|------|------|
| 소품 | `01_주판` | 주판 구슬 소리, 떨어지는 소리 |
| 환경음 | `02_환경음_*` | 바람, 빗소리, 새소리, 장터, 풀벌레 |
| 인체 | `03_침묵_호흡` | 숨소리, 한숨 |
| 발소리 | `04_발소리` | 걷기, 뛰기, 마루 |
| 금속/문 | `05_금속_타격_문` | 문 여닫기, 자물쇠 |
| 필기 | `06_붓소리` | 붓으로 쓰는 소리 |
| 군중 | `07_군중` | 수군거림, 웅성거림 |

### 타임코드 SFX

특정 씬에 맞춰야 하는 SFX는 파일명에 타임코드를 추가한다:
```
abacus_beads_dark_01_0015.mp3  ← 00:15 씬용
abacus_beads_01_0134.mp3       ← 01:34 씬용
```

## 오디오 리뷰 (.audio_review.json)

부적합 오디오 파일을 추적하는 JSON 파일.

```json
{
  "voice_samples/sfx/02_환경음_바람/wind_howl_01.mp3": {
    "status": "flagged",
    "reason": "타임코드 없음",
    "flaggedAt": "2026-03-16T05:44:55.228Z"
  }
}
```

### MCP 도구

- `list_audio_reviews`: 부적합 마크 목록 조회
- `update_audio_review`: 마크 추가/해제
