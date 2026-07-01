# AutoFlowCut — Product Features (Microsoft Partner Center)

> Partner Center → 제품 기능 (Product features). Max **20** entries, each ≤200 chars.
> Copy each line below into a feature row. Order = display order.

---

## 🇺🇸 English (20)

```
Flow Login + API Key (BYOK)
Batch Image Generation (100+)
T2V (Text-to-Video)
I2V (Image-to-Video)
One-Click Export: CapCut / Premiere / Vrew
@ Reference Picker & Chips
94+ Style Presets
Per-Scene Media Selection
Auto Tag Matching
Ken Burns Animation
TXT / CSV / SRT Import
Built-in MCP Server for Claude Code
Bulk Prompt Editing via AI Assistant
Custom Skill Installation & Workflow
HTTP API (Port 3210) for External Tools
Subtitle Editing
Free & Open Source
AudioTimeline (Multi-Track Preview)
Audio Auto-Placement (Timecoded)
Story Engine v2 (9-Wave Pipeline)
```

### Change log vs. current live list

| Action | Feature | Note |
|--------|---------|------|
| ➖ Remove | `Auto-Save & Auto-Retry` | Generic utility — freed a slot for the @ picker |
| 🔁 Rename | `Google Flow AI Integration` → `Flow Login + API Key (BYOK)` | Now dual generation modes |
| 🔁 Rename | `One-Click CapCut Export` → `One-Click Export: CapCut / Premiere / Vrew` | Multi-editor export |
| ➕ Add | `@ Reference Picker & Chips` | Pick character/scene/style refs in a prompt; inline chips |
| 🩹 Fix | `Story Engine v2 (8-Wave Pipeline)` → `Story Engine v2 (9-Wave Pipeline)` | Pipeline is 9 waves |

> Open item: store Description says "87 style presets" but `src/config/style_presets.json`
> reports `total_count: 95` (styles array = 103). Feature label kept at "94+"; align later if desired.

---

## 🇰🇷 한국어 (20)

```
Flow 로그인 + API 키 (BYOK)
이미지 일괄 생성 (100장 이상)
T2V (텍스트→영상 변환)
I2V (이미지→영상 변환)
원클릭 내보내기: CapCut / Premiere / Vrew
@ 레퍼런스 picker & 칩
95가지 이상 스타일 프리셋
씬별 미디어 선택
자동 태그 매칭
Ken Burns 애니메이션
TXT / CSV / SRT 가져오기
Claude Code용 MCP 서버 내장
AI 어시스턴트로 프롬프트 일괄 편집
커스텀 스킬 설치 및 워크플로우
외부 도구용 HTTP API (포트 3210)
자막 편집
무료 및 오픈 소스
AudioTimeline 멀티 트랙 미리보기
타임코드 오디오 자동 배치
Story Engine v2 (9-Wave 자동 파이프라인)
```

### 현재 라이브 목록 대비 변경

| 작업 | 기능 | 비고 |
|--------|---------|------|
| ➖ 제거 | `자동 저장 및 자동 재시도` | 일반 유틸 — @picker 슬롯 확보 |
| 🔁 이름교체 | `Google Flow AI 통합` → `Flow 로그인 + API 키 (BYOK)` | 듀얼 생성 모드 |
| 🔁 이름교체 | `CapCut 원클릭 내보내기` → `원클릭 내보내기: CapCut / Premiere / Vrew` | 멀티 에디터 |
| ➕ 추가 | `@ 레퍼런스 picker & 칩` | 프롬프트에서 @로 캐릭터·장면·스타일 선택, 인라인 칩 |
| 🩹 수정 | `Story Engine v2 (8-Wave …)` → `Story Engine v2 (9-Wave …)` | 실제 9-웨이브 |

> 참고: KO는 스타일 프리셋이 이미 "95가지 이상"으로 정확함 (EN은 "94+"). JSON `total_count: 95`.

<!-- JA / DE feature lists to be added on request -->

