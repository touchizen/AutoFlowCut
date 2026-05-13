# Tag Input UX Design

**Status:** Draft
**Date:** 2026-05-13
**Branch:** `claude/mystifying-beaver-0fb0c9`

## Goal

씬 목록의 Match Tags 컬럼에서 사용자가 (1) ref 카드 이름을 외우거나 오타 신경 안 쓰고 자유롭게 선택할 수 있게, (2) 모든 type의 일괄 적용 버튼을 헤더에서 발견할 수 있게.

## Background

[SceneList.jsx:181-215](src/components/SceneList.jsx:181) 의 Character/Background/Style 인풋은 plain `<input type="text">`. 사용자가 ref 카드 이름을 정확히 타이핑해야 매칭. ref 이름을 모르면 빈 인풋만 보고 추측해야 함. 또한 헤더에 일괄 적용 버튼은 style type만 있고 ([line 473-480](src/components/SceneList.jsx:473)), character/background는 같은 기능 없음 — 일관성 결여.

## Scope

**범위 안:**
- 씬 목록의 세 태그 인풋 (Character/Background/Style) — 콤보 드롭다운으로 교체
- 헤더의 일괄 적용 버튼 — character/background 추가

**범위 밖:**
- Tag Batch Modal 자체 (별도 컴포넌트, 기존 동작 유지)
- 씬 상세 모달의 태그 인풋 (있다면)
- ResultsTable 같은 다른 위치의 인풋

## Design

### Part A: `<TagInputAutocomplete>` 신규 컴포넌트

**Props:**
```
{
  type: 'character' | 'scene' | 'style'
  value: string
  onChange: (newValue) => void
  references: Array<Reference>
  presets?: Array<Preset>     // style type일 때 STYLE_PRESETS.styles 전달, 그 외 무시
  placeholder?: string
  disabled?: boolean
  title?: string
  className?: string          // matched/unmatched border 스타일 적용
  isKo: boolean
}
```

**동작:**

| 트리거 | 동작 |
|---|---|
| Focus | 입력란 아래에 dropdown 펼침. 그 type의 ref 이름 + (style일 때) 매칭 preset 옵션 |
| 타이핑 | 마지막 토큰(`splitTags`의 마지막 요소) 기준 case-insensitive prefix filter |
| 항목 클릭 또는 Enter | 마지막 토큰만 그 항목 이름으로 교체. 예: `noir, c` + "cinematic" → `noir, cinematic` |
| ↑↓ | dropdown 항목 순회. 선택된 항목 highlight |
| ESC | dropdown 닫기 (input 값 유지) |
| Blur (외부 클릭) | dropdown 닫기 (값 유지) |

**Multi-tag 처리:**
- 토큰 분리: `splitTags`와 동일하게 `[,;:]` split + trim + lowercase (production 매칭 로직 재사용)
- 마지막 토큰만 filter/교체. 다른 토큰은 손대지 않음
- 사용자가 콤마(`,`) 직접 입력해서 토큰 끝내고 다음 토큰 입력 가능

**옵션 표시:**
- 모든 항목은 그 type의 ref만 dropdown에 나오므로 type 라벨은 불필요. ref 카드 이름만 표시.
- preset 항목 (style type일 때만): preset 표시 이름은 `isKo ? preset.name_ko : preset.name_en`. ref 항목과 구분 위해 옆에 작은 회색 "(preset)" suffix.
- 빈 결과 (ref + preset 합쳐서 0개): 안내 텍스트 — i18n 키 `sceneList.noRefsForType` (예: "이 type의 사용 가능한 ref/preset 없음")
- ref와 preset 섞여 있을 때 정렬: ref 먼저, preset 나중. 각 그룹 안에서는 array 순서 유지.

**키보드:**
- ↑↓: 항목 순회 (wrap-around 안 함, 처음/끝에서 stop)
- Enter: 선택된 항목으로 마지막 토큰 교체. 선택된 항목 없으면 default action (browser submit) prevent + 그대로 둠
- ESC: dropdown 닫기, 포커스는 input 유지
- Tab: 다음 인풋으로 (default, dropdown 자동 닫힘)

