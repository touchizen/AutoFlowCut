# Import → Tab Auto-Switch Consistency

**Date:** 2026-06-01
**Status:** Approved, ready for plan

## Problem

가져오기 모달에서 파일을 import한 뒤 "결과를 볼 수 있는 탭으로 자동 전환"하는 동작이 일관되지 않다.

| Import | 모드 | 현재 동작 |
|--------|------|-----------|
| Text/CSV | 🎬 비디오 | ✅ `video-text` 탭으로 전환 |
| Reference | — | ✅ Ref 패널 열림 |
| Text/CSV | 🖼️ 이미지 | ❌ 전환 안 함 (현재 탭 유지) |
| SRT | — | ❌ 전환 안 함 |

비디오/reference는 챙겨주는데 이미지/SRT가 빠져 있다. 사용자가 audio·list 등 다른 탭에 있다가 이미지/SRT를 import하면 데이터는 채워졌는데 화면이 안 바뀌어 "들어왔나?" 헷갈린다.

## Principle

**Import한 데이터를 보거나 편집할 수 있는 탭으로 자동 전환한다.**

| Import | 모드 | 전환 대상 | 근거 |
|--------|------|-----------|------|
| Text/CSV | 🖼️ 이미지 | `text` (프롬프트 입력 탭) | 비디오의 `video-text`와 대칭. import한 프롬프트가 그 자리에 바로 보임. 이미지 생성 전이라 `list`는 빈 카드만 보임. |
| Text/CSV | 🎬 비디오 | `video-text` | 현행 유지 |
| SRT | — | `list` (씬 목록) | 자막이 기존 씬에 매칭된 결과를 목록에서 확인 |
| Reference | — | Ref 패널 | 현행 유지 (`actions.reference`가 `setShowReferences(true)`) |

## Design

### `tabForType(type, isVideo)` 헬퍼

순수 함수. text/csv 만 처리하고, srt/reference 는 자체 흐름이 전환을 담당하므로 `null` 반환.

```js
// src/utils/importTabRouting.js (신규)
export function tabForType(type, isVideo) {
  if (type === 'text' || type === 'csv') {
    return isVideo ? 'video-text' : 'text'
  }
  return null
}
```

### 적용 지점 (src/App.jsx `handleImport`)

1. **정상 경로 + wrong-type 확인 경로** 끝에서 통합 적용 — 기존 `shouldGoVideoTab(resolvedType)` 을 `tabForType` 으로 교체:
   ```js
   const tab = tabForType(resolvedType, isVideo)
   if (tab) setActiveTab(tab)
   ```

2. **`actions.srt`** — conflict 없는 즉시 처리 케이스에서만 `list` 전환:
   ```js
   srt: () => {
     const hasExistingSrt = (scenesHook.srtTrack || []).length > 0
     if (hasExistingSrt) {
       setSrtImportPending({ content, framePairs })
       return  // conflict — 모달 resolve 가 전환 담당
     }
     parseFromSRT(content, framePairs)
     setActiveTab('list')  // 즉시 처리 케이스만 전환
   }
   ```

3. **SRT conflict 모달** (`SrtImportConflictModal`) — `onReplace` / `onMerge` 핸들러에 `setActiveTab('list')` 추가. `onCancel` 은 전환하지 않음(원래 탭 유지가 올바른 동작).

4. **Reference** — 변경 없음. `actions.reference` 가 이미 Ref 패널을 연다.

### 동작 매트릭스 (검증 대상)

| 시작 탭 | Import | 결과 탭 |
|---------|--------|---------|
| audio | Text 이미지 | text |
| audio | Text 비디오 | video-text |
| audio | SRT (기존 SRT 없음) | list |
| audio | SRT (기존 SRT 있음) → 모달 replace | list |
| audio | SRT (기존 SRT 있음) → 모달 cancel | audio (유지) |
| list | Reference | (탭 유지) + Ref 패널 열림 |
| audio | Text 파일인데 'csv' 버튼으로 선택 (wrong-type) | text |

## Testing

- **단위**: `tabForType` — text/csv × image/video, srt/reference → null.
- **통합**: `handleImport` 흐름의 탭 전환. App.jsx 가 거대하므로, `tabForType` 단위 테스트 + SRT 모달 resolve 시 `list` 전환은 통합/수동으로 검증.
- 회귀: 비디오/reference 기존 동작 유지.

## Out of Scope

- 오디오 패키지 import 후 audio 탭 전환 (이미 별도 흐름, 사용자가 audio 탭에서 시작).
- frame-to-video import 라우팅 (현재 import 모달에 해당 옵션 없음).
- import 후 스크롤 위치/포커스 이동.
