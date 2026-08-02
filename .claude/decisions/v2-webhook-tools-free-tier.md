# V2 · Webhook tools available on free tier

**Date:** 2026-08-02
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** PASS. No fallback taken.

## Question

Are webhook tools, the server side tools ElevenLabs calls synchronously mid conversation, available on a free workspace? Connection 3 of the SPEC.md §2 architecture depends entirely on this.

## Method

Created a real standalone webhook tool against the live free workspace via `POST /v1/convai/tools`, then deleted it.

## Evidence

First attempt returned `422` with two validation errors, not a tier rejection:

```
{"detail":[
  {"loc":["body","tool_config","webhook","response_timeout_secs"],
   "msg":"Input should be greater than or equal to 5","input":3,"ctx":{"ge":5}},
  {"loc":["body","tool_config","webhook","api_schema"],
   "msg":"Value error, POST method requires request_body_schema"}]}
```

Corrected attempt returned `200` with a real tool id:

```
POST /v1/convai/tools -> http=200
{"id":"tool_3901kz11m9nvecs8s5y2byx5wjv1",
 "tool_config":{"type":"webhook","name":"v2_probe","response_timeout_secs":5,
   "execution_mode":"immediate",
   "api_schema":{"url":"https://example.com/probe","method":"POST",
     "request_headers":{"x-vd-tool-secret":"probe"}, ...}}}
```

Cleanup confirmed:

```
DELETE /v1/convai/tools/tool_3901kz11m9nvecs8s5y2byx5wjv1 -> http=204
GET /v1/convai/tools -> {"tools":[],"next_cursor":null,"has_more":false}
```

Subscription at time of test: `tier: free`, `status: free`.

## Result

Webhook tools are not gated on the free tier. The fallback named in SPEC.md §9, client tools executing in the browser and calling our routes, is not taken. The SPEC.md §2 architecture stands as written, and no disclosure is owed in `docs/CLAIMS.md`.

## Two findings that constrain Phase 2

1. **`response_timeout_secs` has a platform minimum of 5.** SPEC.md §6.2 sets our own budget at 3s for the route and 2500ms for the Cal.com fetch. Those stay. The platform value is a ceiling, not a target, so both tool definitions in `agent/tools/*.json` will declare `5` while the route continues to answer inside 3s and return a structured `ok: false` on its own abort. The two numbers are not in conflict, but the tool JSON cannot declare `3` because the API rejects it.

2. **A `POST` tool requires `request_body_schema`.** Both SPEC.md §4.1 tools are `POST`, so both tool definitions must carry a full body schema. The shared secret goes in `api_schema.request_headers`, which the API accepted, confirming the `x-vd-tool-secret` header approach in SPEC.md §4.1 is supported.

## Alternative rejected

Client side tools running in the browser. They would put tool execution on the visitor's machine, which means the shared secret cannot defend the route, the latency is unobservable from the server, and `tool_invocations` would record whatever the client chose to report. The whole observability claim rests on the server seeing the call.
