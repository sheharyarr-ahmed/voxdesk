# SheryLabs

SheryLabs is an AI native software studio. Sheharyar Ahmed, who goes by Shery, is the founder and the engineer on every build. Engagements are remote and run with a single architect rather than a handoff chain, so the person who scopes the work is the person who ships it.

## What SheryLabs builds

Four practice areas.

**Web applications.** TypeScript across the stack. Next.js App Router, React, Node, MongoDB or Postgres. Server actions rather than a REST layer where the framework supports it. Drizzle for typed database access. Tailwind for styling. Vitest for unit coverage and Playwright for end to end.

**Native iOS.** Swift and SwiftUI only. SheryLabs does not build Android, React Native, or Flutter, and does not write Objective C. If a project needs Android, SheryLabs is the wrong studio and will say so on the first call.

**AI and agent systems.** Python and TypeScript. Retrieval over a controlled document set rather than model priors, so answers come from a source you can audit. Tool calling, so an agent takes real actions in real systems instead of only producing text. Observability on every agent run, meaning the request payload, the response payload, and the latency of each tool call are persisted and inspectable after the fact. Graceful degradation and bounded retry rather than an agent that improvises when an upstream call fails.

**Marketing engineering.** Landing pages, analytics instrumentation, and the measurement layer that tells you whether a launch worked.

## Voice agents

Voice agent work is the current focus. A typical build covers the conversation design, the tool contracts the agent calls mid conversation, calendar or CRM integration, webhook ingestion with signature verification before anything is persisted, the data model behind the transcript, and a dashboard showing what the agent actually did rather than only what it said.

## How engagements are structured

Three phases. A project can stop after any of them.

**Phase one, discovery and tool contract mapping.** One week. 750 to 1,500 US dollars. Output is the conversation design, the list of systems the agent has to touch, and the request and response shape of every tool the agent will call. This phase exists so phase two is not a discovery exercise billed at build rates.

**Phase two, production build.** Four to six weeks. 4,000 to 8,000 US dollars. The working agent, integrated with the real systems mapped in phase one, deployed, with observability and tests.

**Phase three, retainer.** Monthly. 1,000 to 2,500 US dollars. New conversation flows, additional integrations, and prompt tuning as the agent meets real users.

These are engagement bands, not fixed prices. The number inside a band moves with integration count and system complexity, and it is set at the end of phase one when the scope is actually known.

## What SheryLabs does not do

- Android, React Native, Flutter, or Objective C.
- Design only engagements with no build attached.
- Staff augmentation or hourly placement inside another team's backlog.
- Any claim that cannot be defended on a call.

## About this demo

You are talking to VoxDesk, a portfolio build. The speech loop runs on the ElevenLabs Agents platform, which owns speech to text, the language model, turn taking, and text to speech. The SheryLabs layer is the tool contracts, the calendar integration, the webhook signature verification, the data model, the observability dashboard, and the conversation design.

VoxDesk runs on a free tier that carries no commercial license, so it is a portfolio artifact rather than a live product. There is no phone number and no telephony behind it. Voice by ElevenLabs. The source is public.

## Contact

- Site: sherylabs.com
- Email: ping@sherylabs.tech
- Booking: cal.com/sheharyar-ahmed
- Source: github.com/sheharyarr-ahmed
