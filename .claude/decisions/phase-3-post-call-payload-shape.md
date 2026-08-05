# Phase 3 · The post call payload shape, checked against a real call

**Date:** 2026-08-05
**Phase:** 3, before any of the ingest code was written
**Source:** `conv_6701kz8fyrk5fzbre5jprd6s5hbk`, the Phase 2 gate call, read back from
`GET /v1/convai/conversations/{id}`

## Why this was checked rather than assumed

A post call webhook cannot be replayed. There is no resend, replay or redeliver
endpoint on the ElevenLabs API, and `retry_enabled` retries only a delivery that was
already attempted. So a payload the schema gets wrong is a transcript lost for good,
and the usual write it, watch it fail, fix it loop is not available.

Everything below was therefore confirmed against a captured real payload before
`PostCallPayloadSchema` was written.

## Three findings

### 1 · The webhook body is wrapped and the GET response is not

The webhook body is:

```json
{ "type": "post_call_transcription", "event_timestamp": 1785917964, "data": { ... } }
```

`GET /v1/convai/conversations/{id}` returns the bare conversation object. Its top level
keys are `agent_id, agent_name, conversation_product, status, user_id, branch_id,
version_id, metadata, analysis, visited_agents, conversation_initiation_client_data,
environment, conversation_id, has_audio, transcript, tag_ids, ...`. There is no `type`,
no `event_timestamp` and no `data`.

`tests/fixtures/post-call.json` is therefore the GET response projected to the fifteen
keys the documented `data` object carries, then wrapped. A fixture built from the GET
without wrapping parses against nothing, and `tests/unit/ingest.test.ts` asserts exactly
that so the point is pinned rather than remembered.

### 2 · `analysis.data_collection_results` is a map of objects, not a map of scalars

```json
"budget_band": {
  "data_collection_id": "budget_band",
  "value": "production_build",
  "json_schema": { "type": "string", "description": "...", "enum": null },
  "rationale": "The agent explicitly states, \"That sounds like a production build...\""
}
```

Every field is read through `.value`. An unset field arrives as an object whose `value`
is `null` rather than as a missing key, which is what `company` looks like on this call
because the visitor never named one. Reading an entry as a scalar would write
`[object Object]` into a text column, which looks like data rather than like a bug.

### 3 · The transcript carries the tool shared secret header, and this one was not expected

Turns that call a tool carry `tool_calls[].tool_details`, and `tool_details.headers`
holds `x-vd-tool-secret`:

```json
"tool_details": {
  "type": "webhook", "method": "POST",
  "url": "https://voxdesk-seven.vercel.app/api/tools/availability",
  "headers": { "x-vd-tool-secret": "<REDACTED>" },
  "body": "{\"conversation_id\": \"conv_6701...\", \"timezone\": \"Asia/Karachi\"}"
}
```

ElevenLabs redacted the value to the literal string `<REDACTED>` on the GET surface. The
webhook is a different surface and the redaction is a vendor policy that can change, so
nothing here depends on it.

`conversations.transcript` is a `jsonb` column that `/calls/[id]` renders, so
`TranscriptTurnSchema` declares only `role`, `message`, `time_in_call_secs` and a narrow
tool call and tool result projection. Zod strips keys it was not told about, so **not
declaring `tool_details` is the mechanism that keeps the secret out of the database.**
This is a security boundary, not a size optimisation, and the unit suite asserts both
that the persisted transcript contains neither `tool_details` nor `x-vd-tool-secret`,
and that the source payload does contain the header, so the assertion cannot pass
vacuously.

## Smaller shape facts the schema has to survive

| Fact | Value on this call |
|---|---|
| `message` is null on a tool call or tool result turn | 6 of 22 turns |
| `analysis.evaluation_criteria_results` | `{}`, no criteria declared |
| `metadata.start_time_unix_secs` | 1785917825 |
| `metadata.call_duration_secs` | 139, and there is no end timestamp, so `ended_at` is derived |
| `data.status` | `"done"` |
| `analysis.call_successful` | `"success"`, a separate axis from `status` |

## Two design consequences

**Status mapping, Deviation 18.** SPEC.md §5.1's SQL sets `status = 'completed'`
unconditionally, while §5 declares the column as `in_progress | completed | failed`.
This route is the only writer that could ever set `failed`, so without a mapping a
declared state is unreachable. `data.status === 'done'` maps to `completed` and anything
else to `failed`.

**`analysis` is optional.** A conversation that ends before analysis can run omits the
block entirely, which is what a zero turn failed connect produces. Requiring it would
answer 400, and ElevenLabs does not retry a 4xx, so a recoverable payload would be lost
to a shape rule that bought nothing. The distinction is carried through to the page: no
`lead_captures` row means extraction never ran, a row of six nulls means it ran and the
visitor volunteered nothing, and `/calls/[id]` says those two things differently.

## Alternative rejected

Storing the raw `data.transcript` array unchanged, which is what SPEC.md §5 implies by
declaring `transcript jsonb` with no further detail. It is simpler and it is wrong here:
it would put a live shared secret into a column that a page renders, and it would carry
about 32 KB of mostly null vendor fields per call for no read that ever happens.
