<purpose>
Initialize a new story episode through topic discussion and context gathering.
Creates episode directory, STATE.md, and W_progress.json.
Auto-chains to /story-execute on completion.
</purpose>

<process>
**Step 0: Resolve {PROJECT_DIR} (MANDATORY — do this FIRST)**

The installed skill does not hard-code a project path. Resolve {PROJECT_DIR} in this order:
1. If `metadata.json` has `resolvedVariables.PROJECT` set, use it.
2. Else call the AutoFlowCut MCP tool `mcp__autoflowcut__app_list_projects`. The response begins with a line like `작업폴더: C:\Users\<user>\OneDrive\문서\AutoFlowCut`. Use that path.
3. Else ASK the user via AskUserQuestion. Do NOT fall back to cwd or to the source-repo path (`C:\workspace\AutoFlowCut` or similar) — that creates the episode inside the source tree, which is wrong.

Store the resolved absolute path as {PROJECT_DIR} for all later steps.

**Step 1: Parse arguments**

Parse $ARGUMENTS for:
- Episode number (required -- ask if not provided)
- `--genre yadam|dark-history|bespoke` (optional -- auto-detect from user language + topic keywords)

**Step 2: Create episode directory**

Episodes live under the AutoFlowCut work folder, in a per-project sub-folder named `ep{number}_<slug>` (to align with how AutoFlowCut projects are organized), with a `_story_source/` sub-folder for authoring artifacts:

```bash
mkdir -p "{PROJECT_DIR}/ep{number}_{slug}/_story_source"
```

`{slug}` is a short lowercase identifier of the topic (e.g. `eilean_mor`). All subsequent file paths in this workflow that reference the episode directory should use `{PROJECT_DIR}/ep{number}_{slug}/_story_source/`.

**Step 3: Genre detection + Output language resolution**

| Trigger | Genre | Output language | Meta-Prompts |
|---------|-------|-----------------|--------------|
| 한국어 + 야담/민담/조선/설화/전설 키워드 | yadam | `ko` (locked) | `meta-prompts/yadam/` (ASCII filenames: yadam-*.md) |
| English + dark/gothic/medieval/witch/folklore/colonial 키워드 | dark-history | `en` (locked) | `meta-prompts/dark-history/` (English filenames) |
| 어느 장르도 키워드가 명확하지 않음 (또는 `--genre bespoke`) | **bespoke** | `ko` or `en` (auto-detect from references/topic; ask user if ambiguous) | `meta-prompts/bespoke/{output_lang}/` (subfolder per output language: `ko/` for Korean, `en/` for English) + per-episode `_meta_supplement.md` (W1-5에서 생성) |

**Output language resolution at /story-new time** (write to STATE.md "Output language:" field):
- yadam → `ko`
- dark-history → `en`
- bespoke → detect from references (transcript language) and/or topic (한국어 vs English). If ambiguous OR mixed → AskUserQuestion. **Do NOT proceed without resolved value.** This field is used by execute-pipeline / rewrite-episode to pick `bespoke/{lang}/` subfolder.

Override with `--genre` flag.

**Bespoke 장르 추가 요건**: Bespoke 장르 선택 시, Step 4에서 사용자에게 **3~5개 성공 대본 reference**를 추가로 받는다 (Bespoke W1-0~W1-5의 입력).

**Step 4: Topic discussion**

Use AskUserQuestion to gather:
1. Story topic/theme
2. Reference material:
   - **yadam / dark-history**: optional (URLs, text, videos)
   - **bespoke**: **REQUIRED 3~5 successful reference scripts** (URLs / pasted text / local file paths). If < 3 → escalate, offer switch to yadam/dark-history or ask for more references. Optional labels per reference: `tone-match`, `structure-match`, `topic-adjacent`, `audience-match`.
