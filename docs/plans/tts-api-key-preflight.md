# Phase Plan — TTS / SFX API Key Preflight at Episode Start

**Status**: planned (not started)
**Estimated effort**: ~3 hours (orchestrator gate + `readApiKey` extension + docs)
**Risk level**: Low — additive check; existing lazy-load path remains as fallback

---

## Motivation

Today, API keys for the TTS / SFX providers are loaded **lazily** by the
scripts:

| Provider | Env var | Credentials file | Currently in `readApiKey`? |
|----------|---------|------------------|----------------------------|
| ElevenLabs (TTS + SFX) | `ELEVENLABS_API_KEY` | `~/.elevenlabs/credentials` | ✅ |
| Typecast (TTS) | `TYPECAST_API_KEY` | `~/.typecast/credentials` | ✅ |
| Google AI Studio (Gemini TTS) | `GOOGLE_AI_STUDIO_API_KEY` (proposed) | `~/.google-ai-studio/credentials` | ❌ (W5 doc says "TBD") |

If a key is missing, the failure happens **in the middle of W5**, after the
user has spent W1–W4 worth of work, and surfaces as `ENOENT` (no
credentials file) or `401 invalid api_key` (file present but stale/wrong).
The recovery is to abort W5, set the key, and re-run — wasting 5–10 minutes
of pipeline state and leaving partially-generated segments behind.

A **preflight check** at episode start catches every needed key BEFORE any
expensive work begins, so the user can paste/fix once and the pipeline runs
clean.

---

## When to check: tied to provider selection

The exact set of keys needed depends on:

| User's W5-0-prep choice | Keys required |
|--------------------------|---------------|
| Narration = ElevenLabs, dialogue = Typecast | ElevenLabs + Typecast |
| Narration = Typecast, dialogue = Typecast | Typecast only |
| Narration = ElevenLabs, dialogue = none | ElevenLabs only |
| Narration = Vrew (external), dialogue = Typecast | Typecast only (Vrew is local app) |
| Any narration choice + SFX enabled | + ElevenLabs (SFX always uses ElevenLabs) |
| Any narration choice + SFX disabled | (per the production-scope-gate plan) skip the ElevenLabs-for-SFX check |

So the preflight runs **as part of W5-0-prep**, AFTER provider selection
is known. Running earlier (e.g., at `/story-new`) would force the user to
have keys for providers they won't actually use this episode.

(Compatible with the production-scope-gate plan: when `sfx: false`, the
ElevenLabs requirement for SFX is dropped.)

---

## Preflight flow

```
W5-0-prep step:
  1. AskUserQuestion: narration provider, dialogue provider, SFX yes/no
  2. Compute required-keys set from the answers
  3. For each provider in the set:
       a. Try to load the key via `readApiKey(provider)` (env → file)
       b. If found → validate with a cheap GET call:
            - ElevenLabs: GET /v1/voices  (returns 200 if key valid)
            - Typecast:   GET /v1/voices  (returns 200 if key valid)
            - Gemini:     GET https://generativelanguage.googleapis.com/v1beta/models?key=...
       c. If load fails OR validation returns 401/403:
            AskUserQuestion with three options:
              i.   "Paste the key now" → free-text input → persist to
                   `~/.<provider>/credentials` (dotenv format) → re-validate
              ii.  "Open the credentials file manually" → print the
                   expected path, pause, retry validation when user resumes
              iii. "Switch provider" → back to step 1
  4. Once every required key is present + validates → proceed to W5-0-assign

User-facing chat lines:
  ▸ Validating ElevenLabs API key…
  ✅ ElevenLabs key OK
  ▸ Validating Typecast API key…
  ⚠ Typecast key missing (~/.typecast/credentials)
    [paste / open-file / switch-to-elevenlabs-for-dialogue]
```

---

## Scope

### In scope (v1)
- Preflight at W5-0-prep, gated on the provider set
- Cheap GET-based validation per provider (no audio generation)
- AskUserQuestion remediation: paste key / open file / switch provider
- Persist pasted key to `~/.<provider>/credentials` in dotenv format
  (`TYPECAST_API_KEY=...`)
- Extend `readApiKey()` to support Google AI Studio (`gemini`) with the
  env name `GOOGLE_AI_STUDIO_API_KEY` and dir `~/.google-ai-studio/`
- Wire the SFX path: if production-scope-gate's `sfx: true`, add
  ElevenLabs to the required set even when narration uses a different
  provider

### Out of scope (deferred)
- In-app Settings UI for managing keys (already mentioned as a v2 for
  the AudioTab SFX-prompts plan — would naturally include this)
- Rotating keys mid-pipeline (rare; manual restart is acceptable)
- Caching validation results (each W5-0-prep re-validates; cheap GETs)
- Resetting / revoking a stored key from inside the pipeline

---

## Cascade map

