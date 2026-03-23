---
name: story-engine
description: "YouTube story channel script writing skill with a 12-step workflow. Supports two genres: (1) yadam — Korean historical tales (야담, 민담, 설화, 조선시대) in Korean, (2) dark-history — Western dark history, medieval mystery, gothic tales, true crime, folklore in English. Trigger on: 'write a script', 'new episode', 'create storyboard', 'start ep5', '야담 대본 써줘', '새 에피소드 만들어줘', '스토리보드 작성해줘', 'ep11 시작하자', 'rewrite', 'redesign', '리라이팅', '리디자인'. Auto-detects genre by user language (Korean→yadam, English→dark-history) or explicit genre flag."
---

# Story Engine v1.0

Write YouTube story channel scripts using a **12-step workflow** with full production pipeline (TTS/SFX/image/video).
Supports **2 genres** with language-specific meta-prompts.

---

## Genre Selection

### Auto-Detection (Default)
| User Language | Genre | Meta-Prompts |
|--------------|-------|-------------|
| 한국어 (Korean) | **yadam** | `meta-prompts/yadam/` |
| English | **dark-history** | `meta-prompts/dark-history/` |

### Explicit Selection
Override auto-detection with a genre flag:
```
--genre yadam          → Korean historical tales (야담)
--genre dark-history   → Western dark history / medieval mystery
```

### Usage Examples

#### Korean (야담 — auto-detected)
```
"야담 대본 써줘"                    → yadam genre
"ep11 시작하자"                    → yadam genre
"조선시대 궁중 미스터리 대본 만들어줘"  → yadam genre
"레퍼런스 영상 분석해줘"              → yadam genre
```

#### English (dark-history — auto-detected)
```
"Write a script about the Salem witch trials"     → dark-history genre
"New episode about Henry VIII"                     → dark-history genre
"Create a medieval mystery screenplay"             → dark-history genre
"Start ep1 - Jack the Ripper"                      → dark-history genre
```

#### Explicit Genre Override
```
"Write a yadam script in English"                  → --genre yadam (English output, Korean story structure)
"Dark history 스타일로 대본 써줘"                     → --genre dark-history (Korean output, Western story structure)
```

---

## Genre Details

### yadam (야담) — Korean Historical Tales
| Setting | Examples |
|---------|---------|
| 조선시대 궁중 | 궁중 암투, 왕위 계승, 사화 |
| 민간 미스터리 | 사또 vs 백성, 원혼, 복수극 |
| 민담/설화 | 도깨비, 구미호, 전설 |
| 기담/괴담 | 귀신, 저주, 초자연 |
| 의적/영웅담 | 홍길동, 임꺽정 스타일 |

**Reference channel**: 무한야담 (YouTube)
**Script language**: Korean
**Meta-prompts**: `meta-prompts/yadam/` (5 files, all Korean)

### dark-history — Western Historical Tales
| Setting | Examples |
|---------|---------|
| Dark History | Shocking true events, hidden scandals |
| Medieval Mystery | Knights, court intrigue, witch trials |
| Tudor/Renaissance | Henry VIII, Anne Boleyn, Medici |
| Gothic Tales | Victorian horror, Edgar Allan Poe style |
| True Crime History | Jack the Ripper, Salem witch trials |
| Folklore & Legends | Robin Hood, King Arthur, Norse sagas |
| Ancient World | Greek tragedy, Roman intrigue |

