# Split View + WebContentsView Migration Design

## Background

- DOM 모드에서 Whisk 이미지 생성 과정을 보면서 App에서 프롬프트/씬 편집을 동시에 해야 함
- 현재는 탭 전환 방식이라 한 번에 하나만 보임
- `BrowserView`는 Electron 30에서 deprecated → `WebContentsView`로 마이그레이션 필요

## Layout Modes

| 모드 | 탭 바 | Whisk | App | 기본 사용 |
|------|-------|-------|-----|----------|
| `tab` | 표시 (40px) | 전체 또는 숨김 | 전체 또는 숨김 | API 모드 (기본) |
| `split-h` | 숨김 | 좌측 | 우측 | DOM 모드 기본 |
| `split-v` | 숨김 | 상단 | 하단 | 설정에서 선택 |

## Architecture

### Current (BrowserView)
```
BrowserWindow (mainWindow)
  ├── webContents → React App (preload.js)
  └── BrowserView (whiskView) → Whisk URL
```

### New (WebContentsView)
```
BrowserWindow (mainWindow)
  ├── webContents → React App (preload.js) — 변경 없음
  └── contentView
      └── WebContentsView (whiskView) → Whisk URL
```

`BrowserWindow`의 자체 `webContents`는 그대로 유지 (preload, React 앱 로드).
Whisk만 `BrowserView` → `WebContentsView`로 교체하여 `contentView.addChildView()`로 관리.

## Bounds Calculation

### Tab Mode
```
탭 바: 40px (고정, 상단)

App 탭 활성:
  App:   { x: 0, y: 40, width: W, height: H - 40 }  (BrowserWindow webContents 전체)
  Whisk: { x: 0, y: 0, width: 0, height: 0 }         (숨김)

Whisk 탭 활성:
  App:   CSS display:none
  Whisk: { x: 0, y: 40, width: W, height: H - 40 }
```

### Split-H Mode (좌우 분할)
```
탭 바: 숨김

splitPos = W * splitRatio  (기본 50%)

Whisk: { x: 0, y: 0, width: splitPos, height: H }
App:   CSS margin-left: splitPos (React 측)
Resizer: 6px wide, position: absolute, left: splitPos - 3
```

### Split-V Mode (상하 분할)
```
탭 바: 숨김

splitPos = H * splitRatio  (기본 50%)

Whisk: { x: 0, y: 0, width: W, height: splitPos }
App:   CSS margin-top: splitPos (React 측)
Resizer: 6px tall, position: absolute, top: splitPos - 3
```

## Drag Resizer

1. React에서 `<div className="split-resizer">` 렌더링
2. `mousedown` → `mousemove` → `mouseup`으로 splitPos 추적
3. 드래그 중 Whisk WebContentsView 위에 투명 오버레이 표시 (마우스 이벤트 캡처용)
4. splitPos 변경 시 IPC `app:update-split` → main process → `whiskView.setBounds()` 업데이트
5. 최소/최대 비율: 20% ~ 80%

## IPC

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `app:set-layout` | Renderer → Main | `{ mode, splitRatio }` | 레이아웃 모드 변경 |
| `app:update-split` | Renderer → Main | `{ position }` | 드래그 중 실시간 bounds 업데이트 |
| `app:layout-changed` | Main → Renderer | `{ mode, splitRatio }` | 레이아웃 변경 알림 |

## Settings

`SettingsModal`에 **🖥️ 화면** 탭 추가:

- **레이아웃 모드**: tab / split-h / split-v (라디오 버튼)
- **분할 비율**: 20%~80% (슬라이더, split 모드에서만 표시)
- localStorage에 저장

## Files to Change

| File | Change |
|------|--------|
| `electron/main.js` | BrowserView → WebContentsView, layout mode 관리, 새 IPC |
| `electron/preload.js` | 새 IPC 노출 (setLayout, updateSplit, onLayoutChanged) |
| `src/Shell.jsx` | split 모드 시 탭 바 숨김, 리사이저 렌더링, 레이아웃 상태 관리 |
| `src/App.css` | 리사이저 스타일, split 모드 레이아웃 CSS |
| `src/components/SettingsModal.jsx` | 화면 탭 추가 |
| `src/components/settings/DisplayTab.jsx` | 새 파일 — 레이아웃 설정 UI |
