# 태그 Combo 드롭다운 멀티선택 + 전체목록 표시

작성일: 2026-05-17

## 배경

씬 목록의 캐릭터/배경/스타일 태그 칸은 `TagInputAutocomplete` (텍스트 입력 + 자동완성 드롭다운)을 쓴다. 두 가지 불편함이 있다:

1. **멀티선택 불가** — 드롭다운 항목을 클릭하면 마지막 콤마 토큰만 교체된다. 캐릭터를 2명 이상 넣으려면 `,`를 직접 타이핑해야 한다. 데이터(`characters`)는 콤마 구분 멀티값을 지원하는데 UI가 못 따라간다.

2. **선택 후 나머지 목록이 사라짐** — 드롭다운이 입력 텍스트(마지막 토큰)로 필터링되므로, 태그가 레퍼런스 이름과 정확히 일치하면 그 항목만 남고 다른 레퍼런스가 안 보인다.

추가로, 씬 상세 모달(`SceneDetailModal`)은 SceneList와 따로 논다: 캐릭터/배경은 평범한 `<input>`, 스타일은 프리셋만 노출하는 별도 `style-dropdown`이고 값을 프리셋 `id`로 저장한다.

## 목표

- `TagInputAutocomplete`를 멀티선택 가능한 콤보로 개선한다.
- `SceneDetailModal`도 같은 컴포넌트를 써서 일관성을 맞춘다.

## 비목표 (Non-goals)

- 데이터 구조 변경 없음 — `characters`/`scene_tag`/`style_tag`는 콤마 구분 문자열 그대로.
- 매칭 인디케이터를 클릭하면 열리는 `TagBatchModal`은 손대지 않는다 (이미 체크박스 멀티선택 지원).
- 배경/스타일을 멀티선택으로 만들지 않는다 — 단일 선택 유지.

## Part A — `TagInputAutocomplete` 개선

대상: `src/components/TagInputAutocomplete.jsx` + `src/components/TagInputAutocomplete.css`

### A1. 확정된 선택은 필터링하지 않음 (3개 타입 공통)

현재 드롭다운 필터는 `splitLastToken(value).last`를 `filterToken`으로 쓴다.

규칙 추가: **마지막 토큰이 알려진 옵션(레퍼런스/프리셋)의 값과 정확히 일치하면(대소문자 무시) = 확정된 선택**으로 보고 필터를 적용하지 않는다(전체 목록 노출). 일치하지 않으면 = 입력 중인 필터이므로 현재처럼 필터링한다.

### A2. 선택된 항목 체크 표시 (3개 타입 공통)

드롭다운 각 옵션 왼쪽에 체크 표시(`✅` / 빈칸)를 둔다. 판정 기준: 현재 값의 토큰셋(`splitTags(value)`, 소문자)에 그 옵션 값이 포함되는지.

### A3. 캐릭터 = 멀티선택 토글, 배경/스타일 = 단일 교체

- `type === 'character'` (멀티): 옵션 클릭 시 콤마 목록에 추가/제거를 **토글**한다.
  - 토글 로직: 현재 값을 `[,;:]`로 분리(트림, **대소문자 보존**)한다. 마지막 토큰이 비어있지 않고 알려진 옵션과 정확히 일치하지 **않으면**(= 입력 중 필터) 그 토큰은 버린다. 남은 토큰셋에서 클릭한 옵션 값을 대소문자 무시로 토글한다. `, `로 재결합해 `onChange`한다.
  - ref 없이 수동 타이핑한 확정 토큰(= 입력 중 필터가 아닌 토큰)은 보존한다.
  - 선택 후 드롭다운은 열린 채 유지 (연속 선택). 현재 `onMouseDown` + `preventDefault`로 포커스가 유지되므로 추가 변경 불필요.
- `type === 'scene' | 'style'` (단일): 옵션 클릭 시 값을 클릭한 옵션 값으로 **통째 교체**한다.

### A4. 타이핑 동작은 유지

3개 타입 모두, 미완성 토큰을 타이핑하면 드롭다운이 필터링된다 (A1 규칙에 따라 마지막 토큰이 확정 매칭이 아닐 때만).

