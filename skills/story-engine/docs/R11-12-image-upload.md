# R11~R12: 이미지/영상 생성 + 업로드

이 문서는 story-engine 스킬의 R11(이미지/영상 생성), R12(업로드 정보) 단계 상세 가이드입니다.

---

### 11단계: 이미지/영상 생성 ⚠️ 유저 확인 필요

**10단계(스토리보드 CSV)가 완성된 후에만 실행한다.**

#### 11-0. 프로젝트 생성 (Flow2CapCut)

CSV를 로드하기 전에 Flow2CapCut 프로젝트를 먼저 생성해야 한다.

1. 기존 프로젝트 목록을 확인한다.
2. 유저에게 프로젝트명을 제안하고 확인받는다:
   - 제안 형식: `{채널명}_ep{번호}` (예: `무한야담_ep10`)
   - 기존 프로젝트가 있으면 그것을 사용할지도 함께 물어본다.
3. 유저가 확인하면 프로젝트를 생성한다.

```
flow2capcut MCP: app_list_projects → 기존 프로젝트 확인
⚠️ 유저에게 프로젝트명 확인: "Flow2CapCut 프로젝트명을 '{채널명}_ep{번호}'로 생성할까요?"
flow2capcut MCP: app_create_project({ name: "확인된_이름" }) → 프로젝트 생성
```

프로젝트 관리 도구:
- `app_list_projects` — 프로젝트 목록 조회
- `app_create_project` — 프로젝트 생성 (디렉토리 + project.json 자동 생성)
- `app_rename_project` — 프로젝트 이름 변경
- `app_delete_project` — 프로젝트 삭제 (되돌릴 수 없음)

#### 11-1. 레퍼런스 이미지 생성 (Flow2CapCut)

**⚠️ 사용자에게 현재 상황을 설명한다:**
- 현재 로드된 레퍼런스 수 (캐릭터/장소/스타일 각각)
- 이미지 생성 전 상태임을 알려준다
- 다음 단계 (스타일 선택 → 레퍼런스 이미지 생성 → 씬 이미지 생성) 흐름을 안내한다

**⚠️ 스타일 선택 (두 가지 경로):**

> **🔴 스타일을 물어볼 때 반드시 `list_styles`를 먼저 호출하여 실제 선택지 목록을 보여준다.**
> 텍스트로만 "한국 애니풍, 수묵화풍..." 나열하지 말고, MCP에서 가져온 실제 프리셋 목록을 표로 보여줘야 한다.
> 또한 앱에서 직접 찾는 방법도 안내한다: **Flow2CapCut 앱 → Ref 탭 → 일괄 생성 → 스타일 피커에서 카테고리별 스타일 확인 가능**

**경로 A — AI가 진행:** 사용자에게 스타일을 물어보고, 답변 받으면 `styleId`로 자동 생성
```
flow2capcut MCP: list_styles → 스타일 목록 조회 → 사용자에게 표로 보여주기
⚠️ 사용자에게 질문: "어떤 스타일로 할까? 예: 한국 애니, 지브리, 사극, 수묵화 등"
💡 앱에서도 확인 가능: "Flow2CapCut 앱 → Ref → 일괄 생성 버튼 누르면 스타일 피커에서 미리보기 가능해"
사용자 답변 → 해당 preset ID 매핑 (예: "한국 애니" → "korean-ani")
flow2capcut MCP: app_start_ref_batch({ styleId: "korean-ani" }) → 스타일 자동 선택 + 레퍼런스 일괄 생성
```
- `app_start_ref_batch`와 `app_start_scene_batch` 모두 `styleId` 파라미터를 지원한다
- styleId를 전달하면 앱의 스타일 피커 UI에도 자동 반영된다
- styleId 없이 호출하면 현재 앱에서 선택된 스타일을 사용한다

