# VoxDesk

A passcode gated web page where a visitor talks to an ElevenLabs voice agent that answers
from a controlled knowledge base, checks live Cal.com availability, and books a real
discovery call during the conversation. Every call is persisted with its transcript, per
tool payloads with latencies, and extracted lead fields, and rendered on a dashboard.

**`SPEC.md` is the build contract and wins over everything except a direct instruction.**
Read it before changing anything structural.

## State, as of 2026-08-06

**Phases 0 through 4 are complete, closed at their gates, and pushed.** Do not redo them.
The next work is **Phase 5, distribution**, which has not started.

| | |
|---|---|
| Deployed | `https://voxdesk-seven.vercel.app` |
| Repo | `github.com/sheharyarr-ahmed/voxdesk`, **public** |
| Agent | `agent_1401kz0x1h1xfsk8x4vh5hxpjezg`, `enable_auth: true` |
| Knowledge base | doc `CgTt6RU8cZj1519ZGoUU`, RAG index `ZUXaCwee9tnYAo5BoPxw` |
| Suites | 102 unit, 18 e2e, `pnpm verify:all` is the gate command |
| Credits | **851 of 10000**, resets **2026-08-29** |

Start any session by reading `.claude/decisions/phase-4-gate-summary.md`. Every result in
this build has a decision record with the alternative considered and the reason, and the
gate summaries are the entry points.

## Five things that will cost you time if you learn them the hard way

1. **`git push` does not deploy.** This Vercel project has no git integration. Every
   deployment in its history came from `vercel deploy --prod`. A push publishes code and
   changes nothing that is running.
2. **Commit messages must not contain** `claude`, `anthropic`, `copilot`, `chatgpt`,
   `openai`, `co-authored-by` or `generated with`. `.githooks/commit-msg` rejects the
   commit, and it has rejected a message for merely quoting a file path. This file's own
   name is one of those strings, so refer to it obliquely in a commit message.
3. **No em-dashes anywhere** in `README.md`, `docs/`, `src/` or `agent/`.
   `scripts/check-copy.sh` fails the build on one, and on the four attribution strings.
   `docs/BLUEPRINT.md` is excluded by path; do not widen that exclusion.
4. **A timestamptz comes back as Postgres text, not a Date.** `src/lib/db/client.ts` sets
   `fetch_types: false`. Any new query casts through `to_json(col) #>> '{}'`. This shipped
   green through typecheck and the unit suite once while both dashboard pages returned 500.
5. **Never use `sk_test_` as a placeholder.** GitHub push protection reads it as a Stripe
   key and blocks the push.

## Hazards that fail silently

- **RAG index retention is 10 days.** An expired index does not error. The agent answers
  from model priors sounding identical, which voids the central claim. Check it before any
  demo. `docs/DEPLOY_CHECKLIST.md` section 1 has the command, plus a `rag-query` probe that
  proves live retrieval at zero credits.
- **Supabase pauses after 7 days idle.** Wake it before any live check.
- **`happy-path` in `agent/tests` creates a real Cal.com booking on every run**, by design.
  Cancel it afterwards and use `--only=` when iterating.
- **Voice minutes are the binding constraint.** Roughly **213 credits fixed per call plus
  256 a minute**, solved from two measured calls. Short calls are disproportionately
  expensive. Never start a conversation casually.

## How this build works

`ElevenLabs owns ears, brain and mouth.` Our server is never in the audio path and is
reached at exactly four points: session token mint, two synchronous tool webhooks mid call,
and an HMAC signed post call ingest. Code that widens that surface is out of scope.
`docs/ARCHITECTURE.md` has the detail.

All SDK usage sits behind `src/lib/voice/use-voice-session.ts`. Under
`NEXT_PUBLIC_VOICE_MOCK=1`, set **only** in the Playwright web server command, it resolves
to a scripted fake. That is why the e2e suite costs zero credits. No secret ever rides a
`NEXT_PUBLIC_` variable.

## Working rules for this repository

- **Verify by connecting, not by inspecting.** A passing check is a call that returned or a
  row that was counted, never a code read or a shape check. Phase 3 proved a 401 writes
  nothing by counting rows before and after, not by reading the handler.
- **A check that has never failed has not been tested.** `scripts/check-copy.sh` silently
  passed the strings it exists to catch until it was run against a deliberate violation.
- **Anti-fabrication is enforced, not aspirational.** `docs/CLAIMS.md` is authoritative.
  Every `README.md` line traces to a numbered row in it. A claim that cannot be pointed at
  a row is deleted, not softened. Two of the ten screenshots are the mock seam and are
  named `MOCK` for exactly this reason.
- **Secrets go into files with an editor, never through a shell command**, and are never
  echoed. Verify presence and shape only.
- **Record deviations.** Numbering is continuous and currently ends at **37**, in
  `.claude/decisions/phase-4-gate-summary.md`. Continue from 38.

## Commands

```bash
pnpm verify:all             # typecheck, 102 unit, copy check, 18 e2e. The gate.
pnpm dev
vercel deploy --prod        # the actual deploy
pnpm agent:push --dry       # diff local agent config against remote
```
