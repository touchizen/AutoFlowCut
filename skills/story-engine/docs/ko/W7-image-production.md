# W7: 이미지 프로덕션 (ref + 씬 + QA)

이 문서는 story-engine 스킬의 W7(이미지 프로덕션) 단계 가이드입니다.

W7은 **이미지 생성**과 **이미지 검수**만 다룬다. 오디오 임포트 / CapCut export / 영상 생성은 W8(어셈블리)이 담당한다 (이전엔 W7에 모두 있었으나 책임 분리됨).

W7은 비용이 큰 단계 (Google Flow 크레딧 × 150~250 씬). W7이 끝나고 사용자 사인오프 게이트가 있으므로, 이미지 검수 후 어셈블리로 넘어갈지 사용자가 결정한다.

---

## 이미지 프로덕션

**W6(스토리보드 CSV)가 완성된 후에만 실행한다.**

### 7-0. 프로젝트 생성 (AutoFlowCut)

CSV를 로드하기 전에 AutoFlowCut 프로젝트를 먼저 생성해야 한다.

1. 기존 프로젝트 목록을 확인한다.
2. 유저에게 프로젝트명을 제안하고 확인받는다:
   - 제안 형식: `{채널명}_ep{번호}` (예: `무한야담_ep10`)
   - 기존 프로젝트가 있으면 그것을 사용할지도 함께 물어본다.
3. 유저가 확인하면 프로젝트를 생성한다.

```
AutoFlowCut MCP: app_list_projects → 기존 프로젝트 확인
유저에게 프로젝트명 확인: "AutoFlowCut 프로젝트명을 '{채널명}_ep{번호}'로 생성할까요?"
AutoFlowCut MCP: app_create_project({ name: "확인된_이름" }) → 프로젝트 생성
```

프로젝트 관리 도구:
- `app_list_projects` — 프로젝트 목록 조회
- `app_create_project` — 프로젝트 생성 (디렉토리 + project.json 자동 생성)
- `app_rename_project` — 프로젝트 이름 변경
- `app_delete_project` — 프로젝트 삭제 (되돌릴 수 없음)

**리뷰 (서브스텝 7-0)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(7-1)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 7-1. 레퍼런스 이미지 생성 (AutoFlowCut)

**사용자에게 현재 상황을 설명한다:**
- 현재 로드된 레퍼런스 수 (캐릭터/장소/스타일 각각)
- 이미지 생성 전 상태임을 알려준다
- 다음 단계 (스타일 선택 → 레퍼런스 이미지 생성 → 씬 이미지 생성) 흐름을 안내한다

**스타일 선택 (두 가지 경로):**

> **스타일을 물어볼 때 반드시 `list_styles`를 먼저 호출하여 실제 선택지 목록을 보여준다.**
> 텍스트로만 "한국 애니풍, 수묵화풍..." 나열하지 말고, MCP에서 가져온 실제 프리셋 목록을 표로 보여줘야 한다.
> 또한 앱에서 직접 찾는 방법도 안내한다: **AutoFlowCut 앱 → Ref 탭 → 일괄 생성 → 스타일 피커에서 카테고리별 스타일 확인 가능**

**경로 A — AI가 진행:** 사용자에게 스타일을 물어보고, 답변 받으면 `styleId`로 자동 생성
```
AutoFlowCut MCP: list_styles → 스타일 목록 조회 → 사용자에게 표로 보여주기
사용자에게 질문: "어떤 스타일로 할까? 예: 한국 애니, 지브리, 사극, 수묵화 등"
앱에서도 확인 가능: "AutoFlowCut 앱 → Ref → 일괄 생성 버튼 누르면 스타일 피커에서 미리보기 가능해"
사용자 답변 → 해당 preset ID 매핑 (예: "한국 애니" → "korean-ani")
AutoFlowCut MCP: app_start_ref_batch({ styleId: "korean-ani" }) → 스타일 자동 선택 + 레퍼런스 일괄 생성
```
- `app_start_ref_batch`와 `app_start_scene_batch` 모두 `styleId` 파라미터를 지원한다
- styleId를 전달하면 앱의 스타일 피커 UI에도 자동 반영된다
- styleId 없이 호출하면 현재 앱에서 선택된 스타일을 사용한다

**styleId 결정 후 (필수): `references.csv`에 `type: style` 행 추가**

W6는 character/scene만 작성하고 type:style 행은 W7의 단일 책임이다 (W6 doc 6-1 참조).
사용자가 styleId를 확정한 직후, 그에 맞는 영문 프롬프트로 type:style 행을 추가/업데이트한다.

```
# 예: styleId="korean-ani"
AutoFlowCut MCP: update_reference_prompt({
  name: "korean-ani",
  type: "style",
  prompt: "Korean traditional animation style, soft pastel palette, gentle linework, atmospheric lighting, no modern elements"
})
```

