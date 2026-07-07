# Story Length Combobox Spec

## Goal

Story > 설정의 `대본 분량`을 숫자 입력 가능한 combobox와 단위 선택 select로 정리한다.

사용자는 추천값을 고르거나 직접 숫자를 입력할 수 있고, 단위는 언어에 맞게 고를 수 있어야 한다.

## UX Requirements

1. `대본 분량` 행은 값 input과 단위 select를 함께 렌더한다.
2. 값 input은 `list="story-length-minutes"`를 가진 직접 입력 combobox다.
3. 기본값은 `10`, 기본 단위는 `min`이다.
4. 한국어 단위 옵션은 `분`, `자수`다.
5. 영어 단위 옵션은 `min`, `words`, `chars`다.
6. 단위를 바꾸면 같은 분량을 유지하도록 숫자도 변환한다.
   - `10분` -> `3300자수`
   - `10 min` -> `1500 words`
   - `1500 words` -> `3300 chars`
   - `100 words` -> `0.6667 min`
   - `100 words` -> 한국어 `220자`
7. 언어를 바꿀 때 현재 단위가 새 언어에서 허용되면 그대로 유지한다.
8. 언어를 바꿀 때 현재 단위가 새 언어에서 허용되지 않으면 같은 분량 기준으로 변환한다.
   - `words` -> 한국어: `chars`
9. 값 input의 접근성 이름은 `대본 분량 값`이다.
10. 단위 select의 접근성 이름은 `대본 분량 단위`이다.

## Unit Rules

| Language | Units |
| --- | --- |
| Korean | `min`, `chars` |
| English | `min`, `words`, `chars` |

Conversion constants:

- Korean narration: `330` characters per minute
- English narration: `150` words per minute
- Maximum duration target: `60` minutes

## Suggestions

The datalist suggestions always represent `1..60` minutes in the selected unit.

| Unit | Values |
| --- | --- |
| `min` | `1..60` |
| `chars` | `330, 660, ... 19800` |
| `words` | `150, 300, ... 9000` |

Labels:

- Korean `min`: `1분`
- Korean `chars`: `330자`
- English `min`: `1 min`
- English `words`: `150 words`
- English `chars`: `330 chars`

## Data Model

Story input options store the selected unit:

```json
{
  "lengthValue": "10",
  "lengthUnit": "min"
}
```

When the user selects `chars` or `words`, future writes preserve that unit:

```json
{
  "lengthValue": "3300",
  "lengthUnit": "chars",
  "lengthMode": "unit"
}
```

`lengthMode: "unit"` marks values written by the new value/unit UI. Without it, small legacy `chars`/`words` values in `1..60` are treated as old minute-shaped values.

## Validation

- Empty and non-numeric values fall back to the selected unit's `10` minute equivalent.
- Numeric values `<= 0` fall back to the selected unit's `10` minute equivalent.
- Positive numeric values round to the nearest integer.
- Values clamp to the selected unit's `60` minute equivalent.
- Unit conversion preserves sub-minute positive values by ratio; only the upper bound is clamped to 60 minutes.
- If conversion targets `min` and the result is below `1`, keep up to four decimals, such as `100 words` -> `0.6667 min`.
- Positive sub-minute values must not round down to `0`, such as `1 char` -> `0.003 min`.
- UI should allow temporary typing, but persisted/start payload should be normalized.

## Legacy Hydration

Legacy `chars` or `words` values in `1..60` are treated as old minute-shaped values, then converted into the displayed unit.

Examples:

- `lengthUnit: "words", lengthValue: "10", language: "en"` -> `1500 words`
- `lengthUnit: "chars", lengthValue: "10", language: "ko"` -> `3300 chars`
- `lengthUnit: "words", lengthValue: "1500", language: "en"` -> `1500 words`
- `lengthUnit: "chars", lengthValue: "3300", language: "ko"` -> `3300 chars`
- `lengthUnit: "words", lengthValue: "30", lengthMode: "unit", language: "en"` -> `30 words`

## Prompt Requirements

When `lengthUnit` is `min`, `buildScriptPrompt` includes both time and language-specific volume guidance:

- Korean: `약 N분(대략 X자)`
- English: `about N minutes (about Y words)`
- Sub-minute `min` values keep their decimal minute text, such as `0.67분` or `0.67 minutes`.

Direct units:

- Korean `chars` -> `약 N자`
- English `chars` -> `about N characters`
- English `words` -> `about N words`

## Non-Goals

- No runtime-duration measurement changes.
- No scene split timing changes.
- No change to already generated scripts except how settings hydrate in the UI.
