# 씬 CSV 스키마 (Scenes CSV)

AutoFlowCut에서 사용하는 씬 단위 데이터 파일.
각 행이 하나의 씬(장면)을 나타내며, 이미지/비디오 생성과 자막 표시에 사용된다.

## 컬럼 정의

| 컬럼 | 필수 | 타입 | 설명 |
|------|------|------|------|
| `scene` | | integer | 같은 숫자의 행을 한 slot으로 묶는 ordinal. 컬럼이 없으면 각 행이 별도 slot |
| `prompt` | | string | 영문 이미지/비디오 생성 프롬프트. visual-only slot에는 필수 |
| `prompt_ko` | | string | 한글 프롬프트 요약 (리뷰용) |
| `subtitle` | | string | 나레이션/대사 자막 텍스트 |
| `speaker` | 자막 있을 때 ✅ | string | 자막 화자. 나레이션도 `narrator`를 명시하며 자동 추론하지 않음 |
| `characters` | | string | 화면에 등장하는 인물 (쉼표 구분). 화자 판정에는 사용하지 않음 |
| `scene_tag` | | string | 장소/배경 태그 (references.csv의 scene name과 매칭) |
| `style_tag` | | string | 씬별 스타일/분위기 지시어 |
| `shot_type` | | string | 씬 유형: `scene`, `reaction`, `narration`, `dialogue` |
| `duration` | | number | 씬 길이 (초 단위, 소수점 3자리) |
| `start_time` | | number | 시작 시간 (초) |
| `end_time` | | number | 종료 시간 (초) |
| `parent_scene` | | string | 씬 그룹 ID (예: S001, S002) |

## 자동 감지 조건

각 kept row는 slot content 또는 timing을 가져야 한다. 자막 행은 `subtitle`+`speaker`, visual-only slot은 영문 `prompt`+timing이 필수다.

## 허용 header와 alias

허용하는 canonical header는 `scene`, `prompt`, `prompt_ko`, `subtitle`, `speaker`, `characters`, `scene_tag`, `style_tag`, `shot_type`, `duration`, `start_time`, `end_time`, `parent_scene`뿐이다. alias는 `prompt_en` → `prompt`, `subtitle_ko` → `subtitle`, `character` → `characters`, `background` → `scene_tag` 네 개다.

header는 주변 공백 제거와 소문자화 후 ASCII-keyed exact allowlist lookup으로 binding한다. 따라서 full-width 문자, zero-width 문자, homoglyph, 내부 TAB/SHY가 든 header와 목록 밖 header는 `storyboard-header-unknown`으로 거부한다. 개인 메모 열은 CSV에서 제거해야 하며 별도 extra-column 선언 문법은 없다.

## 규칙

- 한 씬은 **최대 15초** 이내
- 20분 영상 기준 약 **120~350개 씬**
- `prompt`는 영문으로 작성 (AI 이미지 생성 도구 호환)
- 두 header가 같은 bound field를 가리키면 `storyboard-header-duplicate`로 데이터 해석 전에 거부한다. 따라서 같은 이름의 대소문자/주변 공백 변형뿐 아니라 `prompt`+`prompt_en` 같은 canonical/alias 조합도 중복이다
- 빈 header cell은 identity가 아니다. 해당 열의 모든 data cell도 비어 있으면 Excel/Sheets trailing artifact로 무시하고, 값이 하나라도 있으면 `storyboard-header-unknown`으로 거부한다
- 어떤 data row든 header 길이 밖에 non-empty cell이 있으면 누락 header로 보고 `storyboard-header-unknown`으로 거부한다. declared cell이 모두 빈 row도 예외가 아니다
- `scene` 컬럼에 하나라도 값이 있으면 첫 kept board row는 JavaScript safe integer여야 한다. 이후 빈 셀은 직전 ordinal을 이어받고, 비정수 또는 safe-integer 범위 밖의 값은 거부한다. 컬럼 전체가 비어 있으면 컬럼이 없는 것으로 취급한다
- `scene` ordinal은 row 순서에서 감소할 수 없다. 컬럼이 없거나 전체가 비어 있을 때 kept board row마다 `1, 2, 3, ...`을 부여한다
- 물리 빈 줄과 유효한 정수 또는 빈 `scene` 외 모든 셀이 빈 행은 import 전에 제거한다. scene-only 행의 ordinal은 다음 행의 carry-forward에 먼저 반영하며, 비정수 scene-only 행은 제거하지 않고 오류로 거부한다
- 연속 scene-only 행이나 EOF의 scene-only 행은 실제 board content가 없는 declared scene을 만들지 않는다. 따라서 중간의 content 없는 ordinal은 결과 slot에서 사라질 수 있고, adapter의 distinct slot count 검사가 이미지 수와 다르면 import를 거부한다
- `sourceRowId`는 raw 파일 line 번호가 아니라 제거 후 parsed board row 순서로 `storyboard-row-1`, `storyboard-row-2`, ...를 부여한다
- `subtitle`이 있으면 `speaker`를 반드시 명시한다. 나레이션은 literal `narrator`만 허용하며 `해설`, `narration`, `화자` 같은 alias나 빈 값을 거부한다
- 한 slot에는 서로 다른 non-empty `prompt` 값이 최대 하나만 있어야 한다. 반복값은 앞뒤 공백까지 포함해 byte-identical일 때만 하나로 취급한다. 예를 들어 `p1`과 ` p1 `은 서로 다른 값이며 `storyboard-prompt-ambiguous`로 거부한다
- slot 단위로 하나의 값으로 collapse되는 `prompt_ko`, `characters`, `scene_tag`, `style_tag`, `shot_type`, `parent_scene`도 각 slot 안의 서로 다른 non-empty 값을 허용하지 않으며 `storyboard-field-ambiguous`로 거부한다. `subtitle`, `speaker`, timing은 row 단위라 이 규칙의 대상이 아니다
- visual-only slot에는 non-empty 영문 `prompt`와 유효한 timing이 모두 필요하다. prompt 누락은 `storyboard-prompt-missing`, timing 누락은 `storyboard-duration-missing`으로 구분한다
- `duration`은 양수 일반 십진수만 허용한다. `start_time`/`end_time`은 일반 십진수 또는 `HH:MM:SS(.mmm)`만 허용한다(hex/지수/binary/octal 표기 불가). 시작은 0 이상이고 종료보다 작아야 한다
- 빈 파일과 header-only CSV는 유효한 storyboard가 아니다
- `characters`는 쉼표로 구분 (예: "소은,아버지,곽주사")
- `scene_tag`는 references.csv의 scene 타입 name과 일치시킨다
- CSV 인코딩: UTF-8 (BOM 허용)
- 따옴표 포함 필드는 `"` 로 감싸고, 내부 따옴표는 `""` 로 이스케이프

## 샘플

```csv
scene,prompt,prompt_ko,subtitle,speaker,characters,scene_tag,style_tag,shot_type,duration,start_time,end_time,parent_scene
1,"A wealthy elderly nobleman bowing before a young girl in a courtyard, Joseon dynasty, cinematic",장부 든 소녀 앞에 고개 숙인 양반,"문중 어른들 앞에서, 거상이 고개를 숙였습니다",narrator,"장대인,소은,곽주사",courtyard,"Korean historical drama, cinematic, tense",scene,11.830,0.000,11.830,S001
```