이 행이 references.csv에 들어가야 캐릭터/씬 프롬프트에 스타일 일관성이 적용된다. 누락 시 이미지 스타일 무작위.

**경로 B — 사용자가 앱에서 직접 진행:** 사용자가 앱에서 Ref → 일괄생성 → 스타일 선택 → 생성시작을 직접 누른 경우
```
AutoFlowCut MCP: app_batch_status → 상태 조회
→ 이미 생성 중이면: "이미 생성이 진행 중이네! 완료될 때까지 기다릴게."
→ 이미 완료되었으면: "생성 완료됐네! 다음 단계로 넘어갈게."
```

**공통:**
```
AutoFlowCut MCP: load_csv → references.csv 로드
사용자에게 상황 설명: "레퍼런스 {N}개 로드 완료 (캐릭터 {n1}, 장소 {n2}, 스타일 {n3}). 이미지 생성 전이야."
AutoFlowCut MCP: app_wait_batch → 생성 완료 대기
```

**이미지 생성 방식 (중요):**

| 방식 | 사용법 | 비고 |
|------|--------|------|
| **배치 (필수)** | AI: `app_start_ref_batch` / `app_start_scene_batch` / 앱: "생성시작" 버튼 | 앱 내부에서 순차 처리 + 딜레이 자동 관리 |
| **개별 생성** | `app_generate_reference(index)` / `app_generate_scene(sceneId)` | 1건씩, **반드시 7~15초 간격** 필요 |

- **반드시 배치 명령어로 생성한다** — 배치는 앱이 내부적으로 순차 처리 + 딜레이를 자동 관리하므로 안전하고 효율적
- 개별 생성은 7~15초 대기가 필요하므로 대량 생성에는 비효율적 → 배치 후 실패 건 재시도 용도로 사용
- **개별 생성을 동시에 여러 건 병렬 호출하면 전부 에러 발생** — 절대 병렬 호출하지 않는다

**레퍼런스 배치 생성 흐름:**
```
1. 스타일 선택 완료 확인 (list_styles → 사용자에게 물어보기 또는 앱에서 직접 선택)
2. 배치 시작:
   - AI가 진행: AutoFlowCut MCP: app_start_ref_batch({ styleId: "korean-ani" }) → 스타일 선택 + 일괄 생성
   - 사용자가 직접: 앱에서 "Ref" → "일괄생성" → 스타일 선택 → "생성시작" 클릭
3. AutoFlowCut MCP: app_batch_status → 생성 상태 확인 (이미 진행 중이면 "이미 생성 중이네!")
4. AutoFlowCut MCP: app_wait_batch → 생성 완료 대기
```

**리뷰 (서브스텝 7-1)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(7-2)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 7-2. 씬별 이미지 생성 (AutoFlowCut)

```
AutoFlowCut MCP: load_csv({ csv_path, image_dir }) → 씬 CSV 로드 (앱에 자동 전달)
AutoFlowCut MCP: app_get_scenes → 앱에 씬이 로드되었는지 확인
AutoFlowCut MCP: app_start_scene_batch({ styleId: "korean-ani" }) → 배치 생성 시작
  (또는 사용자가 앱에서 직접 "생성시작" 클릭)
AutoFlowCut MCP: app_batch_status → 생성 상태 확인
AutoFlowCut MCP: app_wait_batch → 생성 완료 대기
```

- `load_csv`는 씬 데이터를 앱에 자동 전달한다 (`update-scenes` IPC)
- 로드 후 반드시 `app_get_scenes`로 앱에 씬이 들어갔는지 확인한다
- 생성 후 `list_problem_scenes`로 문제 씬을 확인하고 프롬프트를 수정한다

**리뷰 (서브스텝 7-2)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(7-2a)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 7-2a. 에러 씬 수정 및 재생성

배치 완료 후 에러가 있으면 반드시 수행한다.

```
1. app_batch_status → error 수 확인
2. HTTP로 에러 씬 프롬프트 확인 (curl http://localhost:3210/api/scenes | 에러 필터)
3. 에러 원인 분석 (Google 정책 위반이 대부분)
   - 폭력/감금/위협 묘사 → 순화 (struggling → standing firm, pushed → alone in)
   - 미성년자 관련 → 성인 캐릭터로 변경 또는 간접 묘사
4. app_update_scene({ index, fields: { prompt: "순화된 프롬프트", status: "pending", error: "" } })
5. app_start_scene_batch({ styleId }) → pending 상태인 씬만 재생성
6. 에러 0이 될 때까지 반복
```

### AutoFlowCut HTTP API (localhost:3210)

MCP 도구 외에 HTTP API를 직접 사용할 수 있다. 특히 대량 데이터 조회/필터링에 유용하다.

