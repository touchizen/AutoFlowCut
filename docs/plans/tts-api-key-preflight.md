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

**Two distinct failure modes today:**

1. **First-time setup (key never registered).** Brand-new user runs
   `/story-engine`, picks ElevenLabs at W5-0-prep, hits W5-1a → `ENOENT
   ~/.elevenlabs/credentials`. No guidance on where to get a key, what
   format to put it in, or how to register without leaving the chat.
2. **Stale / expired / wrong key.** File or env var exists, but the value
   no longer authenticates → `401 invalid api_key` in W5-1a. Same loss
   of W1-W4 state.

A **preflight check** at episode start catches both modes BEFORE any
expensive work begins. For mode (1) — first-time setup — the prompt must
also tell the user **where to obtain the key** and **let them register it
without leaving the workflow**.

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
       b. Classify the result:
            - **Found + validates** → continue
            - **Not found** (no env var, no file) → first-time setup path
            - **Found but 401/403** → stale/invalid key path
       c. Validation (when key is found): cheap GET
            - ElevenLabs: GET /v1/voices  (returns 200 if key valid)
            - Typecast:   GET /v1/voices  (returns 200 if key valid)
            - Gemini:     GET https://generativelanguage.googleapis.com/v1beta/models?key=...
       d. **First-time setup path** (key was never registered):
            AskUserQuestion options:
              i.   "I have a key — paste it now" → free-text input →
                   persist to `~/.<provider>/credentials` → validate → continue
              ii.  "Show me where to get a key" → print provider's signup URL
                   + console screenshot of where to find the key, then loop
                   back to (i) when the user has it
              iii. "Switch to a different provider" → back to step 1
              iv.  "I'll set it up myself, retry later" → print the expected
                   credentials file path, pause; on resume re-run step 3a
            Each option includes a one-line "credentials live at
            ~/.<provider>/credentials in dotenv format (`<ENVNAME>=...`),
            mode 0600" reminder so the manual path is unambiguous.
       e. **Stale/invalid key path** (key found, validation 401/403):
            Same remediation menu, but the chat opener clarifies the key
            is present but rejected:
              `⚠ Typecast key at ~/.typecast/credentials returned 401.
               Likely expired or wrong account.`
            Options i–iv as above; option (i)'s paste handler REPLACES the
            line in the existing credentials file (does not duplicate).
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

### Forward-compatibility: "other providers"

The built-in set covers EN-friendly providers (ElevenLabs, Gemini) and
the most common KO provider (Typecast). For other markets / languages,
users may want to register their own TTS provider. The preflight loop
SHOULD accommodate this without code changes per-provider:

**v1 — generic "other" entry in AskUserQuestion:**

When the user picks "Other / 직접 등록" in the W5-0-prep narration or
dialogue question, prompt for:
- Provider key name (lowercase ASCII, used as the `~/.<key>/credentials` dir)
- Display name (used in chat banners)
- API key value
- Validation URL (cheap GET that returns 200 on a valid key) — optional;
  if blank, skip validation and let the actual TTS call surface failure

The pasted key is persisted to `~/.<provider>/credentials` (same dotenv
format) and noted in `tts_settings.md` as `narrator_provider: other:<name>`.
The TTS execution itself still requires user-supplied scripts at this point
(see "v2" below).

**v2 — first-class provider plug-ins (separate plan):**

A registry under `skills/story-engine/providers/<name>/` with three files:
- `meta.json` — display name, env var name, credentials dir, supported modes (`narration` / `dialogue`)
- `validate.sh` (or `.cjs`) — cheap GET-or-equivalent that exits 0/non-zero
- `tts.cjs` — script invoked from W5-1a / W5-1f with `(textPath, outDir, voiceId)` contract; outputs the unified alignment shape used downstream

This is the path to real KO / JP / CN / EU regional support without
hard-coding each provider into `lib_afc.cjs`.

**Candidate regional providers (for v2 registry priority):**

| Region | Provider | Strength | API |
|--------|----------|----------|-----|
| KO | 네이버 클로바 (Clova) | Korean-native, free tier | `https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts` |
| KO | Supertone | High-quality Korean character voices | proprietary |
| JP | VOICEVOX | Free open-source, character voices | local server |
| JP | COEIROINK | Free open-source | local server |
| JP | Coefont | Commercial high-quality Japanese | `https://api.coefont.cloud/v2/text2speech` |
| CN | ByteDance Volcano (火山引擎) | Mandarin-native | `https://openspeech.bytedance.com/` |
| CN | Aliyun NLS | Mandarin-native, scale | `https://nls-meta.cn-shanghai.aliyuncs.com/` |
| Global | OpenAI TTS | Multilingual, fast | `https://api.openai.com/v1/audio/speech` |
| Global | Azure Speech | Multilingual, neural voices | `https://*.tts.speech.microsoft.com/` |
| Global | Amazon Polly | Multilingual | AWS SDK |

The v2 plan can land any of these as registry entries without changing the
W5 spec, and bespoke-genre episodes in a language not well covered by the
default trio (EL/TC/Gemini) get clean regional support.

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

| Provider | Method | URL | Required header | Success | Failure (bad key) | Signup URL (shown in first-time setup) |
|----------|--------|-----|-----------------|---------|-------------------|----------------------------------------|
| ElevenLabs | GET | `https://api.elevenlabs.io/v1/voices` | `xi-api-key: <key>` | 200 + voice list | 401 | `https://elevenlabs.io/app/speech-synthesis/api-keys` |
| Typecast | GET | `https://api.typecast.ai/v1/voices` | `x-api-key: <key>` | 200 + voice list | 401 | `https://app.typecast.ai/api-keys` |
| Google AI Studio (Gemini) | GET | `https://generativelanguage.googleapis.com/v1beta/models?key=<key>` | (no header; key in URL) | 200 + model list | 400 / 403 | `https://aistudio.google.com/app/apikey` |

All three are read-only and free (no usage charge for `GET /voices` or
`GET /models`). Validation takes < 1 second per provider.

The signup URL is surfaced via the "Show me where to get a key" option in
the first-time-setup path. The orchestrator prints the URL as plain text
(user clicks if their terminal supports it); no auto-open to avoid hijacking
the user's browser.

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
