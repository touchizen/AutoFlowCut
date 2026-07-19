# 씬 CSV 스키마 (Scenes CSV)

AutoFlowCut에서 사용하는 씬 단위 데이터 파일.
각 행이 하나의 씬(장면)을 나타내며, 이미지/비디오 생성과 자막 표시에 사용된다.

## 컬럼 정의

| 컬럼 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `prompt` | ✅ | string | 영문 이미지/비디오 생성 프롬프트 |
| `prompt_ko` | | string | 한글 프롬프트 요약 (리뷰용) |
| `subtitle` | | string | 나레이션/대사 자막 텍스트 |
| `characters` | | string | 등장 인물 (쉼표 구분) |
| `scene_tag` | | string | 장소/배경 태그 (references.csv의 scene name과 매칭) |
| `style_tag` | | string | 스타일 지시어 (예: "Korean historical drama, cinematic, tense") |
| `shot_type` | | string | 씬 유형: `scene`, `reaction`, `narration`, `dialogue` |
| `duration` | | number | 씬 길이 (초 단위, 소수점 3자리) |
| `start_time` | | number | 시작 시간 (초) |
| `end_time` | | number | 종료 시간 (초) |
| `parent_scene` | | string | 씬 그룹 ID (예: S001, S002) |
| `image_provider` | | string | 씬 이미지 provider override: `google`, `openai`, `fal` |
| `image_model` | | string | 씬 이미지 model override |
| `t2v_provider` | | string | 씬 T2V provider override: `google`, `grok`, `fal`, `wavespeed`, `higgsfield` |
| `t2v_model` | | string | 씬 T2V model override |
| `i2v_provider` | | string | 씬 I2V provider override: `google`, `grok`, `fal`, `wavespeed`, `higgsfield` |
| `i2v_model` | | string | 씬 I2V model override |

## 자동 감지 조건

`prompt` 컬럼 필수 + 다음 중 하나 이상 존재: `subtitle`, `characters`, `scene_tag`, `style_tag`, `duration`

## 규칙

- 한 씬은 **최대 15초** 이내
- 20분 영상 기준 약 **120~350개 씬**
- `prompt`는 영문으로 작성 (AI 이미지 생성 도구 호환)
- `characters`는 쉼표로 구분 (예: "소은,아버지,곽주사")
- `scene_tag`는 references.csv의 scene 타입 name과 일치시킨다
- CSV 인코딩: UTF-8 (BOM 허용)
- 따옴표 포함 필드는 `"` 로 감싸고, 내부 따옴표는 `""` 로 이스케이프
- generation 셀을 비우면 기존 override를 보존한다. provider 셀에 `__inherit__`를 쓰면 해당 stage override를 삭제하고 전역 설정을 상속한다.

## 샘플

```csv
prompt,prompt_ko,subtitle,characters,scene_tag,style_tag,shot_type,duration,start_time,end_time,parent_scene
"A wealthy elderly nobleman bowing before a young girl in a courtyard, Joseon dynasty, cinematic",장부 든 소녀 앞에 고개 숙인 양반,"문중 어른들 앞에서, 거상이 고개를 숙였습니다","장대인,소은,곽주사",courtyard,"Korean historical drama, Joseon dynasty, cinematic, tense",scene,11.830,0.000,11.830,S001
```