**씬 데이터 조회:**
```bash
# 전체 씬 목록 (JSON 배열, 0-indexed)
curl -s http://localhost:3210/api/scenes

# 특정 씬 필터링 (python으로 파싱)
curl -s http://localhost:3210/api/scenes | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i, s in enumerate(data):
    if s.get('status') == 'error':
        print(f'Scene {i+1}: {s[\"prompt\"][:100]}')
"

# 에러 씬만 추출
curl -s http://localhost:3210/api/scenes | python3 -c "
import json, sys
data = json.load(sys.stdin)
errors = [(i+1, s) for i, s in enumerate(data) if s.get('status') == 'error']
print(f'에러 씬 {len(errors)}개')
for num, s in errors:
    print(f'  Scene {num}: {s[\"prompt\"][:80]}')
"
```

**씬 데이터 필드:**
- `prompt` — 영문 이미지 생성 프롬프트
- `prompt_ko` — 한국어 프롬프트
- `subtitle` — 자막 텍스트
- `characters` — 등장인물
- `status` — `pending` | `generating` | `done` | `error`
- `imagePath` — 생성된 이미지 경로
- `id` — 씬 고유 ID

**CSV 내보내기 (앱 데이터 → CSV 파일):**
```bash
curl -s http://localhost:3210/api/scenes | python3 -c "
import json, sys, csv, io
data = json.load(sys.stdin)
fields = ['prompt', 'prompt_ko', 'subtitle', 'characters', 'scene_tag', 'style_tag', 'shot_type', 'duration', 'start_time', 'end_time', 'parent_scene']
output = io.StringIO()
writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
writer.writeheader()
for row in data:
    writer.writerow(row)
with open('EXPORT_PATH.csv', 'w', encoding='utf-8') as f:
    f.write(output.getvalue())
print(f'CSV saved: {len(data)} scenes')
"
```

**프롬프트 수정 후 반드시 CSV도 업데이트한다:**
1. MCP `app_update_scene`으로 앱 데이터 수정
2. 위 CSV 내보내기 스크립트로 CSV 파일 동기화
3. CSV 경로: `{프로젝트 디렉토리}/ep{번호}_scenes.csv`

**리뷰 (서브스텝 7-2a)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 다음 서브스텝(7-2b)으로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 7-2b. 전체 이미지 QA (레퍼런스 + 씬)

모든 이미지 생성 완료 후, 대본/씬/프롬프트 대비 품질 검수를 수행한다.

**진행 상황 알림 (필수):** 서브에이전트는 QA 진행을 앱에 알려야 한다. 상단 스트립 배너가 업데이트된다.
- 각 라운드 시작 시: `mcp__autoflowcut__app_notify_qa({ kind, state: 'start', total, round })`
- 10개 확인마다: `mcp__autoflowcut__app_notify_qa({ kind, state: 'progress', current, total, round, issues })`
- 라운드 종료 시: `mcp__autoflowcut__app_notify_qa({ kind, state: 'done', current: total, total, round, issues })`
- `kind`는 레퍼런스 QA에서는 `'ref'`, 씬 QA에서는 `'scene'`.

**레퍼런스 QA:**
```
1. app_get_references → 전체 레퍼런스 목록 확인
2. 각 레퍼런스 이미지가 대본의 캐릭터/장소 설정과 일치하는지 확인
   - 캐릭터: 나이, 성별, 복장, 인상 (예: "14세 소녀"인데 성인으로 그려졌는가?)
   - 장소: 시대, 분위기 (예: "초가집"인데 기와집으로 그려졌는가?)
3. 불일치 발견 시 → 프롬프트 수정 → app_generate_reference로 개별 재생성
```

**씬 전수검사 (최대 5라운드):**

반드시 전체 이미지를 눈으로 확인한다. 샘플링 불가 — 전수검사 필수.