**경로 B — 사용자가 앱에서 직접 진행:** 사용자가 앱에서 Ref → 일괄생성 → 스타일 선택 → 생성시작을 직접 누른 경우
```
flow2capcut MCP: app_batch_status → 상태 조회
→ 이미 생성 중이면: "이미 생성이 진행 중이네! 완료될 때까지 기다릴게."
→ 이미 완료되었으면: "생성 완료됐네! 다음 단계로 넘어갈게."
```

**공통:**
```
flow2capcut MCP: load_csv → references.csv 로드
⚠️ 사용자에게 상황 설명: "레퍼런스 {N}개 로드 완료 (캐릭터 {n1}, 장소 {n2}, 스타일 {n3}). 이미지 생성 전이야."
flow2capcut MCP: app_wait_batch → 생성 완료 대기
```

**🔴 이미지 생성 방식 (중요):**

| 방식 | 사용법 | 비고 |
|------|--------|------|
| **배치 (필수)** | AI: `app_start_ref_batch` / `app_start_scene_batch` / 앱: "생성시작" 버튼 | 앱 내부에서 순차 처리 + 딜레이 자동 관리 |
| **개별 생성** | `app_generate_reference(index)` / `app_generate_scene(sceneId)` | 1건씩, **반드시 7~15초 간격** 필요 |

- **🔴 반드시 배치 명령어로 생성한다** — 배치는 앱이 내부적으로 순차 처리 + 딜레이를 자동 관리하므로 안전하고 효율적
- 개별 생성은 7~15초 대기가 필요하므로 대량 생성에는 비효율적 → 배치 후 실패 건 재시도 용도로 사용
- **❌ 개별 생성을 동시에 여러 건 병렬 호출하면 전부 에러 발생** — 절대 병렬 호출하지 않는다

**레퍼런스 배치 생성 흐름:**
```
1. 스타일 선택 완료 확인 (list_styles → 사용자에게 물어보기 또는 앱에서 직접 선택)
2. 배치 시작:
   - AI가 진행: flow2capcut MCP: app_start_ref_batch({ styleId: "korean-ani" }) → 스타일 선택 + 일괄 생성
   - 사용자가 직접: 앱에서 "Ref" → "일괄생성" → 스타일 선택 → "생성시작" 클릭
3. flow2capcut MCP: app_batch_status → 생성 상태 확인 (이미 진행 중이면 "이미 생성 중이네!")
4. flow2capcut MCP: app_wait_batch → 생성 완료 대기
```

#### 11-2. 씬별 이미지 생성 (Flow2CapCut)

```
flow2capcut MCP: load_csv({ csv_path, image_dir }) → 씬 CSV 로드 (앱에 자동 전달)
flow2capcut MCP: app_get_scenes → 앱에 씬이 로드되었는지 확인
flow2capcut MCP: app_start_scene_batch({ styleId: "korean-ani" }) → 배치 생성 시작
  (또는 사용자가 앱에서 직접 "생성시작" 클릭)
flow2capcut MCP: app_batch_status → 생성 상태 확인
flow2capcut MCP: app_wait_batch → 생성 완료 대기
```

- `load_csv`는 씬 데이터를 앱에 자동 전달한다 (`update-scenes` IPC)
- 로드 후 반드시 `app_get_scenes`로 앱에 씬이 들어갔는지 확인한다
- 생성 후 `list_problem_scenes`로 문제 씬을 확인하고 프롬프트를 수정한다

#### 11-2a. 에러 씬 수정 및 재생성

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

#### Flow2CapCut HTTP API (localhost:3210)

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

**⚠️ 프롬프트 수정 후 반드시 CSV도 업데이트한다:**
1. MCP `app_update_scene`으로 앱 데이터 수정
2. 위 CSV 내보내기 스크립트로 CSV 파일 동기화
3. CSV 경로: `{프로젝트 디렉토리}/ep{번호}_scenes.csv`

#### 11-2b. 전체 이미지 QA (레퍼런스 + 씬)

모든 이미지 생성 완료 후, 대본/씬/프롬프트 대비 품질 검수를 수행한다.

