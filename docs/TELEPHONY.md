# TELEPHONY

**Nothing in this document is built.** No Twilio account, no phone number, no PSTN
trunk, no SIP configuration, not even a stub. SPEC.md section 10 puts telephony out of
scope and `docs/CLAIMS.md` forbids claiming it in any framing.

This file exists so that "can it answer a phone" has a real answer instead of a shrug.

---

## What would actually change

Less than people expect, and that is the interesting part.

The architecture already separates the speech loop from the business logic. ElevenLabs
owns speech to text, the model, turn taking and text to speech. Our server is reached at
four points, and **only one of them is browser shaped**.

| Connection | Browser today | Over a phone | Changes |
|---|---|---|---|
| 1, live conversation | WebRTC from our React client | SIP trunk into the platform | **Replaced** |
| 2, session auth | `POST /api/session` mints a conversation token | Not used. An inbound call is authorised by the trunk | **Removed** |
| 3, tool calls | ElevenLabs to our routes | Identical | **Nothing** |
| 4, post call ingest | ElevenLabs to our webhook | Identical | **Nothing** |

So `src/lib/cal.ts`, both tool routes, `src/lib/tool-log.ts`, `src/lib/ingest.ts`, the
webhook route, the schema and both dashboard pages are untouched. The agent prompt, the
tool definitions and the knowledge base are untouched.

This is not a lucky accident. It is what section 2's invariant buys: because the server
was never in the audio path, changing the audio path does not reach the server.

## What would have to be built

1. **A number and a trunk.** A phone number from a provider, connected to the agent as an
   inbound SIP trunk on the ElevenLabs side.
2. **A different gate.** The passcode gate in section 6.1 defends `POST /api/session`, and
   a phone call never touches that route. Inbound voice would need its own quota defence,
   most likely an allowlist of numbers or a per number rate limit, because otherwise the
   number is a public unauthenticated door to metered minutes. This is the real work, and
   it is the same problem the browser demo already solved once.
3. **Timezone without a browser.** Section 6.4 reads
   `Intl.DateTimeFormat().resolvedOptions().timeZone` from the visitor's browser. A caller
   has no browser. The zone would come from the number's country code as a default, with
   the agent confirming it aloud, which section 6.4 rejected for the browser precisely
   because a browser can answer the question without asking.
4. **A different email path.** Section 6.3 falls back to a typed field in the page when
   speech to text mangles an address. There is no page on a phone call. The fallback would
   become a text message with a link, which is a second provider and a second cost.

## Why it is not built

Three reasons, in order of weight.

**It costs money.** Phone numbers and per minute telephony are paid, and this build's
binding constraint is zero cash and no card on file.

**It would not demonstrate anything new.** The claims this build supports are about tool
integration, verified ingest, observability and configuration as code. All four are
identical over a phone. A telephony demo would cost real money to prove the same points.

**The honest version is more useful than a half wired one.** A stubbed SIP configuration
that has never carried a call is worse than this document, because it invites the claim.

## What is claimable about it

Only this: **the architecture is transport independent, and here is the table showing
which files would change.** That is a design property, and it is demonstrable by reading
the four connection points.

Not claimable: telephony experience, phone support, IVR, call centre work, or any
suggestion that a phone number exists.
