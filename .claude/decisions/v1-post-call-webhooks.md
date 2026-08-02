# V1 · Post call webhooks configurable on a free workspace

**Date:** 2026-08-02
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** PASS. No fallback taken. Ingest stays push, not pull.

## Question

Connection 4 of SPEC.md §2 is the post call webhook that delivers the transcript, the summary, and the extracted lead fields. If a free workspace cannot register one, ingest has to become a polling loop and the architecture changes.

## Method

Read the workspace webhook surface, then proved the write half by creating a real webhook against a placeholder URL and deleting it.

## Evidence

Read surface, available on free before any change:

```
GET /v1/convai/settings -> 200
{"conversation_initiation_client_data_webhook":null,
 "webhooks":{"post_call_webhook_id":null,"events":["transcript"],
             "transcript_format":"json","send_audio":false},
 "can_use_mcp_servers":false,"rag_retention_period_days":10,
 "default_livekit_stack":"standard","code_tool_allowed_domains":[]}

GET /v1/workspace/webhooks -> 200  {"webhooks":[]}
```

First write attempt failed on **key scope, not plan tier**:

```
POST /v1/workspace/webhooks -> 401
{"type":"authentication_error","code":"unauthorized",
 "status":"missing_permissions",
 "message":"The API key you used is missing the permission webhooks_write"}
```

This distinction matters. A tier gate returns a subscription error. This was the API key being restricted by default, which is the documented ElevenLabs behaviour and is now recorded in `docs/CREDENTIALS.md` §1. Granting the key Webhooks access in the dashboard cleared it.

Body shape took two iterations. The three fields live inside `settings`, not at the top level:

```
{"name":...,"webhook_url":...,"auth_type":...}         -> 422 settings required
{"name":...,"settings":{"webhook_url":...,...}}        -> 422 settings.name required
{"settings":{"name":...,"webhook_url":...,"auth_type":"hmac"}}  -> 200
```

Successful create on the free workspace:

```
POST /v1/workspace/webhooks -> 200
{"webhook_id":"a80f97784e424cd4881ac87273243691","webhook_secret":"wsec_..."}
```

Cleanup:

```
DELETE /v1/workspace/webhooks/a80f97784e424cd4881ac87273243691 -> 200 {"status":"ok"}
GET    /v1/workspace/webhooks -> {"webhooks":[]}
GET    /v1/convai/settings    -> post_call_webhook_id still null
```

Subscription at time of test: `tier: free`.

## Result

Post call webhooks are configurable on a free workspace. `auth_type: "hmac"` is accepted, which is the mode SPEC.md §6.6 verification depends on. The fallback named in SPEC.md §9, adding `src/app/api/cron/poll/route.ts` and turning ingest into a pull, is not taken, and no disclosure is owed in `docs/CLAIMS.md`.

Note that `ingestConversation` is a pure function of the parsed payload with no HTTP concerns precisely so that the poll fallback would remain an addition rather than a rewrite. That property is still worth keeping even though the fallback was not needed.

## Findings that constrain Phase 3

1. **The API key must carry Webhooks write.** ElevenLabs keys are restricted by default. The dashboard exposes this as a single Webhooks toggle with two states, access or no access, rather than separate read and write scopes. Recorded in `docs/CREDENTIALS.md` §1 so a fresh key is created correctly the first time.

2. **The create body nests everything under `settings`.** `{"settings":{"name","webhook_url","auth_type"}}`.

3. **The secret is returned in the create response**, shape `wsec_` followed by 64 hex characters. The ElevenLabs documentation describes it as shown once at creation in the dashboard, which is true there, but the API path returns it too. Phase 3 can therefore create the webhook programmatically. Procedure for doing that without the value landing in a session transcript is in `docs/CREDENTIALS.md` §10.

4. **Registering the webhook is a separate step from pointing the workspace at it.** Creating it leaves `convai/settings.webhooks.post_call_webhook_id` null. Phase 3 must also set that field, or deliveries never fire. Confirmed above: after the probe was created, `post_call_webhook_id` was still null.

5. **Default event set is `["transcript"]` with `transcript_format: "json"` and `send_audio: false`.** That matches what `PostCallPayloadSchema` needs and what SPEC.md §6.5 expects for `analysis.data_collection_results`. Audio stays off, which keeps the payload small and avoids storing voice recordings we have no use for.

## Alternative rejected

A bearer token on the webhook instead of HMAC. HMAC binds the signature to the request body, so a captured header cannot be replayed against a modified payload, and the timestamp inside the signed string bounds replay of the original. A bearer token is a static credential that authenticates the sender and says nothing about the body.