```
1. 이미지 경로 확인:
   curl http://localhost:3210/api/scenes → imagePath 목록
   Read 도구로 이미지 파일을 직접 열어 확인 (10장씩 배치)

2. **검수 체크리스트 — batch QA × 2 parallel** (8 항목, 4-4 그룹핑)

   8 항목을 한 subagent에 던지면 모든 씬의 모든 항목을 정성껏 보지 못함. **2 그룹 병렬** (시각/콘텐츠).

   각 그룹의 review 파일: `_story_source/07_image_review_group1.md`, `_group2.md`.

   **[Group 1 — Visual accuracy] (4 항목, 시각적 사실성)**
   - 이미지 누락: imagePath가 없거나 파일이 존재하지 않음
   - 스타일 불일치: 실사 이미지가 섞여 있음 (애니/지정 스타일이어야 함)
   - 배경 불일치: 실내/실외, 낮/밤이 대본과 다름
   - 시대 불일치: 현대적 요소 (유리창, 전등 등)가 섞임

   **[Group 2 — Content fidelity] (4 항목, 대본 콘텐츠 일치)**
   - 캐릭터 복장 일관성: 같은 캐릭터인데 복장이 다름
   - 인물 수 불일치: 대본에 2명인데 3명이 있거나, 혼자여야 하는데 둘
   - 감정 불일치: 슬픈 장면인데 웃고 있거나, 긴장 장면인데 평온
   - 소품 불일치: 장부/주판/편지 등 핵심 소품 누락

   **오케스트레이터는 2 subagent 병렬 호출** (한 메시지에 2개 `Agent` 호출):
   - 각 그룹은 자기 review 파일만 씀
   - STATE.md / W_progress.json 안 건드림 (오케스트레이터가 합산)
   - 모두 0 이슈 → 7-2b 통과 → 7-3 사용자 게이트로 진입
   - **이미지 재생성은 sequential** — 7-2a 별도 처리. 병렬 QA는 read-only로만

3. 문제 발견 시 테이블로 정리:
   | 씬 | 문제 유형 | 상세 | 수정 방향 |
   |---|---------|-----|---------|
   | 9 | 누락 | 이미지 파일 없음 | 재생성 |
   | 10 | 복장 | 소은 혼례복급 화려함 | 소박한 흰저고리로 수정 |

4. 사용자에게 문제 목록 보고 → 승인 받은 후:
   - **디스크에서 이미지 파일을 직접 삭제(rm)하지 않는다** — pending으로 바꾸면 앱이 기존 이미지를 history/로 자동 이동
   - app_update_scene({ index, fields: { prompt: "수정 프롬프트", status: "pending" } })
   - app_start_scene_batch({ styleId }) → pending 씬만 재생성
   - **batch_update_prompts(CSV 메모리)만 수정하면 앱에 반영 안 됨** — 반드시 app_update_scene으로 앱에 프롬프트 전달

5. 재생성 완료 후 해당 씬만 재확인 (다시 Read로 이미지 열기)
6. 라운드 반복 (최대 5회)
7. 5라운드 후에도 남은 문제 → 사용자에게 목록 전달, 수동 처리 안내
```

**레퍼런스 전수검사도 동일 (최대 5라운드):**
```
1. app_get_references → 레퍼런스 이미지 경로 확인
2. Read 도구로 전체 레퍼런스 이미지 확인
3. 동일한 체크리스트 적용 (캐릭터 설정, 장소 분위기 등)
4. 불일치 시 프롬프트 수정 → app_generate_reference로 개별 재생성
```

QA는 반드시 이미지를 눈으로 확인한다 (Read 도구로 이미지 파일 열기). 메타데이터만으로 판단하지 않는다.
캐릭터 복장 기준은 대본의 캐릭터 설정(references.csv)에서 가져온다.

**리뷰 (서브스텝 7-2b)** — 서브에이전트 자가검토 → 이슈 목록 → 수정. 최대 5회. 0 이슈 시 7-3 사용자 게이트로 즉시 진행. 5회 초과 시 사용자에게 에스컬레이션.

### 7-3. 🛑 사용자 사인오프 게이트 (W8 어셈블리 전 필수)

7-0 ~ 7-2b까지 통과하면 이미지 프로덕션 끝. **여기서 멈추고 사용자에게 확인받는다.**

```
🛑 AskUserQuestion: "이미지 검수 끝났어요. 어셈블리(W8)로 진행할까요?"
   - "Yes — W8 어셈블리 시작" → W8로 진행
   - "이미지 더 다시 생성하고 싶어" → 7-2a/7-2b 다시 (재생성, 재 QA)
   - "잠시 멈추고 직접 검토" → 파이프라인 일시정지, /story-next로 재개
```

**이 게이트가 있는 이유:**
- 이미지 생성은 비싼 단계 (Google Flow 크레딧). W8(어셈블리)은 무료. 비용 격차 → wave 경계.
- 이미지가 만족스럽지 않으면 어셈블리하기 전에 다시 만드는 게 맞음.
- 사용자가 직접 보고 결정하는 자연스러운 break point.

게이트 통과 후 W8 어셈블리(`docs/{lang}/W8-assembly.md`)로 넘긴다.

**리뷰 (서브스텝 7-3)** — 별도 리뷰 루프 없음 (사용자 사인오프가 곧 review).

---

## Wave 리뷰 요약
위 각 서브스텝(7-0 ~ 7-2b)은 최대 5회 리뷰(0 이슈 시 즉시 진행)를 강제한다. 마지막 서브스텝(7-2b 이미지 QA, batch × 2 parallel)의 리뷰가 통과하면 7-3 사용자 게이트로 진입. 사용자 승인 시 Wave 7 완료, W8로 넘김.


