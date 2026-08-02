# V7 · Knowledge base document indexes with RAG

**Date:** 2026-08-02
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** PASS. No padding needed, nothing fabricated to hit a byte count.

## Question

ElevenLabs will not build a RAG index for a document under 500 bytes. It silently falls back to inlining the document in the prompt instead. SPEC.md §12 lists "a RAG knowledge base so answers come from a controlled document rather than model priors" as claimable, so this needs to be true rather than assumed.

## Method

Uploaded the real `agent/knowledge/sherylabs.md`, triggered indexing, polled to a terminal state, then read back the document and the workspace index totals.

## Evidence

Upload:

```
POST /v1/convai/knowledge-base/text -> http=200  time=0.89s
{"id":"CgTt6RU8cZj1519ZGoUU","name":"sherylabs","folder_path":[]}
```

Index trigger and terminal state:

```
POST /v1/convai/knowledge-base/CgTt6RU8cZj1519ZGoUU/rag-index
  {"model":"e5_mistral_7b_instruct"} -> http=200

GET  /v1/convai/knowledge-base/CgTt6RU8cZj1519ZGoUU/rag-index
{"indexes":[{"id":"ZUXaCwee9tnYAo5BoPxw","model":"e5_mistral_7b_instruct",
             "status":"succeeded","progress_percentage":100.0,
             "document_model_index_usage":{"used_bytes":3845}}]}
```

Document size, local and remote agree:

```
wc -c agent/knowledge/sherylabs.md  ->  3845
metadata.size_bytes                 ->  3845
```

3845 bytes against a 500 byte floor, so the margin is 7.7x and no padding was required.

Workspace capacity on the free tier:

```
GET /v1/convai/knowledge-base/rag-index
{"total_used_bytes":3845,"total_max_bytes":1048576,
 "models":[{"model":"e5_mistral_7b_instruct","used_bytes":3845}]}
```

Agent attachment:

```
knowledge_base: [{"type":"text","name":"sherylabs",
                  "id":"CgTt6RU8cZj1519ZGoUU","usage_mode":"auto"}]
rag.enabled: True   embedding_model: e5_mistral_7b_instruct
```

## Resolved remote ids

Recorded here rather than in `agent/ids.json`, because `ids.json` is written by `agent/push.ts` in Phase 2 and that file is outside the Phase 0 file list.

| Entity | Id |
|---|---|
| Knowledge base document | `CgTt6RU8cZj1519ZGoUU` |
| RAG index | `ZUXaCwee9tnYAo5BoPxw` |
| Agent | `agent_1401kz0x1h1xfsk8x4vh5hxpjezg` |

Phase 2 `push.ts` resolves by name, so re running is idempotent and these ids are reference, not input.

## Two operational findings

1. **Free tier caps indexed content at 1 MB total** and the ElevenLabs RAG documentation notes that indexes may be deleted after inactivity. The workspace also reports `rag_retention_period_days: 10`. At 3845 bytes the size cap is irrelevant, but the retention window is not: if the demo sits unused for a stretch, the index may need recomputing before a vetting call. Worth a line in `docs/DEPLOY_CHECKLIST.md` at Phase 4.

2. **RAG adds roughly 250ms to agent response latency** per the ElevenLabs documentation. That sits alongside the SPEC.md §6.2 tool budget rather than inside it, since retrieval and tool execution are separate steps, but it is part of the perceived turn latency.

## Open item, stated rather than claimed

The index exists and succeeded, which is exactly what V7 asks and is where the PASS comes from. Whether retrieval fires at runtime or the platform inlines the document is a separate question and was not established here. The document reports `supported_usages: ["prompt","auto"]` and is attached with `usage_mode: "auto"`, which leaves the choice to the platform, and `rag_retrieval_info` came back `null` on every turn of the simulated conversation, which may simply mean the simulation surface does not populate that field.

This is re testable at the Phase 2 gate, where a live conversation populates `rag_retrieval_info`. Until that shows a retrieval with chunks, `docs/CLAIMS.md` should say the knowledge base is a controlled document that is RAG indexed, and should not assert that every answer was retrieved rather than inlined. The distinction costs nothing to state and is the kind of thing a technical buyer asks about.
