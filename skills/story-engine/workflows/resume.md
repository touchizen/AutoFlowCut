<purpose>
Resume the story pipeline from where it left off.
Reads STATE.md to find current position, then delegates to /story-execute.
</purpose>

<process>
**Step 1: Find episode**

Look for STATE.md in the most recent episode directory:
```bash
ls -d {PROJECT_DIR}/story/ep*/STATE.md | sort -V | tail -1
```

If no STATE.md found, tell user to run `/story-new` first.

**Step 2: Read state**

Read STATE.md and determine:
- Episode number
- Current wave (first wave with status != "done")
- What was completed
- Any pending user confirmations

**Step 3: Display status**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STORY ENGINE ► Resuming Episode {number}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Completed: W1~W{last_done}
◆ Resuming from: W{next}
◆ {next_description}
```

**Step 4: Delegate**

Invoke `/story-execute --from W{next}`.

If W3 was completed but user confirmation is pending:
- Ask user to confirm the script first
- Then proceed to W4
</process>
