# Tooling · ElevenLabs CLI evaluated and installed

**Date:** 2026-08-03
**Phase:** 0, tooling evaluation, outside the §9 sweep
**Status:** Installed and verified working. Adoption as the Phase 2 push mechanism is **not yet decided** and belongs to Phase 2 planning.

## What was installed

```
npm install -g @elevenlabs/cli      ->  v0.5.6
binary: elevenlabs
```

Host toolchain: node v24.14.1, pnpm 10.33.2, npm 11.12.1.

## Authentication, better than the documented path

The documentation says to run `elevenlabs auth login`, which stores the key in `~/.agents/api_keys.json` as plaintext on disk.

**Do not do that.** The CLI reads `ELEVENLABS_API_KEY` from the environment directly and prefers it:

```
$ set -a && . ./.env.local && set +a && elevenlabs auth whoami
Logged in: sk_47472...7a98 (from environment variable)
Residency: global
```

It also masks the key in its own output. So every invocation is `set -a && . ./.env.local && set +a && elevenlabs ...`, the key exists in exactly one gitignored file, and no second copy is created outside the repo. This also means no session ever has to handle the value to use the CLI, which keeps the SPEC.md §7 handover rule intact.

## Verified working against the live agent

Run in a scratch directory so the repository was untouched at the Phase 0 gate.

| Command | Result |
|---|---|
| `agents init .` | Creates `agents.json`, `tools.json`, `tests.json`, and the `*_configs/` directories |
| `agents pull --all` | Found 1 agent, wrote `agent_configs/VoxDesk-Concierge.json` |
| `agents push --dry-run` | Reports the intended action without writing |

Round trip fidelity is exact. The pulled config's prompt compared **byte identical** to `agent/prompts/system.md` at 4919 bytes, with the knowledge base reference and `rag.enabled` preserved:

```
prompt matches repo file: True
knowledge_base: [{"type":"text","name":"sherylabs","id":"CgTt6RU8cZj1519ZGoUU","usage_mode":"auto"}]
rag.enabled: True
```

`agents.json` is a registry holding `id`, `version_id`, and `branch_id`. That is the same role SPEC.md §6.8 assigns to `agent/ids.json`.

`platform_settings` round trips, which is where the six `data_collection` lead fields from SPEC.md §6.5 will live in Phase 2.

## Three limitations that matter

1. **No knowledge base support.** There is no knowledge base command at any level. Uploading the document and computing the RAG index stay direct API calls, which is what Phase 0 already did. Any `pnpm agent:push` will therefore be the CLI **plus** a small script, not the CLI alone.

2. **`--dry-run` does not compute a content diff.** With zero local changes it still reported `VoxDesk Concierge: Will push (force override)`. SPEC.md §6.8 requires that `--dry` "prints the diff between local config and remote state". The CLI prints intent, not a diff. If the real diff matters, that is ours to add.

3. **`pull` prompts interactively.** `Proceed? (y/N)` blocks automation. `--all` plus piping `y` works, but any scripted use needs that handled explicitly.

## The Phase 2 decision, stated but not taken

SPEC.md §4 specifies `agent/push.ts`, `agent/agent.config.json`, and `agent/ids.json`. The CLI uses `agent_configs/`, `tool_configs/`, and root level `agents.json`. Adopting it wholesale is a deviation from the locked file tree and from §6.8.

Leaning, for Phase 2 to confirm or reject: **hybrid.** Use the CLI for agents and tools, since it is vendor maintained and replaces code we would otherwise write and own. Keep a small script for the knowledge base, which the CLI does not cover. Have `pnpm agent:push` orchestrate both so SPEC.md §6.8's single command contract survives. `pull --output-dir` accepts a path, so configs can live under `agent/` and stay close to the specified tree.

Argument against, worth weighing rather than dismissing: SPEC.md §12 claims "the entire agent configuration held as versioned code and pushed via API". That claim survives either way, since the CLI pushes via API and the configs remain committed JSON. But a hand written sync script is a marginally stronger portfolio signal than invoking a vendor CLI. The counter is that the differentiating engineering in this build is the tool contracts, the HMAC verification, and the observability layer, not config sync, and spending code on a solved problem is the opposite of the simplicity constraint.

Decide it in Phase 2 planning with the tool definitions in hand, not now.

## Note on `agents branches`

The CLI exposes a branch workflow (`agents branches`, `pull --all-branches`, `push --branch`). Unused here and out of scope, but it is the mechanism if agent config ever needs a staging path separate from production.
