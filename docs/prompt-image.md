# 이미지 프롬프트 작성 가이드

씬 CSV의 `prompt` 필드와 레퍼런스 CSV의 `prompt` 필드에서 **이미지 모드**로 사용하는 영문 프롬프트 작성 규칙.

## 기본 규칙

- **영문**으로 작성 (AI 이미지 생성 도구 호환)
- 한 문장으로 장면을 묘사 (정지 화면 기준)
- 마지막에 시대/스타일 태그 추가
- 현대적 요소 배제
- 동작보다 **구도, 표정, 분위기**에 집중

## 프롬프트 구조

```
[인물 묘사] + [포즈/표정] + [장소/배경] + [시대/스타일 태그]
```

### 예시

```
A wealthy elderly nobleman with a topknot bowing deeply in regret
before a thin 14-year-old girl holding two ledger books
in a grand traditional courtyard,
Joseon dynasty, cinematic
```

```
Close-up of a 14-year-old girl's hands clutching old ledgers,
a glimpse of a worn wooden abacus tucked into her traditional vest,
Joseon dynasty, illustrated Korean webtoon style
```

## 필수 요소

| 요소 | 설명 | 예시 |
|------|------|------|
| 인물 | 나이, 외모, 의복 | "a thin 14-year-old girl" |
| 포즈/표정 | 정적인 상태 묘사 | "bowing deeply in regret" |
| 장소 | 배경/공간 | "in a grand traditional courtyard" |
| 시대 태그 | 시대 설정 | "Joseon dynasty" |
| 스타일 태그 | 화풍/분위기 | "cinematic", "illustrated Korean webtoon style" |

## 인물 묘사 키워드

| 한글 | 영문 |
|------|------|
| 상투 | topknot |
| 댕기머리 | braided hair with daenggi ribbon |
| 갓 | gat hat (갓) |
| 저고리+치마 | jeogori top and chima skirt |
| 도포 | dopo scholar's outer robe |
| 두루마기 | durumagi overcoat |
| 바지저고리 | baji jeogori |
| 비녀 | binyeo hairpin |
| 쪽진머리 | jjok bun |

## 장소/건축 키워드

| 한글 | 영문 |
|------|------|
| 기와지붕 | giwa tiled roofing |
| 초가지붕 | choga thatched roof |
| 한지 문 | hanji paper doors |
| 온돌 | ondol heated floor |
| 마당 | courtyard |
| 안채 | inner quarters |
| 사랑채 | men's quarters |
| 행랑채 | servants' quarters |
| 대문 | main gate |
| 아궁이 | clay stove |
| 가마솥 | iron pot |

## shot_type별 프롬프트 특성

| shot_type | 구도 | 프롬프트 특성 |
|-----------|------|--------------|
| `scene` | 와이드~미디엄 | 배경+인물 함께 묘사, 전체 공간감 |
| `reaction` | 클로즈업 | 표정/신체 반응 중심, 디테일 강조 |
| `narration` | 와이드/분위기 | 환경 중심, 인물은 실루엣이나 부분만 |
| `dialogue` | 미디엄~클로즈업 | 대화 구도, 2인 이상 또는 말하는 인물 |

## style_tag

씬 CSV의 `style_tag`에 분위기를 지정한다. 쉼표로 구분.

### 자주 쓰는 style_tag

```
Korean historical drama, Joseon dynasty, cinematic, dramatic, tense
Korean historical drama, Joseon dynasty, cinematic, warm, bittersweet
Korean historical drama, Joseon dynasty, cinematic, dark, ominous
Korean historical drama, Joseon dynasty, cinematic, emotional, sorrowful
Korean historical drama, Joseon dynasty, cinematic, heartbreaking, silent
illustrated Korean webtoon style  ← 클로즈업/감정 장면에 사용
```

## 레퍼런스 프롬프트 vs 씬 프롬프트

| | 레퍼런스 | 씬 |
|--|---------|-----|
| 목적 | 인물/장소 일관성 유지 | 개별 장면 생성 |
| 인물 수 | 반드시 1인 (`solo, single person`) | 다수 가능 |
| 포즈 | 기본 자세/표정 (중립) | 구체적 상황에 맞는 포즈 |
| 장소 | 기본 환경 설정 | 시간대/날씨/분위기 변형 |
| 구도 | 정면~반측면, 전신 또는 상반신 | shot_type에 따라 다양 |

## 이미지 프롬프트에서 피해야 할 것

- ❌ 동작 동사 (running, walking 등) → 정적 묘사로 대체
- ❌ 시간의 흐름을 암시하는 표현 → 한 순간을 캡처
- ❌ 텍스트/글자 삽입 요청 → `no text, no letters, no writing`
- ❌ 현대 오브젝트 → 시대에 맞는 소품으로 대체
