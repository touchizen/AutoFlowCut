---
name: story-engine
description: "YouTube story channel script writing skill with 8-wave automated pipeline. Supports two genres: (1) yadam — Korean historical tales (야담, 민담, 설화, 조선시대) in Korean, (2) dark-history — Western dark history, medieval mystery, gothic tales, true crime, folklore in English. Trigger on: 'write a script', 'new episode', 'create storyboard', 'start ep5', '야담 대본 써줘', '새 에피소드 만들어줘', '스토리보드 작성해줘', 'ep11 시작하자', 'rewrite', 'redesign', '리라이팅', '리디자인'. Auto-detects genre by user language (Korean→yadam, English→dark-history) or explicit genre flag."
---

# Story Engine v2

8-Wave 자동 파이프라인으로 YouTube 스토리 채널 대본을 작성하고, TTS/SFX 생성, 이미지 생성, CapCut 내보내기까지 자동화한다.

## 스킬 구조

| 스킬 | 역할 | 트리거 |
|------|------|--------|
| `/story-new` | 에피소드 초기화 + 주제 논의 | "새 에피소드", "start ep5" |
| `/story-execute` | W1~W8 자동 파이프라인 | "파이프라인 실행", "execute" |
| `/story-next` | 중단 후 재개 | "이어서 해줘", "continue" |

## 8-Wave 파이프라인

| Wave | 내용 | 리뷰 |
|------|------|------|
| **W1** | 스토리 설계 (신규/리라이팅 분기) | — |
| **W2** | 시놉시스 + 프리플라이트 | 최대 5회 |
| **W3** | 대본 작성 + 검토 | 최대 5회 (목표 9.5점) |
| | 🛑 **사용자 확인** | |
| **W4** | 프로덕션 추출 + 검증 | 최대 5회 |
| **W5** | TTS/SFX + 타임코드 검증 | 리뷰 |
| **W6** | 스토리보드 CSV + 검토 | 최대 5회 |
| **W7** | 이미지/영상 + QA + CapCut | 최대 5회 |
| **W8** | 업로드 정보 | — |

## 장르

| 입력 언어 | 장르 | 메타프롬프트 |
|-----------|------|-------------|
| 한국어 | **yadam** (야담) | `meta-prompts/yadam/` |
| English | **dark-history** | `meta-prompts/dark-history/` |

`--genre yadam` 또는 `--genre dark-history`로 오버라이드 가능.

## 핵심 원칙

> **궁금증 + 기대감 = 몰입감. 몰입감이 최상위 성공 지표.**
>
> - W1~W2: 다중 용의자/가능성 — 시청자 확신 불가 — 궁금증 유지
> - W3 전반: 거짓 해결 / 반전 — 기대감 극대화
> - W3 후반 (ch.16~17): 진실 폭로 — 몰입감 최고조
> - **진범/진실이 전 중반(15챕터) 이전에 확정되면 구조적 실패**

## 상태 관리

| 파일 | 역할 |
|------|------|
| `STATE.md` | 메인 — 현재 Wave, 완료 단계, 결정사항 |
| `W{N}_SUMMARY.md` | Wave별 결과, 리뷰 라운드, 이슈 |
| `W_progress.json` | 사이드 로그 — 앱/외부 도구용 JSON |

## 참조 문서

| Wave | 문서 |
|------|------|
| W1 | `docs/W1-story-design.md` |
| W2 | `docs/W2-synopsis.md` + `meta-prompts/{genre}/synopsis_guidelines.md` + `meta-prompts/{genre}/preflight.md` |
| W3 | `docs/W3-writing.md` + `meta-prompts/{genre}/screenplay_guidelines.md` + narrative + suspense |
| W4 | `docs/W4-production.md` |
| W5 | `docs/W5-tts-sfx.md` |
| W6 | `docs/W6-storyboard.md` |
| W7 | `docs/W7-image-upload.md` |
| W8 | `docs/W8-upload-info.md` |

## AutoFlowCut MCP 도구

- 프로젝트: `app_list_projects`, `app_create_project`
- CSV: `load_csv`, `list_scenes`, `update_prompt`, `save_csv`
- 레퍼런스: `list_references`, `update_reference_prompt`
- 이미지: `app_start_ref_batch`, `app_start_scene_batch`, `app_wait_batch`
- 스키마: `get_schema({ type: "scenes" | "references" | "prompt-image" })`
- 스타일: `list_styles`

## Red Flags

| 생각 | 현실 |
|------|------|
| "리뷰 안 해도 되겠지" | 리뷰 루프는 필수 |
| "이미지로 바로 가자" | Wave 순서 엄수 |
| "CSV 맞을 거야" | subagent 리뷰가 있는 이유 |
| "스킬 내용 기억나" | 매번 docs 읽기 |
| "간단하네" | 간단한 건 복잡해진다. 먼저 확인 |
| "빨리 하자" | 빠른 것보다 정확한 것 |
