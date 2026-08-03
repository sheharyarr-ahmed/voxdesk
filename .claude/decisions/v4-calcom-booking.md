# V4 · Cal.com v2 key issues and booking creation permitted

**Date:** 2026-08-03
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** DEFERRED to the Phase 1 deploy. Blocked by a network condition, not by Cal.com and not by the plan.

Recorded as deferred rather than passed. Half the check is answered, half is not, and the split is written out below.

## Question

Two parts. Does a Cal.com v2 API key issue, and does the plan permit creating bookings through it? SPEC.md §4.1 `book_meeting` writes to a real calendar, and BLUEPRINT.md §15 records that a mocked calendar would make the whole tool layer theatre.

## Part one, answered: the key issues

Captured and shape verified on the free plan.

```
CAL_API_KEY        cal_live...f191   ok (41 chars)
CAL_EVENT_TYPE_ID  5725517           (7 chars, digits only)
```

Both were created without hitting a paywall or an upgrade prompt.

## Part two, not answered: booking creation is untested

Every request to Cal.com from this machine is intercepted by Cloudflare bot management before reaching the API. The key was never evaluated.

```
GET https://api.cal.com/v2/slots?eventTypeId=5725517&... -> 403
GET https://api.cal.com/v2/me                            -> 403
GET https://api.cal.com/v1/me?apiKey=...                 -> 403
GET https://app.cal.com/                                 -> 403
GET https://cal.com/                                     -> 403

response headers:
  cf-mitigated: challenge
  server: cloudflare
  cf-ray: a2533bb7bdfd412b-ISB
body: "Just a moment..." interstitial referencing challenges.cloudflare.com
```

Ruled out as causes:

| Hypothesis | Test | Result |
|---|---|---|
| Bad or unscoped API key | `/v2/me` and the unauthenticated site root behave identically | Not the key. The root needs no auth and is still challenged. |
| Missing browser headers | Full set sent: UA, Accept, Accept-Language, sec-ch-ua, sec-fetch-*, Origin, Referer | Still 403. |
| HTTP/2 negotiation | Retried with `--http1.1` | Still 403. |
| v2 API specific | Legacy v1 API tried | Still 403. |
| Local connectivity or curl itself | `GET https://api.github.com/` from the same shell | 200. Connectivity and curl are fine. |

The `-ISB` suffix on the `cf-ray` is the Islamabad edge. This is TLS fingerprint plus IP reputation, which no combination of headers will clear.

Corroborating datum: `WebFetch` against `https://cal.com/docs/api-reference/v2/introduction`, which runs from entirely different infrastructure, also returned 403. So this is broad bot mitigation on the Cal.com zone rather than a condition of one machine or one network.

## What the documentation says, which is not the same as evidence

Cal.com publishes that API access is available on the free plan, that authentication is a Bearer token plus a `cal-api-version` header against `https://api.cal.com`, that the rate limit is 120 requests per minute with API key auth, and that `POST /v2/bookings` is a generally available endpoint rather than a paid feature.

That materially shrinks the risk this check exists to catch. It does not close it. Documentation is not a booking on a calendar.

## Why deferring is acceptable here

The measurement belongs downstream anyway. `src/lib/cal.ts` runs inside a Vercel function, not on a laptop in Rawalpindi, and the Vercel egress path is the one that matters.

SPEC.md §8 Phase 1 already says to create the Vercel project and deploy so that tool URLs point at a stable production domain from the start, and SPEC.md §11.2 already makes a real Cal.com booking the Phase 1 gate. So this resolves near the beginning of Phase 1 rather than at its end, well before the tool contracts harden.

## Residual risk, stated plainly

If Cal.com's Cloudflare configuration also challenges Vercel's datacenter egress, `src/lib/cal.ts` fails in production and the whole booking path is blocked. This is a real possibility and the `WebFetch` 403 above is weak evidence in its favour, since that also originated from a datacenter.

Counterweight: serverless integrations calling `api.cal.com` are the documented and ordinary use of this API, and `api.cal.com` is a distinct hostname from the marketing and docs sites that returned 403 to `WebFetch`. Cloudflare configuration is per hostname.

**This is the first thing to test in Phase 1, before any other Cal.com work.** A single deployed route that calls `GET /v2/slots` and returns the status code answers it in minutes. Do not build out `cal.ts` before that call returns 200.

If it fails from Vercel too, the options in order are a Vercel region change, contacting Cal.com to allowlist the integration, or the SPEC.md §9 fallback of read only availability plus a booking link the agent reads aloud, which would reshape both SPEC.md §4.1 tool contracts and must be disclosed in `docs/CLAIMS.md`.

## Consequence for Phase 1 local development

Local development cannot reach Cal.com from this machine. Vitest coverage of the Cal.com client must mock `fetch` rather than hitting the network, which is correct unit testing practice regardless and is what SPEC.md §8 Phase 1 already implies. The live integration check runs against the deployed URL only.

## Closing condition

This record is updated at the Phase 1 gate with the deployed result, a real `booking_uid`, and the booking visible on the calendar. Verdict moves to PASS or to FALLBACK TAKEN.
