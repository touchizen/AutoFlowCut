# Audio Tab Design

## Overview
Audio 탭을 추가하여 오디오 패키지(음성/SFX/SRT)를 상시 확인하고, 부적합 파일을 마크/교체할 수 있는 UI를 제공한다.

## 탭 위치
```
[📝 Text] [🎬 Video] [🎞️ F→V] | [📋 List] [🖼️ Ref] [🎵 Audio] [📂 Import]
```
- import 전: 비활성 (클릭 시 "Import 먼저" 안내)
- import 후: 활성화, 뱃지로 파일 수 표시 (예: `🎵 Audio (183)`)

## 서브 탭 구조
```
[📊 요약] [⏱️ 타임라인]
```

### 요약 뷰
AudioResultModal 레이아웃 재활용:
- 요약 카드 (캐릭터, 음성, SFX, SRT, footage)
- Voice 섹션 (정렬: 캐릭터/타임코드/개수, 아코디언 ↔ 테이블)
- SFX 섹션 (정렬: 분류/이름/타임코드, 아코디언 ↔ 테이블)
- 재생 버튼 + 부적합 마크

### 타임라인 뷰
시간순 통합 테이블:
- 칼럼: `타임코드 | 타입(🎤/🔊) | 캐릭터/분류 | 파일명 | SRT 대사 | ▶️ | ⚠️`
- Voice + SFX를 시간순으로 섞어서 표시
- 자막 대사 매칭하여 적합성 판단 가능

## 부적합 마크 기능

### 워크플로우
1. ⚠️ 클릭 → 사유 입력 팝오버 → 저장
2. 마크된 파일은 시각적으로 구분 (배경색/아이콘)
3. 대화에서 MCP로 마크 목록 읽고 대체 추천 (1차)
4. 추후 앱 내 "AI 대체 제안" 버튼 자동화 (2차)

### 데이터 저장
- `media/.audio_review.json` 파일에 저장
- 구조:
```json
{
  "reviews": {
    "sfx/05_금속_타격_문/door_02.mp3": {
      "status": "flagged",
      "reason": "초인종 소리, 조선시대에 안 맞음",
      "flaggedAt": "2026-03-16T..."
    }
  }
}
```
- 재 import 시에도 마크 유지

## 기존 AudioResultModal
- import 완료 시 결과 확인용으로 유지
- OK 누르면 Audio 탭으로 자동 전환

## 구현 범위 (1차)
- Audio 탭 + 요약/타임라인 서브 탭
- 부적합 마크 + 사유 저장 (.audio_review.json)
- MCP로 마크 목록 읽기 (flow2capcut MCP 또는 대화에서 직접)

## 구현 범위 (2차, 추후)
- 앱 내 AI 대체 제안 버튼
- MCP 자동 호출 → 대체 파일 추천 UI
