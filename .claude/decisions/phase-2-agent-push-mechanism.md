# Phase 2 · `pnpm agent:push` is our script, not the vendor CLI

**Date:** 2026-08-05
**Phase:** 2
**Status:** Decided. `tooling-elevenlabs-cli.md` deferred this here with a stated leaning toward a hybrid. The leaning is rejected, with the reasons below.

## The decision

`agent/push.ts`, roughly 300 lines of `fetch`, run by `node` directly. No build step, no runner dependency, no CLI in the path that pushes anything.

## Why the hybrid was rejected

The hybrid was CLI for agents and tools, a script for the knowledge base, `pnpm agent:push` orchestrating both. Four reasons it loses, and the first is the one that decides it.

1. **A script was needed either way.** The CLI has no knowledge base support at any level, and the knowledge base is not an optional corner of this config. The choice was never script versus no script. It was one mechanism or two.
2. **SPEC.md §6.8 requires `--dry` to print "the diff between local config and remote state".** The CLI prints intent: with zero local changes it still reported "Will push (force override)". Only our own code can satisfy that sentence, and the sentence is worth satisfying, because a push that cannot tell you what it is about to change is not configuration as code, it is a deploy button.
3. **The CLI's layout fights the locked tree.** `agents init` writes `agents.json`, `tools.json`, `tests.json` and `*_configs/` at the repository root. Four files outside the SPEC.md §4 tree, and `agents.json` duplicating the role §6.8 gives `agent/ids.json`. Two registries that can disagree.
4. **It is a global npm install absent from the lockfile.** The build would depend on a tool `package.json` does not declare and `pnpm install` does not provide.

## What the CLI is kept for, and it is genuinely useful

An independent, vendor authored reader. After the push, `elevenlabs agents pull --all` run in a temporary directory outside the repository confirmed, without using any of our code:

```
prompt byte identical to agent/prompts/system.md : True (9464 chars)
tool_ids                                         : both, matching agent/ids.json
knowledge_base                                   : sherylabs CgTt6RU8cZj1519ZGoUU, rag enabled
visitor_timezone placeholder                     : Asia/Karachi
data_collection                                  : all six fields
attached_tests                                   : 5
first_message and tts voice                      : preserved
```

Verifying a write with the writer's own code proves less than verifying it with someone else's. That is worth one command.

## What the script does

Resolves every entity by name, never by id, in dependency order: workspace secret, knowledge base document and its RAG index, both tools, the five tests, then the agent. Ids come back and land in `agent/ids.json`, committed. Re-running is idempotent, which is demonstrated rather than claimed: `--dry` on a cold workspace printed creates for everything, the push applied them, and `--dry` immediately after printed `no changes` on every line.

Three implementation notes worth keeping.

**The diff walks only what we own, arrays included.** Live state carries dozens of platform defaults this build does not set, so the diff descends only into keys present in the desired value. Arrays are walked element by element for the same reason: the platform echoes chat history and attached test entries back with extra null fields it filled in itself, and comparing arrays whole reported a difference on every run. Length is still compared, so an added or removed element is still a real difference.

**The agent patch is merged onto live, not sent bare.** The platform replaces a nested object it receives. Sending only the fields this build owns would have dropped the voice, turn taking and widget settings sitting beside them. The CLI read back above is what proves the merge held.

**`prompt.tools` is deleted from the patch.** It is the deprecated inline form of `prompt.tool_ids`. The platform populates it by echoing our own ids back, and then rejects a body carrying both with `both_tools_and_tool_ids_provided`. It caught the second push, not the first, which is exactly the kind of thing an idempotency check exists to find.

## The secret never passes through a session

`TOOL_SHARED_SECRET` is read from the environment by the script, sent once to `POST /v1/convai/secrets`, and never printed, logged, or written to `agent/ids.json`, which stores only the returned `secret_id`. The tool definitions carry our own `{"secret_name": "TOOL_SHARED_SECRET"}` marker in the repository and the script rewrites it to the platform's `{"secret_id": ...}` at push time, so the committed file shows the design without carrying the value.

## Counter argument, weighed rather than dismissed

`tooling-elevenlabs-cli.md` argued that the differentiating engineering here is the tool contracts, the HMAC verification and the observability layer, and that spending code on a solved problem is the opposite of the simplicity constraint. That argument holds for config sync in general and fails here on point 1: the knowledge base is not solved by the CLI, so no amount of adopting it removes the script.