**레퍼런스 QA:**
```
1. app_get_references → 전체 레퍼런스 목록 확인
2. 각 레퍼런스 이미지가 대본의 캐릭터/장소 설정과 일치하는지 확인
   - 캐릭터: 나이, 성별, 복장, 인상 (예: "14세 소녀"인데 성인으로 그려졌는가?)
   - 장소: 시대, 분위기 (예: "초가집"인데 기와집으로 그려졌는가?)
3. 불일치 발견 시 → 프롬프트 수정 → app_generate_reference로 개별 재생성
```

**씬 전수검사 (최대 5라운드):**

반드시 115개 전체 이미지를 눈으로 확인한다. 샘플링 불가 — 전수검사 필수.

```
1. 이미지 경로 확인:
   curl http://localhost:3210/api/scenes → imagePath 목록
   Read 도구로 이미지 파일을 직접 열어 확인 (10장씩 배치)

2. 검수 체크리스트 (모든 씬에 적용):
   □ 이미지 누락: imagePath가 없거나 파일이 존재하지 않음
   □ 스타일 불일치: 실사 이미지가 섞여 있음 (애니 스타일이어야 함)
   □ 캐릭터 복장 일관성: 같은 캐릭터인데 복장이 다름
     - 소은: 흰 저고리 + 파란 치마 (소박한 며느리 차림)
     - 곽주사: 갓 + 녹색/갈색 도포
     - 최씨: 어두운 색 한복 (시어머니)
     - 복돌이: 낡은 옷 + 머리띠 (하인)
   □ 인물 수 불일치: 대본에 2명인데 3명이 있거나, 혼자여야 하는데 둘
   □ 감정 불일치: 슬픈 장면인데 웃고 있거나, 긴장 장면인데 평온
   □ 배경 불일치: 실내/실외, 낮/밤이 대본과 다름
   □ 소품 불일치: 장부/주판/편지 등 핵심 소품 누락
   □ 시대 불일치: 현대적 요소 (유리창, 전등 등)가 섞임

3. 문제 발견 시 테이블로 정리:
   | 씬 | 문제 유형 | 상세 | 수정 방향 |
   |---|---------|-----|---------|
   | 9 | 누락 | 이미지 파일 없음 | 재생성 |
   | 10 | 복장 | 소은 혼례복급 화려함 | 소박한 흰저고리로 수정 |

4. 사용자에게 문제 목록 보고 → 승인 받은 후:
   - 🔴 **디스크에서 이미지 파일을 직접 삭제(rm)하지 않는다** — pending으로 바꾸면 앱이 기존 이미지를 history/로 자동 이동
   - app_update_scene({ index, fields: { prompt: "수정 프롬프트", status: "pending" } })
   - app_start_scene_batch({ styleId }) → pending 씬만 재생성
   - 🔴 **batch_update_prompts(CSV 메모리)만 수정하면 앱에 반영 안 됨** — 반드시 app_update_scene으로 앱에 프롬프트 전달

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

⚠️ QA는 반드시 이미지를 눈으로 확인한다 (Read 도구로 이미지 파일 열기). 메타데이터만으로 판단하지 않는다.
⚠️ 캐릭터 복장 기준은 대본의 캐릭터 설정(references.csv)에서 가져온다.

#### 11-2c. 오디오 임포트 (나레이션 + SFX)

이미지 QA 완료 후, 9단계에서 생성한 오디오 파일을 Flow2CapCut에 임포트한다.
오디오 임포트 후 CapCut 내보내기 시 나레이션/SFX가 타임라인에 자동 배치된다.

**임포트 대상 (에피소드 폴더):**
```
ep{번호}/
├── media/
│   ├── final_full.mp3       ← 전체 나레이션 오디오
│   ├── final_full.srt       ← 전체 자막
│   └── sfx/                 ← SFX (파일명 타임코드로 자동 배치)
│       ├── 01_주판_구슬_0030.mp3
│       └── ...
└── voice_samples/           ← 인물별 대사 TTS (선택)
    ├── 소은/
    ├── 곽주사/
    └── sfx/                 ← 카테고리별 SFX 원본