## Part B — `SceneDetailModal`이 `TagInputAutocomplete` 채택

대상: `src/components/SceneDetailModal.jsx` (+ 호출처 2곳)

### B1. 태그 입력 3개 교체

- 캐릭터 `<input>` → `TagInputAutocomplete type="character"`
- 배경 `<input>` → `TagInputAutocomplete type="scene"`
- 스타일 `style-dropdown` → `TagInputAutocomplete type="style"` (`presets={STYLE_PRESETS.styles}`, `thumbnails={styleThumbnails}`)

각각 `value`는 `editData.{characters,scene_tag,style_tag}`, `onChange`는 `setEditData({ ...editData, <field>: v })`. `references`, `isKo`, `t`도 전달. SceneList의 [SceneList.jsx:182-227](../../../src/components/SceneList.jsx) 와이어링을 그대로 따른다.

라벨 옆 복사 버튼(`btn-copy`)은 유지한다.

### B2. 낡은 코드 제거

이 변경으로 dead code가 되는 것 정리: `showStyleDropdown` state, `style-dropdown-wrapper` JSX 블록. 관련 CSS(`SceneDetailModal.css`의 `style-dropdown*`)가 다른 곳에서 안 쓰이면 함께 제거.

### B3. props 추가 및 호출처 전달

`SceneDetailModal`에 `references`, `styleThumbnails` props 추가. 전달 호출처 2곳:

- `src/components/SceneList.jsx:556` — SceneList는 이미 두 값을 보유 (SceneRow에 전달 중).
- `src/App.jsx:1383` — App이 보유하고 있는지 구현 시 확인. 루트 컴포넌트라 거의 확실히 있음.

### B4. 부작용: 스타일 값 저장 형식 변경

상세 모달의 스타일 값이 프리셋 `id` → 프리셋 **이름** 저장으로 바뀐다. SceneList와 동일해지며, `checkTagMatch`(style)가 `id`/`name_ko`/`name_en`을 모두 매칭으로 인정하므로 매칭은 깨지지 않는다.

## 테스트

### Part A 단위 테스트 — `tests/components/TagInputAutocomplete.test.jsx`

- 캐릭터: 옵션 클릭 시 값에 추가됨 / 이미 선택된 옵션 클릭 시 제거됨 / 여러 개 누적 선택됨.
- 배경·스타일: 옵션 클릭 시 값이 통째 교체됨.
- 체크 표시: 현재 값에 포함된 옵션에만 표시됨.
- A1: 값이 확정 매칭일 때 드롭다운에 전체 목록이 노출됨 (한 항목으로 좁혀지지 않음).
- 타이핑 필터: 미완성 토큰 입력 시 드롭다운이 필터링됨.
- 캐릭터 토글 시 입력 중이던 미완성 토큰은 버려지고, 확정 토큰은 보존됨.

### Part B 통합 테스트 — `tests/components/SceneDetailModal/integration.test.jsx`

- 상세 모달에 캐릭터/배경/스타일이 `TagInputAutocomplete`로 렌더된다.
- 각 태그를 드롭다운에서 선택하면 `editData`가 갱신되고, 저장 시 `onUpdate`로 전달된다.
- 스타일 선택 시 프리셋 이름이 저장된다.

테스트 러너: vitest. 외부 의존성(IPC 등)은 mock.

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `src/components/TagInputAutocomplete.jsx` | 멀티선택 토글, 확정-선택 필터 예외, 체크 표시 |
| `src/components/TagInputAutocomplete.css` | 체크 표시 스타일 |
| `src/components/SceneDetailModal.jsx` | 태그 입력 3개 교체, 낡은 style-dropdown 제거, props 추가 |
| `src/components/SceneDetailModal.css` | 미사용 `style-dropdown*` CSS 제거 |
| `src/components/SceneList.jsx` | `SceneDetailModal`에 `references`/`styleThumbnails` 전달 |
| `src/App.jsx` | `SceneDetailModal`에 `references`/`styleThumbnails` 전달 |
| `tests/components/TagInputAutocomplete.test.jsx` | Part A 단위 테스트 |
| `tests/components/SceneDetailModal/integration.test.jsx` | Part B 통합 테스트 |
