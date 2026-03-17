# 비디오 프롬프트 작성 가이드

씬 CSV의 `prompt` 필드에서 **비디오 모드**로 사용하는 영문 프롬프트 작성 규칙.
이미지 프롬프트의 모든 규칙을 포함하되, **동작과 카메라 움직임**이 추가된다.

## 기본 규칙

- **영문**으로 작성
- **동작 묘사를 구체적으로** 작성 (정지 화면이 아닌 움직임)
- 카메라 움직임 지시 가능
- 마지막에 시대/스타일 태그 추가
- 현대적 요소 배제

## 프롬프트 구조

```
[인물 묘사] + [동작/움직임] + [장소/배경] + [시대/스타일 태그] + [카메라 지시]
```

### 예시

```
A young girl slowly moving abacus beads while looking down with concentration,
her fingers gently flicking each bead one by one,
in a quiet courtyard under warm afternoon sunlight,
Joseon dynasty, cinematic, smooth camera
```

```
An elderly nobleman walking slowly across a moonlit courtyard,
his shadow stretching long behind him,
stopping to look up at the night sky with a heavy sigh,
Joseon dynasty, cinematic, slow tracking shot
```

```
Close-up of trembling hands unfolding a ledger book,
fingers tracing along columns of numbers,
pausing at a circled entry with widening eyes,
Joseon dynasty, illustrated style, slow zoom in
```

## 이미지 프롬프트와의 차이점

| | 이미지 | 비디오 |
|--|--------|--------|
| 동작 | 정적 포즈/표정 | 구체적 움직임 묘사 |
| 동사 | 상태 동사 (standing, holding) | 동작 동사 (walking, flicking, turning) |
| 카메라 | 고정 구도 | 카메라 움직임 지시 가능 |
| 시간 | 한 순간 | 짧은 시퀀스 (5~15초) |
| 묘사 깊이 | 디테일한 외모/배경 | 동작 순서와 감정 변화 |

## 동작 묘사 키워드

### 속도

| 키워드 | 용도 |
|--------|------|
| `slowly` | 감정적/무거운 장면 |
| `gently` | 섬세한/따뜻한 장면 |
| `quickly` | 긴박한/놀라는 장면 |
| `suddenly` | 반전/충격 장면 |
| `gradually` | 변화 과정 |

### 자주 쓰는 동작

| 한글 | 영문 |
|------|------|
| 고개를 숙이다 | bowing head down |
| 뒤돌아보다 | turning around to look back |
| 눈물을 닦다 | wiping tears from eyes |
| 주먹을 쥐다 | clenching fists tightly |
| 문을 열다 | sliding open a paper door |
| 걸어가다 | walking toward / walking away |
| 뛰어가다 | running desperately |
| 무릎을 꿇다 | dropping to knees |
| 편지를 펼치다 | unfolding a letter |
| 장부를 넘기다 | flipping through ledger pages |

## 카메라 지시

### 카메라 움직임

| 지시 | 효과 | 용도 |
|------|------|------|
| `smooth camera` | 부드러운 기본 움직임 | 범용 |
| `slow zoom in` | 천천히 확대 | 감정 고조, 긴장 |
| `slow zoom out` | 천천히 축소 | 상황 파악, 여운 |
| `pan left/right` | 좌우 패닝 | 공간 탐색, 인물 전환 |
| `tracking shot` | 인물 따라가기 | 이동 장면 |
| `static camera` | 고정 | 긴장, 정적 |
| `slow dolly in` | 전진 접근 | 클라이맥스 |
| `aerial view` | 조감 | 와이드 전경 |

### 카메라 구도

| 지시 | 효과 |
|------|------|
| `low angle` | 위압감, 권위 |
| `high angle` | 취약함, 외소함 |
| `eye level` | 중립, 공감 |
| `over the shoulder` | 대화, 관찰 |
| `dutch angle` | 불안, 혼란 |

## 비디오 프롬프트 작성 팁

1. **하나의 동작에 집중**: 한 씬(5~15초)에 하나의 핵심 동작만 묘사
2. **시작→끝 구조**: 동작의 시작과 끝 상태를 모두 기술
3. **감정 변화**: 동작 중 표정/감정의 변화를 포함
4. **환경 반응**: 바람에 옷자락 날림, 빗물 튀김 등 환경과의 상호작용

### 좋은 예시

```
✅ A girl sitting still, then slowly lifting her head to reveal tear-streaked cheeks,
   the candlelight flickering across her determined expression,
   Joseon dynasty, cinematic, slow zoom in
```

### 나쁜 예시

```
❌ A girl crying (너무 단순, 동작 없음)
❌ A girl runs across the courtyard, picks up a book, reads it, then throws it away
   (한 씬에 너무 많은 동작)
```

## 인물/장소/건축 키워드

이미지 프롬프트 가이드(`prompt-image.md`)의 키워드 표와 동일하게 적용한다.
