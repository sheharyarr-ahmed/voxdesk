# Phase 0 gate · Text conversation answers three service questions from the KB

**Date:** 2026-08-02
**Phase:** 0 acceptance gate, SPEC.md §8, condition 1 of 2
**Verdict:** PASS. Transcript recorded verbatim below rather than asserted.

## What the gate asks

"A text console conversation answers three service questions correctly from the KB."

## Setup under test

| | |
|---|---|
| Agent | `agent_1401kz0x1h1xfsk8x4vh5hxpjezg`, `VoxDesk Concierge` |
| System prompt | `agent/prompts/system.md`, 4919 bytes, byte identical to the file |
| Knowledge base | `agent/knowledge/sherylabs.md`, 3845 bytes, doc `CgTt6RU8cZj1519ZGoUU` |
| RAG | enabled, `e5_mistral_7b_instruct`, index `succeeded` at 100% |
| LLM | `gemini-2.5-flash`, the free tier default |
| Instrument | `POST /v1/convai/agents/{agent_id}/simulate-conversation`, `http=200` in 11.1s |

## The three questions and why each was chosen

1. **"What do you actually build?"** Tests plain recall from the knowledge base service list rather than model priors.
2. **"How do you charge, and how long does a first engagement run?"** Tests the engagement bands, the one place the agent speaks real figures, and the SPEC.md §6.5 `budget_band` lead field depends on the agent being able to discuss this at all.
3. **"Can you build me an Android app?"** Tests the refusal rule. A model answering from priors will hedge or agree, since a generic assistant has no reason to refuse. A clean no is evidence the controlled document is driving the answer.

## Transcript, verbatim

> **AGENT:** Hi, you have reached SheryLabs. What are you working on?
>
> **USER:** What do you actually build?
>
> **AGENT:** SheryLabs specializes in four practice areas: web applications, native iOS development, AI and agent systems, and marketing engineering. We focus on building robust and integrated solutions in these fields.
>
> **USER:** How do you charge, and how long does a first engagement run?
>
> **AGENT:** Engagements are structured in three phases. The first phase, discovery and tool contract mapping, typically runs for one week and costs between seven hundred fifty to one thousand five hundred US dollars. This phase helps define the scope for the next steps.
>
> **USER:** Can you build me an Android app?
>
> **AGENT:** No, SheryLabs does not build Android applications. We also do not work with React Native, Flutter, or Objective C. If your project has a web, iOS, or AI component, we can discuss that further.
>
> **USER:** Thanks, that is all I needed.
>
> **AGENT:** You're welcome. If you have any other questions or would like to discuss a project that aligns with SheryLabs' expertise, feel free to reach out. You can find more information on sherylabs dot com or email ping at sherylabs dot tech.

## Assessment against the knowledge base

| # | Correct | Grounding |
|---|---|---|
| 1 | Yes | Four practice areas returned exactly as listed in `sherylabs.md`. No invented fifth area. |
| 2 | Yes | Three phase structure, one week, and the 750 to 1,500 band, all matching the document. Figures spoken as words, which is correct for a voice surface. |
| 3 | Yes | Clean refusal with no hedging, the full exclusion list reproduced, and the conditional re offer exactly as the prompt instructs. |

Platform analysis agreed: `analysis.call_successful: "success"`.

## Two prompt behaviours that carried through and are worth keeping

The spoken URL rule held. The agent said "sherylabs dot com" and "ping at sherylabs dot tech" rather than spelling characters, which is the `agent/prompts/system.md` instruction working on the first run with no tuning.

The refusal was stated as a flat no rather than softened, which is the specific failure mode the rule was written against.

## One item to tune in Phase 2, not a gate failure

On question 2 the agent described phase one only and stopped, rather than covering all three bands and then offering the call. The prompt says to offer the discovery call once the project is understood. Here the simulated user gave it nothing to work with by design, so there was no project to understand and no natural booking moment. Worth re running against a simulated user that actually describes a project, which is Phase 2 tuning work and costs no minutes per the V3 finding.

`analysis.data_collection_results` came back `{}`, which is expected: the six lead fields are declared as `analysis.data_collection` in `agent/agent.config.json` and pushed in Phase 2, and the simulated user was instructed to volunteer nothing.

## Reproducing this

The request body is `simulation_specification.simulated_user_config` with `first_message`, `language: "en"`, and a `prompt.prompt` instructing the simulated user to ask the three questions in order and volunteer nothing. Costs nothing per the V3 measurement, so it can be re run freely after any prompt edit.
