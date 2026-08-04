# V4 · Cal.com v2 key issues and booking creation permitted

**Date:** 2026-08-03, closed 2026-08-04
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** **PASS, both halves closed.** The plan permits booking, evidenced by a real booking on 2026-08-03. Cal.com serves Vercel's egress without a challenge, evidenced by the Phase 1 probe on 2026-08-04. Full record in `phase-1-cal-egress-probe.md`.

Supersedes the earlier deferral in this file's history. The deferral was correct given curl evidence alone and wrong once a browser was tried.

## Question

Two halves. Does a Cal.com v2 API key issue, and does the plan permit creating bookings through the v2 API? SPEC.md §4.1 `book_meeting` writes to a real calendar, and BLUEPRINT.md §15 records that a mocked calendar would make the whole tool layer theatre.

## Result, half one: the key issues

```
CAL_API_KEY        cal_live...     ok (rotated once, see note)
CAL_EVENT_TYPE_ID  5725517
```

Created on the free plan with no paywall and no upgrade prompt.

## Result, half two: booking creation is permitted

A real booking was created and then cancelled against the live calendar.

```
POST /v2/bookings   -> 201
{"status":"success","data":{
  "id":23284338,
  "uid":"babGzAoN9YXJ4FnXz1bpq1",
  "title":"15 min meeting between Sheharyar Ahmed and VoxDesk V4 Probe",
  "status":"accepted", ...}}

POST /v2/bookings/babGzAoN9YXJ4FnXz1bpq1/cancel -> 200
GET  /v2/bookings/babGzAoN9YXJ4FnXz1bpq1        -> 200, status "cancelled"
```

The SPEC.md §9 fallback, read only availability plus a booking link the agent reads aloud, is **not taken**. Both SPEC.md §4.1 tool contracts stand as written and nothing is owed in `docs/CLAIMS.md`.

## How the Cloudflare block was actually characterised

The earlier finding, that Cal.com was unreachable, was true only of curl. The correction matters because it changes the remaining risk.

| Client | Result |
|---|---|
| curl, any headers, HTTP/1.1 or /2, v1 or v2 | 403, `cf-mitigated: challenge` |
| WebFetch, separate infrastructure | 403 on `cal.com/docs` |
| Chrome, top level navigation to `api.cal.com` | **200, real API JSON** |
| Chrome, same origin fetch from `api.cal.com` | **200 and 201** |

So Cloudflare is not blocking the IP or the network. It is scoring the **client fingerprint**, and curl is a known bot signature. Chrome from the identical network and identical IP passes without a challenge.

The cross origin attempt from `app.cal.com` failed with `TypeError: Failed to fetch`. That was CORS, not Cloudflare. Running from the `api.cal.com` origin itself makes the request same origin and removes the problem entirely, which is what produced the results above.

## The half that was open, now closed

**Will Cal.com serve Vercel's egress? Yes.** Settled on 2026-08-04 by a temporary route deployed to the production alias. `GET /v2/slots` returned **200** with and without the API key, and `POST /v2/bookings` with a deliberately invalid body returned a **400 from Cal.com's own validator**, so the POST path reaches the origin too. No `cf-mitigated` header on any of the three. The `cf-ray` suffix was `-IAD` rather than the `-ISB` Islamabad edge that challenges this machine. Evidence in `phase-1-cal-egress-probe.md`.

The rotated key also authenticated on first use, which mattered more than it looks: `POST /v2/bookings` sits behind Cal.com's `OptionalApiAuthGuard`, so an invalid key would have turned a call that works unauthenticated into a 401.

The reasoning that kept this open is preserved below, because the counterweight turned out to be the correct read and the record should show which way the evidence pointed beforehand.

**Will Cal.com serve Vercel's egress?** Unverified at the time, and the finding above cut against us rather than for us.

The block is fingerprint based, not IP based. Vercel functions call out through Node's `fetch`, which is undici, and undici's TLS fingerprint is not a browser fingerprint any more than curl's is. The evidence no longer supports "it was just a bad IP, datacenters will be fine". It supports "non browser clients get scored, and one of them was blocked outright".

Counterweight, and it is real: server side integrations calling `api.cal.com` are the ordinary documented use of this API, and Cal.com would not have a functioning platform business if undici were challenged. curl is singled out by Cloudflare's signature database in a way undici is not.

**This was the first thing tested in Phase 1.** Deploy one route calling `GET /v2/slots` and check for 200 before building out `src/lib/cal.ts`. It returned 200, so none of the escalation options were needed: no Vercel region change, no allowlist request, no §9 fallback.

## API surface findings that de risk Phase 1

Learned from the live calls, and each one would otherwise have cost debugging time in Phase 1.

1. **v2 uses header based API versioning.** Without `cal-api-version` the request 404s with `NotFoundException: Cannot GET /v2/slots`. A missing header looks exactly like a wrong URL. Slots use `2024-09-04`; bookings and cancel use `2024-08-13`.

2. **`GET /v2/slots` and `POST /v2/bookings` are public for a public event type.** Both succeeded with **no `Authorization` header at all**. The API key was never sent in any call recorded here. This is ordinary Cal.com behaviour, since a public booking link is public by definition, but it has two consequences worth stating: `CAL_EVENT_TYPE_ID` is not a secret, and the `x-vd-tool-secret` header on our own tool routes is doing all the work of keeping those routes from being open endpoints.

   **`src/lib/cal.ts` should still send the key.** Relying on an endpoint being public is relying on a policy that can tighten without notice, and authenticated calls are what the dashboard read path in Phase 3 will need regardless.

3. **Slots come back in the requested timezone with an offset, not in UTC.** Observed `2026-08-04T09:00:00.000+05:00`. SPEC.md §6.4 requires `start_utc` to be UTC on the wire, so `src/lib/slots.ts` must convert. `new Date(local).toISOString()` produced `2026-08-04T04:00:00.000Z` and booking with that UTC form was accepted, which confirms the round trip.

4. **Response shapes.** Slots: `data` is an object keyed by date, each value an array of `{start}`. Booking: `data.uid`, `data.id`, `data.status`. Cancel: `POST /v2/bookings/{uid}/cancel` with `{cancellationReason}`.

   **Corrected 2026-08-04.** The slots success body is bare `{"data": {...}}` with **no** `"status":"success"` wrapper, unlike the booking response captured above. Assuming a uniform envelope across both endpoints would have made `src/lib/cal.ts` reject every valid slots response. Errors do carry `status`, in the form `{status:"error", timestamp, path, error:{code, message}}` where `error.code` is the NestJS exception class name. Also confirmed: both endpoints validate with `forbidNonWhitelisted`, so an unknown property or query parameter is itself a 400.

5. **The event type has real availability**, 15 minute slots from 09:00 `Asia/Karachi`. Good enough for a demo without further configuration.

## Note on the key

The original key was exposed in a screenshot during troubleshooting and was rotated immediately. The replacement had not been exercised at the time this was written, since every V4 call succeeded unauthenticated. **First authenticated use was the Phase 1 probe on 2026-08-04, and it returned 200.** The key is good.

## Closing condition

Met. `GET /v2/slots` returned 200 from the deployed Vercel function on 2026-08-04. Both halves closed. See `phase-1-cal-egress-probe.md`.
