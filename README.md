# VoxDesk

A browser voice concierge. A visitor talks to a conversational agent, asks about services, and the agent answers from a controlled knowledge base, checks live calendar availability, and books a real discovery call during the conversation. Every call is persisted with its transcript, per tool request and response payloads with latencies, and extracted lead fields.

**Portfolio artifact, not a commercial deployment.** It runs on the ElevenLabs free tier, which carries no commercial licence and caps the account at 15 agent minutes a month. Every claim below is traced to [docs/CLAIMS.md](docs/CLAIMS.md), and anything not in that file is not claimed.

**Live at [voxdesk-seven.vercel.app](https://voxdesk-seven.vercel.app).** The demo is passcode gated, because voice minutes are metered and the gate is what stops open tabs draining the month. Ask for the passcode. [Screenshots of the running application](docs/screenshots/) are in the repository if you would rather just look.

## Architecture

The speech loop runs on the ElevenLabs Agents platform. The browser connects to it directly over WebRTC, so this server is never in the audio path. It is reached at four defined points: session token minting, two synchronous tool webhooks during the call, and an HMAC signed post call ingest.

Because the server was never in the audio path, the audio path is replaceable. [docs/TELEPHONY.md](docs/TELEPHONY.md) shows which files a phone number would change, and which would not.

All SDK usage sits behind one adapter, so the whole console can be driven by a scripted fake in tests. The end to end suite exercises every console state at zero platform traffic and zero voice minutes, which matters when minutes are the binding constraint.

## What is verified, and what is not

The interesting part of this build is the evidence, not the feature list. Every result is written up in a decision record committed alongside the code, with the alternative that was considered and the reason it was rejected.

Proven by connecting rather than by reading the code: a spoken call booked a real calendar event in 2 minutes 19 seconds; an unsigned webhook POST returns 401 with the row counts unchanged; a valid signature over a tampered body is rejected and writes nothing; ingest is idempotent across four identical signed deliveries; an unauthenticated connection to the agent is refused at the application layer; and a delivery signed by ElevenLabs, rather than by this repository, is accepted and persisted.

Stated narrowly on purpose: retrieval ran against the controlled document and the platform attributed one answer to a specific retrieved chunk, which is not the same as claiming every answer is grounded. The console reports a browser observed tool round trip, which is a different span from the latency measured inside the route and shown in the call log.

Recorded because it was expensive to learn: the platform exposes no replay, resend or test delivery endpoint, so the signing construction could only ever be confirmed by a real call. Verifying against a signature you generated yourself proves the verifier and not the construction, and that gap was carried openly for two phases rather than papered over.

## Stack

Next.js 15 App Router, TypeScript, React 19, Tailwind v4, Zod, Drizzle, Supabase Postgres, Cal.com API v2, Vitest, Playwright, Vercel.

Voice by ElevenLabs.

## Verification

`pnpm verify:all` runs typecheck, 102 unit tests, a copy check, and 18 end to end tests. [docs/DEPLOY_CHECKLIST.md](docs/DEPLOY_CHECKLIST.md) carries the pre demo checks, including the one that silently voids the central claim if it is skipped.

## Deliberately not built

Telephony, a custom LLM bridge, outbound calling, multi language, CRM push, authentication beyond the passcode, the embed widget, and any paid tier. None of these are stubbed or partially wired. [SPEC.md](SPEC.md) section 10 is the full list.

## Documentation

| Document | Contents |
|---|---|
| [SPEC.md](SPEC.md) | Build contract: goal, interfaces, data model, decisions, verification |
| [docs/CLAIMS.md](docs/CLAIMS.md) | What may and may not be claimed, and the evidence for each |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The invariant, write ordering, and the bridge that was not built |
| [docs/DEPLOY_CHECKLIST.md](docs/DEPLOY_CHECKLIST.md) | Pre demo checks, environment, and traps that shipped green once |
| [docs/TELEPHONY.md](docs/TELEPHONY.md) | A path, explicitly not a claim |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Numbered capture guide for every secret |
| [docs/BLUEPRINT.md](docs/BLUEPRINT.md) | Pre build source of truth |

## License

MIT. See [LICENSE](LICENSE).
