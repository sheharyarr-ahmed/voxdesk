# VoxDesk

A browser voice concierge. A visitor talks to a conversational agent, asks about services, and the agent answers from a controlled knowledge base, checks live calendar availability, and books a real discovery call during the conversation. Every call is persisted with its transcript, per tool request and response payloads with latencies, and extracted lead fields.

**Status: in development.** The build contract is [SPEC.md](SPEC.md). Nothing below is a claim about a finished system.

## Architecture

The speech loop runs on the ElevenLabs Agents platform. The browser connects to it directly over WebRTC, so this server is never in the audio path. It is reached at four defined points: session token minting, two synchronous tool webhooks during the call, and an HMAC signed post call ingest.

Full breakdown in [SPEC.md](SPEC.md) section 2.

## Stack

Next.js 15 App Router, TypeScript, React 19, Tailwind v4, Zod, Drizzle, Supabase Postgres, Cal.com API v2, Vitest, Playwright, Vercel.

Voice by ElevenLabs.

## Documentation

| Document | Contents |
|---|---|
| [SPEC.md](SPEC.md) | Build contract: goal, interfaces, data model, decisions, verification |
| [docs/BLUEPRINT.md](docs/BLUEPRINT.md) | Pre build source of truth |

## License

MIT. See [LICENSE](LICENSE).