| File | Change |
|------|--------|
| `skills/story-engine/scripts/lib_afc.cjs` | Extend `readApiKey()`: add `gemini` provider (`GOOGLE_AI_STUDIO_API_KEY` / `~/.google-ai-studio/credentials`). Add new exported function `validateApiKey(provider, key)` that performs the cheap GET and returns `{ ok, status, message }`. Add `persistApiKey(provider, key)` that writes dotenv to `~/.<provider>/credentials` (create dir + file with mode 0600). |
| `skills/story-engine/workflows/execute-pipeline.md` | W5 sub-step decomposition: rename `W5-0-prep provider-pick` → `W5-0-prep provider-pick + key-preflight`. Sub-step is allowed >3 min IF user is pasting keys — emit `▸ Waiting for API key entry…` heartbeat. W5 subagent prompt: include the preflight flow above. |
| `skills/story-engine/docs/{en,ko}/W5-tts-sfx.md` | § 5-0-prep: document the preflight (provider table, validation endpoints, remediation options, what gets persisted where). Provider table updated to mark Google AI Studio as supported (when implementation lands). |
| `skills/story-engine/workflows/new-episode.md` | (Optional) Mention that keys are checked at W5-0-prep so the user knows they don't need to pre-populate. No change required if optional. |
| `skills/story-engine/SKILL.md` | One-line in the wave table under W5: "API key preflight at W5-0-prep". |
| `docs/plans/tts-api-key-preflight.md` | This file. |
| `TODO.md` | Backlog entry. |

---

## Provider-specific validation endpoints

| Provider | Method | URL | Required header | Success | Failure (bad key) |
|----------|--------|-----|-----------------|---------|-------------------|
| ElevenLabs | GET | `https://api.elevenlabs.io/v1/voices` | `xi-api-key: <key>` | 200 + voice list | 401 |
| Typecast | GET | `https://api.typecast.ai/v1/voices` | `x-api-key: <key>` | 200 + voice list | 401 |
| Google AI Studio (Gemini) | GET | `https://generativelanguage.googleapis.com/v1beta/models?key=<key>` | (no header; key in URL) | 200 + model list | 400 / 403 |

All three are read-only and free (no usage charge for `GET /voices` or
`GET /models`). Validation takes < 1 second per provider.

---

## Credentials file format (persisted when user pastes)

Same dotenv format `readApiKey` already accepts:

```
# ~/.typecast/credentials
TYPECAST_API_KEY=tc_secret_value_here
```

```
# ~/.elevenlabs/credentials
ELEVENLABS_API_KEY=sk_secret_value_here
```

```
# ~/.google-ai-studio/credentials
GOOGLE_AI_STUDIO_API_KEY=AIza...
```

File permissions: created with `0600` (owner read/write only). Existing
files are preserved if they already contain the expected `KEY=` line; new
key is appended only when the line is absent.

---

## Implementation phases

1. **`readApiKey` + `validateApiKey` + `persistApiKey` in lib_afc.cjs**
   (~1 hour). Add gemini support, add the two new helpers, unit-style
   test by calling them locally.
2. **Preflight prompt in W5-0-prep** (~1 hour). Update W5 wave doc + W5
   subagent prompt to run the preflight loop. AskUserQuestion options.
3. **Manual verification** (~30 min). Run one episode with: (a) all keys
   valid, (b) one key missing, (c) one key invalid, (d) all keys missing.
   Confirm correct paths to recovery in each case.
4. **Docs polish** (~30 min). SKILL.md + new-episode.md mentions.

---

## Resolved questions

1. **Why not check at /story-new?** Because the required-key set depends
   on the W5-0-prep provider choice, which happens 4 waves later. Asking
   at /story-new would force the user to have keys they may not use.

2. **What if the user doesn't have a key and refuses to provide one?**
   Three valid outcomes:
   - Switch provider (some other choice in the W5-0-prep AskUserQuestion)
   - Disable SFX (per production-scope-gate plan, sets `sfx: false`)
   - Abort the episode at this point — fail fast with clear next step

3. **Should we cache validation across episodes?** No. The validation
   GET is < 1 second; episodes are run interactively so a per-episode
   check matches user expectations and catches key rotation early.

4. **Pasting secrets into the chat — is that safe?** AskUserQuestion's
   free-text response is captured by the harness like any other user
   input. The persisted file (mode 0600) is the long-term storage; the
   in-chat copy is ephemeral. Users who don't want to paste should use
   the "open the credentials file manually" option instead.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| User pastes a key into chat in a shared screen / streaming context | AskUserQuestion text-input is the standard mechanism; recommend the user use the "open file manually" path when not alone. Spec calls this out. |
| Validation endpoint changes / temporarily down | Treat 5xx as "validation skipped" with a warning; proceed and let the actual TTS call surface a more specific failure if it still happens. Do NOT block on transient infra. |
| User has valid key for one provider but the chosen pipeline needs another | The AskUserQuestion remediation includes "switch provider" — user can re-pick on the spot without aborting. |
| Stored credentials file gets out of sync with env var | `readApiKey` already prefers env over file. If both exist and differ, the env wins; the file is informational. Document this precedence in W5-0-prep. |
| Created `~/.<provider>/credentials` overwrites a user's existing file | Append-only logic: read existing file; if a `KEY=` line exists, replace its value; otherwise append a new line. Never truncate the whole file. |
