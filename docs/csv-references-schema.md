# 레퍼런스 CSV 스키마 (References CSV)

인물, 장소, 스타일의 레퍼런스 이미지 생성용 프롬프트를 정의하는 파일.
Flow2CapCut에서 레퍼런스 이미지를 생성할 때 사용되며, 씬 CSV의 `scene_tag`, `characters` 필드와 매칭된다.

## 컬럼 정의

| 컬럼 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `name` | ✅ | string | 레퍼런스 이름 (인물명, 장소명, 스타일명) |
| `type` | ✅ | string | `character` / `scene` / `style` |
| `prompt` | ✅ | string | 영문 이미지 생성 프롬프트 |

## 자동 감지 조건

`name` + `type` 컬럼 필수. `subtitle`, `characters`, `duration` 컬럼이 없어야 함.

## 타입별 작성 규칙

### character (인물)

- **반드시 `solo, single person`으로 시작** (1인 레퍼런스)
- 포함 항목: 나이, 성별, 외모, 머리 스타일, 의복, 표정, 자세
- 조선시대 용어 병기: `topknot (상투)`, `jeogori top and chima skirt (저고리+치마)`
- 마지막에 `historical Korean costume, no modern clothing` 추가

### scene (장소/배경)

- 시대, 건축양식, 조명, 분위기 포함
- 마지막에 `no modern elements` 추가
- 동일 장소의 시간대 변형: `courtyard`, `courtyard_rain`, `courtyard_night`

### style (스타일)

- 화풍, 색감, 선 스타일 등 정의
- 모든 씬에 공통 적용되는 스타일 프리셋

## 샘플

```csv
name,type,prompt
소은,character,"solo, single person, a beautiful 14-year-old Korean Joseon dynasty girl with bright gentle eyes, soft kind smile, long braided hair with daenggi ribbon (댕기머리), wearing a clean neat jeogori top and chima skirt (저고리+치마), historical Korean costume, no modern clothing"
courtyard,scene,"A traditional Korean Joseon dynasty (조선시대) courtyard (마당) with stone-paved ground, wooden pillars, giwa tiled roofing (기와지붕), open sky above, warm natural daylight, no modern elements"
joseon_drama,style,"Korean manhwa webtoon illustration style, clean line art, soft cel shading"
```