3. Target length — default depends on genre:
   - yadam (Korean): 10,000자 / ~28 min
   - dark-history (English): 2,500 words / ~17 min
   - bespoke: ask user (default suggestion based on referenced scripts' average length)
4. Special requirements
5. Scene splitting policy (씬 분리 정책)
   - Question: "씬 분리할 때 화자가 바뀌면 별도 씬으로 분리할까요? / Split scenes on speaker change?"
   - Options:
     - "분리 안 함 (default) / Don't split" — 같은 시간대면 A→B 대사도 한 씬에 통합. 야담/narrator 중심 콘텐츠에 적합.
     - "화자 바뀔 때마다 분리 / Split on every speaker change" — A 대사 / B 대사 각각 별도 씬. 대화 중심 bespoke / 인터뷰 형식에 적합.
   - 장르 기반 추천 (질문에 hint로 포함):
     - yadam (주로 narrator) → "분리 안 함" 추천
     - dark-history (narration + 간헐 대사) → "분리 안 함" 추천
     - bespoke (장르 따라 다름) → reference 분석 결과로 hint, 모르면 default
   - Default 적용 (응답 없거나 ambiguous):
     - yadam / dark-history → 자동 `false` (장르 default)
     - bespoke → reference 분석 결과가 명확히 "대화 중심"이면 `true` 제안. 아니면 `false`. 사용자 override 가능.
   - **Resolved value substitution**: 사용자 응답을 boolean (`true`/`false`)으로 확정한 뒤, Step 5의 `{split_on_speaker_change_yn}` placeholder는 `yes`/`no`로, Step 6의 `{split_on_speaker_change}` placeholder는 `true`/`false` JSON 리터럴로 치환한다. 기본 `false` 폴백은 `{topic}`/`{genre}` 와 동일하게 "resolved value를 substitute"하는 컨벤션을 따른다 — 템플릿의 리터럴을 그대로 복사하지 말 것.

**Bespoke-specific output preparation:**
- Create `{PROJECT_DIR}/ep{number}_{slug}/_story_source/_references/` directory
- Save each user-provided reference: `_references/ref{N}_{slug}.{ext}` + metadata file `_references/index.json`
- Index format:
  ```json
  {
    "references": [
      { "id": 1, "source": "https://...", "transcript_file": "ref1_xxx.txt", "user_label": "tone-match", "length_words": 2400 },
      ...
    ]
  }
  ```

**Step 5: Initialize STATE.md**

Write to `{PROJECT_DIR}/ep{number}_{slug}/_story_source/STATE.md`:

```markdown
# Episode {number} -- {topic}

## Status
- Genre: {genre}
- Current Wave: W1
- Started: {date}

## Waves
| Wave | Status | Summary |
|------|--------|---------|
| W1 | pending | Story design |
| W2 | pending | Synopsis + preflight |
| W3 | pending | Writing + review |
| W4 | pending | Production extract |
| W5 | pending | TTS/SFX |
| W6 | pending | Storyboard CSV |
| W7 | pending | Image production |
| W8 | pending | Assembly (audio + CapCut + video) |
| W9 | pending | Upload info |

## Decisions
- Topic: {topic}
- Genre: {genre}
- Output language: {output_lang}  # ko (yadam locked, or bespoke + Korean refs/topic) | en (dark-history locked, or bespoke + English)
- Target length: {length}
- References: {references or "none"}{if bespoke: " (3~5 reference scripts in _references/)"}
- Split on speaker change: {split_on_speaker_change_yn}   # yes|no, display mirror; authoritative value is W_progress.json `options.splitOnSpeakerChange`
```

> **`production_scope:` block is NOT pre-filled here on purpose.** Unlike `splitOnSpeakerChange` (a stylistic policy collected at /story-new because it's set-and-forget), production scope is collected at **W4-0** — after W3 script confirmation — so the user can see what this episode actually needs before committing to ~10–25 min of TTS/SFX runtime. W4-0 persists the resolved scope into this Decisions block as a nested YAML block:
>
> ```markdown
> - production_scope:
>     dialogue: true   # default true — Dialogue TTS on (W4-6 + W5-1f)
>     sfx: true        # default true — SFX on (W4-7 + W5-2)
> ```
>
> Full schema spec: `workflows/execute-pipeline.md` → "STATE.md schema — production_scope block".
> Legacy ep resumed without this block → defaults silently to `{ dialogue: true, sfx: true }` (current behavior preserved; resume does NOT re-ask — see `workflows/resume.md` Step 2).

**Step 6: Initialize W_progress.json**

Write to `{PROJECT_DIR}/ep{number}_{slug}/_story_source/W_progress.json`:

```json
{
  "episode": {number},
  "genre": "{genre}",
  "topic": "{topic}",
  "options": {
    "splitOnSpeakerChange": {split_on_speaker_change}
  },
  "waves": {
    "W1": { "status": "pending" },
    "W2": { "status": "pending" },
    "W3": { "status": "pending" },
    "W4": { "status": "pending" },
    "W5": { "status": "pending" },
    "W6": { "status": "pending" },
    "W7": { "status": "pending" },
    "W8": { "status": "pending" },
    "W9": { "status": "pending" }
  }
}
```

`options.splitOnSpeakerChange` is the episode-wide policy collected in Step 4 item 5. It lives at root (not under a specific wave) because it affects W6 storyboard splitting and any subsequent wave that reasons about scene boundaries. The `{split_on_speaker_change}` placeholder above MUST be substituted with the resolved boolean — `true` if user opted in (or bespoke reference analysis indicates dialogue-driven + user confirmed), else `false`. Do NOT leave the placeholder unsubstituted and do NOT hard-copy a literal `false`.

For **bespoke** genre, additionally include `references` metadata:
```json
{
  ...,
  "bespoke": {
    "references_count": <3 to 5>,
    "references_index": "_references/index.json"
  }
}
```

**Step 7: Chain to /story-execute**

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STORY ENGINE ► Episode {number} initialized
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Genre: {genre}
◆ Topic: {topic}
◆ Starting W1 (Story Design)...
```

> **API keys for TTS/SFX providers (ElevenLabs / Typecast / Gemini)** are checked at **W5-0-prep** with a manual-assisted preflight loop — no need to pre-configure them before `/story-new`. The required-key set is computed AFTER provider selection + `production_scope` are known, so you only validate keys this episode actually uses. See `docs/{lang}/W5-tts-sfx.md` § "5-0-prep + key preflight" for the full flow.

Invoke `/story-execute`.
</process>