```

**HTTP API로 임포트:**
```bash
curl -s -X POST http://localhost:3210/api/audio-import \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/Users/tuxxon/premiere-workspace/무한야담/story/ep{번호}"}'
```

**임포트 후 확인:**
```bash
# 오디오 리뷰 상태 조회
curl -s http://localhost:3210/api/audio-reviews

# 오디오 리뷰 새로고침 (폴더 재스캔 + 자동 언플래그)
curl -s -X POST http://localhost:3210/api/audio-refresh \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/Users/tuxxon/premiere-workspace/무한야담/story/ep{번호}"}'
```

**MCP 도구로 오디오 검수:**
- `list_audio_reviews({ folder_path })` — 부적합 마크 목록 조회
- `update_audio_review({ folder_path, relative_path, action: "flag"|"unflag", reason })` — 마크 추가/해제

**부적합 오디오 처리:**
1. 앱의 Audio 탭에서 각 파일을 재생하며 검수
2. 부적합 파일 발견 시 flag 마크 → 재생성 후 unflag
3. `.audio_review.json`으로 상태 추적

#### 11-2d. CapCut 내보내기

이미지 QA + 오디오 임포트가 완료된 후, CapCut 프로젝트로 내보낸다.
씬 이미지 + 나레이션 오디오 + SRT 자막 + SFX가 타임라인에 자동 배치된다.

**HTTP API로 내보내기:**
```bash
curl -s -X POST http://localhost:3210/api/export-capcut \
  -H "Content-Type: application/json" \
  -d '{}'
```

**또는 앱에서 직접:**
- F→V 탭 또는 내보내기 버튼 클릭

**내보내기 확인:**
- CapCut에서 프로젝트 열어 타임라인 확인
- 이미지 배치, 오디오 싱크, 자막 위치 점검
- 문제 있으면 앱에서 수정 후 재내보내기

#### 11-3. 영상 생성 (선택사항)

씬 이미지에 모션을 넣어 비디오 클립으로 변환한다 (Image-to-Video, Google Flow API).
**선택사항이며, 비용이 발생하므로 반드시 유저에게 확인 후 실행한다.**
CapCut에서 직접 편집하는 경우 이 단계를 건너뛸 수 있다.

```
⚠️ "씬별 영상 생성을 시작할까요? 약 {N}개 씬, 예상 비용: ..."
```

- 유저가 승인하면 Flow2CapCut의 비디오 모드로 생성
- 유저가 직접 하겠다고 하면 넘긴다
- export도 마찬가지로 유저 확인 후 진행

---

### 12단계: 유튜브 업로드 정보

#### 제목 작성 공식

- `[자극적 상황] + [궁금증 유발 클로저]`
- 50~70자 + `| 야담 옛날이야기 오디오북 수면동화 전설 민담`
- 예: "산에 버려진 관상 보는 천재 아이, 조선의 운명을 바꾸다"

#### 출력 형식

```json
{
  "youtube": {
    "enabled": true,
    "title": "제목 | 야담 옛날이야기 오디오북 전설 민담",
    "description": "SEO 최적화된 설명문 (첫 200자에 키워드)",
    "tags": ["야담", "민담", "설화", "전설", "옛날이야기", "오디오북", "수면동화", "조선시대", "권선징악", "인과응보", "조선야담", "옛이야기", "한국전설"],
    "hashTags": true,
    "privacy": "private",
    "categoryId": "24",
    "defaultLanguage": "ko",
    "defaultAudioLanguage": "ko",
    "schedule": { "enabled": false }
  }
}
```

**업로드 제목 후보 3개**, **설명란**, **태그 20개 이내**, **썸네일 문구**, **해시태그 15개 이내**를 함께 제공한다.

**출력 파일**: `11_업로드정보.json`

---