### Part B: 헤더 일괄 적용 버튼 일관화

[SceneList.jsx:471-481](src/components/SceneList.jsx:471) 의 `<th className="col-tags">` 내부에 character/scene 버튼 추가:

```jsx
<th className="col-tags">
  {t('sceneList.tags')}
  {references.some(r => r.type === 'character') && (
    <button
      className="btn-tag-batch"
      onClick={() => setTagBatchModal({ type: 'character' })}
      title={t('sceneList.batchCharacterTag')}
      disabled={disabled}
    >👤</button>
  )}
  {references.some(r => r.type === 'scene') && (
    <button
      className="btn-tag-batch"
      onClick={() => setTagBatchModal({ type: 'scene' })}
      title={t('sceneList.batchSceneTag')}
      disabled={disabled}
    >🏞️</button>
  )}
  {references.some(r => r.type === 'style') && (
    <button
      className="btn-tag-batch"
      onClick={() => setTagBatchModal({ type: 'style' })}
      title={t('sceneList.batchStyleTag')}
      disabled={disabled}
    >🎨</button>
  )}
</th>
```

- 기존 `btn-style-tag-batch` className → `btn-tag-batch`로 일반화 (3개 버튼 공통 스타일)
- TagBatchModal은 이미 세 type 모두 지원 ([TagBatchModal.jsx:15-17](src/components/TagBatchModal.jsx:15)) — handler 변경 없음
- 각 type의 ref 카드가 있을 때만 버튼 노출

**i18n 키 추가:**
- ko.js + en.js의 `sceneList` namespace
- `batchCharacterTag` / `batchSceneTag` (Part B 헤더 버튼 title)
- `noRefsForType` (Part A dropdown 빈 결과 안내)
- `batchStyleTag`는 이미 존재

## File Structure

**신규:**
- `src/components/TagInputAutocomplete.jsx` (단일 컴포넌트, type prop으로 분기)
- `src/components/TagInputAutocomplete.css` (dropdown 스타일)
- `tests/components/TagInputAutocomplete.test.jsx`

**수정:**
- `src/components/SceneList.jsx`
  - import `TagInputAutocomplete`
  - 라인 181-215의 세 input 교체 (TagInputAutocomplete 사용)
  - 라인 471-481의 `<th className="col-tags">` 헤더에 character/scene 버튼 추가
  - 기존 `MatchIndicator`, `checkTagMatch`, className matched/unmatched 흐름은 유지
- `src/components/SceneList.css`
  - `.btn-style-tag-batch` → `.btn-tag-batch`로 rename + 같은 스타일이 3개 버튼에 적용
- `src/locales/ko.js` + `src/locales/en.js`
  - `sceneList.batchCharacterTag`, `sceneList.batchSceneTag` 추가

## Testing

**Part A — `tests/components/TagInputAutocomplete.test.jsx`:**

- focus → dropdown이 ref 옵션 표시
- 타이핑 → 마지막 토큰 기준 filter (case-insensitive)
- 항목 클릭 → 마지막 토큰만 교체 (`noir, c` + `cinematic` → `noir, cinematic`)
- 항목 0개일 때 빈 안내 텍스트 표시
- ↑↓ 키보드로 항목 순회
- Enter → 선택된 항목 적용
- ESC → dropdown 닫음
- Blur → dropdown 닫음
- style type일 때 preset 옵션도 같이 노출
- character/scene type일 때 preset 옵션 무시
- disabled prop 적용 시 dropdown 안 뜸

**Part B — `tests/components/SceneList.test.jsx` (신규 또는 기존 확장):**

- references에 character ref 있을 때만 character 버튼 헤더에 표시
- 같은 패턴으로 scene/style 버튼
- 클릭 시 setTagBatchModal({ type: 그 type }) 호출 (handler 검증)

## Out of Scope (defer)

- multi-token autocomplete의 advanced 기능 (예: 이미 입력된 토큰 자동 제거)
- 키보드로 항목 추가 시 자동 콤마 삽입
- ref 카드 hover preview (이름 옆에 작은 썸네일)
- 다른 위치의 태그 인풋 (Tag Batch Modal, Scene Detail Modal)
