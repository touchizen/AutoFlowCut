<purpose>
Initialize a new story episode through topic discussion and context gathering.
Creates episode directory, STATE.md, and W_progress.json.
Auto-chains to /story-execute on completion.
</purpose>

<process>
**Step 1: Parse arguments**

Parse $ARGUMENTS for:
- Episode number (required -- ask if not provided)
- `--genre yadam|dark-history` (optional -- auto-detect from user language)

**Step 2: Create episode directory**

```bash
mkdir -p "{PROJECT_DIR}/story/ep{number}"
```

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
3. Target length (default: 10,000자 / 28분)
4. Special requirements

**Step 5: Initialize STATE.md**

Write to `{PROJECT_DIR}/story/ep{number}/STATE.md`:

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

Write to `{PROJECT_DIR}/story/ep{number}/W_progress.json`:

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
