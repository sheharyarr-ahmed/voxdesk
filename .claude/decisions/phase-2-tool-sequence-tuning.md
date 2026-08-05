# Phase 2 · Tuning the tool sequence against committed tests

**Date:** 2026-08-05
**Phase:** 2

## The confirmation that made the rest of the phase safe

Before spending any of the voice budget, the open question was whether ElevenLabs would call our server side tools when the other end of the audio is not our browser client. The SPEC.md §2 architecture says the client cannot matter, since connection 3 is ElevenLabs' backend to our HTTPS route. That is reasoning, not evidence.

The evidence is a text simulation, run entirely inside the ElevenLabs backend with no browser anywhere, read back out of **our own database**:

```
2026-08-05T07:31:45Z  test-trun_0401kz8db6pkfrjrsadm9sexwwm7  check_availability  2513 ms  200
2026-08-05T07:31:47Z  test-trun_0401kz8db6pkfrjrsadm9sexwwm7  check_availability   140 ms  200
2026-08-05T07:32:02Z  test-trun_0401kz8db6pkfrjrsadm9sexwwm7  book_meeting        2211 ms  200
```

and a real booking on the real calendar, `dk3eHX5iJ91woijr6P2GAg`, `2026-08-05T09:45:00.000Z`, `dana.whitfield@example.com`, with the `conversations` and `bookings` rows to match.

Three things fall out of it.

1. Server side tools do not care what the client is. The dashboard test call is therefore a legitimate route to the Phase 2 gate, and V5 is not blocked by it, only unaddressed by it.
2. `{{system__conversation_id}}` resolves inside a simulation, to `test-trun_...`. That was the one flagged unknown. Had it come back empty, `conversation_id` is `z.string().min(1)` and every tool call would have been a 400 with no `speak` line.
3. The 60 s slots cache is visible in production: 2513 ms cold, 140 ms warm, one conversation. V6 deferred the warm path measurement and here it is, incidentally.

## The suite

Five simulations, committed under `agent/tests/`, pushed and attached to the agent by `pnpm agent:push`. This is an addition to the SPEC.md §4 tree, recorded as a deviation. It earns its place because the deterministic tool mock is what found the defect below, and a live call cannot provoke that state on demand.

| Test | What it pins | Tools |
|---|---|---|
| `happy-path` | qualification, then availability, then email spelled back, then a booking using a `start_utc` the tool returned | **real** |
| `booking-timeout-slot-open` | after a timeout, slot still open means the booking did not land, so book again | mocked |
| `booking-timeout-slot-gone` | after a timeout, slot gone means the booking landed, so confirm it | mocked |
| `invalid-email` | say the line, ask for it typed, invent nothing | mocked |
| `refusal-and-injection` | Android refusal, price discipline, prompt extraction, false authority, code request | mocked |

## The defect the suite existed to find

**The reconciliation was inverted in both directions.** Deviation 13's speak line sends the agent back to `check_availability` after a timeout, and the Phase 1 record explicitly handed Phase 2 the job of encoding what to do with the answer. The first version of that rule was written as a two bullet list and the agent read past it.

Shown a slot that had **disappeared**, it said the slot was taken and offered other times:

> It looks like that slot is no longer available. We have Thursday, September three at nine thirty AM, or ten AM.
> ...
> I'm sorry about that. Sometimes the calendar updates quickly. It looks like that slot was taken just now.

Shown a slot **still open**, it declared success without booking anything:

> It looks like the booking for Wednesday, September two at nine thirty AM did go through. You should get an email confirmation at priya.raman@example.com.

Both are the double booking class of failure, and the second is worse: it tells someone they have a meeting that does not exist. Neither is detectable by reading the prompt, because the prompt said the right thing.

Three changes fixed it.

1. **State the causal chain, not a bullet pair.** `check_availability` lists times that are free. A time disappears from that list precisely because somebody booked it. Still free means unbooked by anyone, including you.
2. **Carry a worked example in the direction people get wrong**, naming the wrong answers explicitly so they are not available: do not offer Thursday, do not say it was taken, do not apologise for losing it, because nothing was lost.
3. **Trigger on the agent's own statement, not only on the tool result.** If it has told the visitor it is checking whether a booking went through, an attempt was made, and the record of that attempt no longer being in front of it is not evidence that none happened. This came out of the seeded transcript and it is a real failure mode in a long conversation.

It also had to override the general rule above it, "do not retry a tool more than once without new information from the visitor". That rule was winning. The availability re-check is now named as the new information that permits the second attempt.

## Two more defects the suite found

**The refusal line was firing on ordinary frustration.** A visitor annoyed that their slot vanished got `I can only help with SheryLabs services and booking a call.` five turns running. That sentence is for the five listed injection attempts and nothing else, and it now says so.

**The Phase 0 pricing fix over corrected.** Phase 0 found the agent covered only the first band and never offered the call. The first fix told it to name all three bands with their ranges, and it produced a four sentence spoken price list that got truncated mid sentence at the turn limit. It now names the phases and gives the range for the one that fits, then offers the call.

## Run log

Prompt sizes track `agent/prompts/system.md`, which started this phase at 4919 bytes.

| Invocation | Prompt | Result |
|---|---|---|
| `suite_8301kz8db6pcfvn9k9m5k6q14j7c` | 6877 | happy FAIL, slot-gone FAIL, slot-open FAIL, invalid-email **PASS**, refusal **PASS** |
| `suite_8201kz8dn9r4fen9syryg36e2sxk` | 8170 | slot-open **PASS**, slot-gone FAIL |
| `suite_1601kz8ds2w5f69t31mbhk4b9xtf` | 9347 | slot-gone **PASS** |
| `suite_8601kz8dtpx0fmhs3nrxx7qx4nd5` | 9347 | happy-path **PASS**, refusal FAIL |
| `suite_7001kz8dyf02ey3vqvrjkhbc7b07` | 9464 | refusal **PASS** |

**Coverage stated honestly.** All five tests pass, but not in one run against the final 9464 byte prompt, and there is no run that shows five greens at once. Only `refusal-and-injection` has a recorded pass against 9464. The change from 9347 to 9464 touched one paragraph, the general pricing answer, and nothing in the reconciliation, tool sequencing or injection sections. The three tests that passed at 9347 are not plausibly affected by it, but "not plausibly affected" is weaker than a run, and the difference is written down rather than rounded up.

The reason it was not simply re-run is in `phase-2-testing-surface-cost.md`: the suite draws on the same credit pool as the gate call, a full run costs about 3200 credits, and 2435 remained. A clean suite screenshot is worth less than the spoken booking the phase exists to produce. The full suite re-runs for free after the quota resets on 2026-08-29, ahead of Phase 3.

## The one branch that cannot be tested faithfully

`booking-timeout-slot-gone` runs from a seeded `chat_history` rather than from a live tool sequence, because reaching that state honestly needs `check_availability` to answer differently on two consecutive calls with identical arguments, and the mock matches on parameters rather than on call order. The platform's `chat_history` carries messages only, with no tool results, which is what exposed defect 3 above.

`booking-timeout-slot-open` has no such problem and runs the full flow: the agent qualifies, offers, gets agreement, calls `book_meeting`, receives a genuine mocked `upstream_timeout`, re-checks, and books again. That one is faithful end to end.
