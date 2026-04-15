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
- `--genre yadam|dark-history` (optional -- auto-detect from user language)

**Step 2: Create episode directory**

Episodes live under the AutoFlowCut work folder, in a per-project sub-folder named `ep{number}_<slug>` (to align with how AutoFlowCut projects are organized), with a `_story_source/` sub-folder for authoring artifacts:

```bash
mkdir -p "{PROJECT_DIR}/ep{number}_{slug}/_story_source"
```

`{slug}` is a short lowercase identifier of the topic (e.g. `eilean_mor`). All subsequent file paths in this workflow that reference the episode directory should use `{PROJECT_DIR}/ep{number}_{slug}/_story_source/`.

**Step 3: Genre detection**

| User Language | Genre | Meta-Prompts |
|--------------|-------|-------------|
| 한국어 | yadam | meta-prompts/yadam/ |
| English | dark-history | meta-prompts/dark-history/ |

Override with `--genre` flag.

**Step 4: Topic discussion**

Use AskUserQuestion to gather:
1. Story topic/theme
2. Reference material (URLs, text, videos) -- optional
3. Target length — default depends on genre:
   - yadam (Korean): 10,000자 / ~28 min
   - dark-history (English): 2,500 words / ~17 min
4. Special requirements

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
| W7 | pending | Images + CapCut |
| W8 | pending | Upload info |

## Decisions
- Topic: {topic}
- Genre: {genre}
- Target length: {length}
- References: {references or "none"}
```

**Step 6: Initialize W_progress.json**

Write to `{PROJECT_DIR}/ep{number}_{slug}/_story_source/W_progress.json`:

```json
{
  "episode": {number},
  "genre": "{genre}",
  "topic": "{topic}",
  "waves": {
    "W1": { "status": "pending" },
    "W2": { "status": "pending" },
    "W3": { "status": "pending" },
    "W4": { "status": "pending" },
    "W5": { "status": "pending" },
    "W6": { "status": "pending" },
    "W7": { "status": "pending" },
    "W8": { "status": "pending" }
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

Invoke `/story-execute`.
</process>
