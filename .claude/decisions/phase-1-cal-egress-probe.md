# Phase 1 · Cal.com serves Vercel's egress

**Date:** 2026-08-04
**Verdict:** **PASS.** No challenge on any of the three probes. V4's open half is closed and
V6's deferred production measurement is taken. `src/lib/cal.ts` is cleared to be written.

## The question

V4 established that Cloudflare in front of `api.cal.com` scores the **client fingerprint**, not
the IP: Chrome created a real booking from the same network and the same address where curl is
challenged on every host and path. That correction cut against us, because Vercel functions call
out through Node's undici, which is no more a browser fingerprint than curl's.

SPEC.md §8 and `phase-0-gate-summary.md` both made this the first Phase 1 task, before any of
`src/lib/cal.ts`.

Re-confirmed immediately before the probe, from the development machine:

```
GET https://api.cal.com/v2/slots  ->  403 in 0.32s
```

## Method

One temporary route, `src/app/api/probe/route.ts`, deployed to the production alias and then
deleted. It required `x-vd-tool-secret` to equal `TOOL_SHARED_SECRET`, compared as
sha256 plus `timingSafeEqual`, and hard coded all three targets so it could not be pointed
anywhere. It was never committed, so it does not appear in the repository history.

Two negative controls ran first:

```
GET /api/probe  no header      -> 401, no redirect
GET /api/probe  wrong header   -> 401
```

The absent redirect matters twice over. It proves the probe was never an open endpoint, and it
proves Vercel's Deployment Protection was not intercepting, so a 403 from the probe could only
have come from Cal.com.

## Results

Deployment `dpl_649fai9pNjPruWpejey3Z4UkQur7`, region `iad1`, 2026-08-04T11:35:41Z.
Window 2026-08-05 to 2026-08-07, `Asia/Karachi`.

| Probe | Request | Status | ms | `cf-mitigated` | `cf-ray` |
|---|---|---|---|---|---|
| A | `GET /v2/slots` with `Authorization: Bearer` | **200** | 567 | none | `a25d4289686f0db7-IAD` |
| B | `GET /v2/slots` with no `Authorization` | **200** | 106 | none | `a25d428cbb200db7-IAD` |
| C | `POST /v2/bookings`, deliberately invalid body | **400** | 322 | none | `a25d428d6d080db7-IAD` |

All three returned `content-type: application/json`. `server: cloudflare` is present and
expected, since Cloudflare fronts the origin; the point is that the response came from Cal.com's
application rather than Cloudflare's challenge page.

**The `cf-ray` suffix is `-IAD`.** From the development machine it is `-ISB`, the Islamabad edge,
and every request there is challenged. Same API, same key, different edge and different client,
and the fingerprint scoring does not fire.

### A, the blocking one

```json
{"data":{"2026-08-05":[{"start":"2026-08-05T09:00:00.000+05:00"},
                       {"start":"2026-08-05T09:15:00.000+05:00"}, ...]}}
```

This is also the **first authenticated use of the `CAL_API_KEY` that was rotated after the
screenshot incident**. Every V4 call succeeded unauthenticated, so the replacement had never
been exercised. It works.

That mattered more than it looks. `POST /v2/bookings` sits behind Cal.com's
`OptionalApiAuthGuard`, whose own comment reads "auth is not required but if it is invalid then
still throw error". A bad key would therefore have turned a call that works unauthenticated into
a 401. Probe B exists precisely to separate that failure from a Cloudflare block, and it was not
needed.

### C, the POST path

```json
{"status":"error","timestamp":"2026-08-04T11:35:40.675Z","path":"/v2/bookings",
 "error":{"code":"BadRequestException",
          "message":"voxdeskProbe property is wrong,property voxdeskProbe should not exist , start property is wr..."}}
```

A Cal.com validation error, not a challenge. The body `{"voxdeskProbe": true}` omits every
required field, so no booking could be constructed and nothing reached the calendar.

This incidentally confirms two things the client depends on: the error envelope is
`{status, timestamp, path, error:{code, message}}` with `error.code` carrying the NestJS
exception class name, and `POST /v2/bookings` really does validate with `forbidNonWhitelisted`,
since an unknown property is itself a 400.

## Correction to the recorded wire format

**The slots success body is bare `{"data": {...}}`. There is no `"status":"success"` wrapper.**
The booking *error* body does carry `"status":"error"`. Planning had assumed a uniform
`{status, data}` envelope on both, extrapolating from V4's captured booking 201.

`src/lib/cal.ts` therefore validates slots with a schema that requires only `data` and is
indifferent to any sibling key, which is correct whether or not Cal.com adds one later.

Everything else held. `data` is an object keyed by date, each value an array of `{start}`, and
`start` carries the requested zone's offset rather than a `Z` suffix, exactly as V4 recorded:
`2026-08-05T09:00:00.000+05:00`. The event type serves 15 minute slots from 09:00 `Asia/Karachi`.

## V6 re-measurement, from the deployed function

V6 passed on ten samples taken from Chrome on the development machine in Rawalpindi, and stated
plainly that the figure was "a floor, not the production number", with Phase 1 owing the real
one. Ten sequential `GET /v2/slots` from the `iad1` function, same event type, same window:

```
samples (ms, sorted): 88, 89, 106, 109, 111, 115, 115, 116, 120, 187
p50:  111 ms
p95:  187 ms
```

| | p50 | p95 | margin on the 2500ms abort |
|---|---|---|---|
| Rawalpindi laptop, V6 | 384 ms | 609 ms | 4.1x |
| `iad1` function, here | **111 ms** | **187 ms** | **13.4x** |

Against the 3s route budget the p95 margin is 16x. The prediction that the laptop path was worse
on every axis that matters was correct, and by a factor of three. No fallback is taken and the
60s cache window in SPEC.md §6.2 stays as written.

## Consequences

1. **The SPEC.md §9 V4 fallback is not taken.** Both §4.1 tool contracts stand as written and
   nothing is owed in `docs/CLAIMS.md`.
2. **`src/lib/cal.ts` sends the key.** It works, and authenticated calls get their own rate limit
   bucket; unauthenticated, Cal.com's throttler buckets by `cf-connecting-ip`, which on Vercel is
   shared with every other customer on that egress address.
3. **The escape hatch stays.** `env.CAL_API_KEY` defaults to empty and the header is omitted when
   blank, so if the key is ever revoked, clearing one Vercel variable restores the working
   unauthenticated path with no code change.
4. **Live Cal.com checks run against the deployed URL, not this machine.** Unit coverage mocks
   `fetch`, which is correct practice regardless.

## Cleanup

The probe route was deleted, production redeployed, and `/api/probe` confirmed to return 404.
No booking was created. No secret was printed, in a tool result or anywhere else.