**Inspired by**: [Google DeepMind's Dramatron](https://github.com/google-deepmind/dramatron) — hierarchical co-writing framework
**Script language**: English
**Meta-prompts**: `meta-prompts/dark-history/` (5 files, all English)

---

## Core Principle: Curiosity + Anticipation = Immersion

> **Curiosity and anticipation create immersion. Immersion is the ultimate success metric.**
>
> - Act I~II: Multiple suspects/possibilities — viewer cannot be certain — curiosity sustained
> - Act III early~mid: False resolution / twist reversal — anticipation maximized
> - Act III late (ch.16~17): Truth finally revealed — peak immersion
> - **If the culprit/truth is confirmed before Act III midpoint, it is a structural failure**

---

## Working Directory

```
{PROJECT_DIR}/story/ep{number}/
```

Episode number is confirmed with the user. Create directory if it doesn't exist.

## Scope

```
--scope act1         → Act I (ch.1~5) only      / 기(1~5챕터)
--scope act2         → Act II (ch.6~12) only     / 승(6~12챕터)
--scope act1,act2    → Act I + II only           / 기+승
--scope act3,act4    → Act III + IV only         / 전+결
(unspecified)        → Full script (all acts)    / 전체(기승전결)
```

---

## 12-Step Workflow

| # | Step | Reference Doc | Key |
|---|------|---------------|-----|
| R1 | Analysis / Diagnosis | `docs/R01-03-story-design.md` | Reference analysis or script scoring |
| R2 | Fact Check | ↑ | Historical accuracy verification |
| R3 | Synopsis | ↑ + `meta-prompts/{genre}/synopsis_guidelines.md` | 20-chapter framework |
| R4 | Preflight | `docs/R04-07-writing.md` + `meta-prompts/{genre}/preflight.md` | Structure check, foreshadowing tracker |
| R5 | Script Writing | ↑ + `meta-prompts/{genre}/screenplay_guidelines.md` + narrative + suspense | **Act I → II → III → IV → Hook** |
| R6 | Review & Revision | ↑ | Subagent review, max 5 rounds |
| R7 | Script Finalization | — | 🛑 User confirmation required |
| R8 | Production Extract | `docs/R08-09-production.md` | Narration/dialogue/SFX extraction |
| R9 | TTS/SFX Generation | ↑ | ElevenLabs mp3+SRT |
| R10 | Storyboard CSV | `docs/R10-storyboard.md` | references.csv + scenes.csv |
| R11 | Image/Video Generation | `docs/R11-12-image-upload.md` | Flow2CapCut batch generation |
| R12 | Upload Info | ↑ | Title/description/tags/thumbnail |

### Meta-Prompt Loading by Genre

| Step | yadam (한국어) | dark-history (English) |
|------|--------------|----------------------|
| R3 | `야담_시놉시스_작성_지침.md` | `synopsis_guidelines.md` |
| R4 | `야담_프리플라이트.md` | `preflight.md` |
| R5 | `야담_시나리오_작성_지침.md` | `screenplay_guidelines.md` |
| R5 | `야담_서술기법_가이드.md` | `narrative_techniques.md` |
| R5 | `야담_서스펜스_기법.md` | `suspense_techniques.md` |

### Absolute Rules

- Cannot proceed to R5 (Script) without R4 (Preflight)
- Cannot proceed to R8 (Production) without R7 (Finalization)
- Cannot proceed to R9 (TTS/SFX) without R8.5 (Extract Review)
- Cannot proceed to R10 (CSV) without R9 (TTS/SFX)
- R5 writing order: **Act I → II → III → IV → Hook** (must know the full story to write the hook)

---

## Gate System (MCP Enforced)

> **All step transitions are automatically verified. No exceptions.**

**Progress file**: `R_progress.json` in the episode directory

**MCP tool `mark_step_done`** records review completion:
- Next step gate opens only when `result: "pass"`
- On pass, the next step's reference document is automatically returned

**step IDs:**

| step ID | Step |
|---------|------|
| `R1_diagnosis` | R1 Analysis complete |
| `R2_factcheck` | R2 Fact check complete |
| `R3_synopsis` | R3 Synopsis complete |
| `R4_preflight` | R4 Preflight complete |
| `R5_writing` | R5 Script writing complete |
| `R6_review` | R6 Review complete |
| `R7_finalize` | R7 Script finalized |
| `R8_production` | R8 Production extract complete |
| `R8.5_review` | R8.5 Extract review complete |
| `R9_tts_sfx` | R9 TTS/SFX complete |
| `R10-3_references_review` | R10 Reference CSV review |
| `R10-3_scenes_review` | R10 Scene CSV review |

**Gate Table:**

| Next Step | Prerequisite | User Confirmation |
|-----------|-------------|-------------------|
| R5 | R4 complete | Auto |
| R7 | R6 complete | 🛑 Required |
| R8 | R7 complete | Auto |
| R9 | R8.5 complete | Auto |
| R10 | R9 complete | Auto |
| R11 | R10 complete | Auto |
| R12 | R11 complete | Auto |

---

## 20-Chapter Framework

| Act | Chapters | Purpose | 한국어 |
|-----|----------|---------|-------|
| **Act I** (Setup) | 1~5 | World, characters, inciting incident | 기 |
| **Act II** (Rising Action) | 6~12 | Complications, multiple suspects | 승 |
| **Act III** (Climax) | 13~17 | False resolution, twist, truth | 전 |
| **Act IV** (Resolution) | 18~20 | Consequences, epilogue | 결 |
| **Hook** | Pre-Act I | Cold open (written last) | 훅 |

---

## Related Tools

### Flow2CapCut MCP (Image/Video)
- Projects: `app_list_projects`, `app_create_project`
- CSV: `load_csv`, `list_scenes`, `update_prompt`, `save_csv`
- References: `list_references`, `update_reference_prompt`
- Images: `app_start_ref_batch`, `app_start_scene_batch`, `app_wait_batch`
- Schema: `get_schema({ type: "scenes" | "references" | "prompt-image" })`
- Gates: `mark_step_done`, `get_progress`

### TTS (Voice)
- ElevenLabs: `https://api.elevenlabs.io/v1/text-to-speech`
- Typecast (Korean): `https://api.typecast.ai/v1/text-to-speech`

### SFX (Sound Effects)
- ElevenLabs: `https://api.elevenlabs.io/v1/sound-generation`

### Script Evaluation
- Codex MCP — must pass `cwd` parameter
- Gemini-cli MCP — `mcp__gemini-cli__ask-gemini`

### YouTube Upload
```bash
cd ~/workspace/srt2short-cli && node bin/srt2short.js youtube upload \
  -f "<video_file>" -c "12_upload_info.json"
```

---

## General Principles

1. State the current step before starting (e.g., `## ▶ R5: Script Writing`)
2. After each step, ask "Proceed to next step (RX)?"
3. Web search is used automatically in R2/R3
4. **Always read meta-prompts/ documents before R5**
5. Curiosity maintenance is top priority
6. **After CSV load, verify app scene/reference count matches CSV**

---

## Red Flags — Stop If You Think This

| My Thought | Reality |
|------------|---------|
| "Review isn't needed" | If it's in the skill, do it |
| "Let's skip to images" | Review → Images, in order |
| "My CSV must be right" | That's why subagent review exists |
| "I remember the skill" | Skills get updated. Read every time |
| "This is simple" | Simple becomes complex. Check first |
| "Proceed now, verify later" | Verify first, proceed later |
| "User wants speed" | User wants correctness |
