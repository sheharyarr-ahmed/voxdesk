# Screenshots

Captured 2026-08-06 by driving the deployed application with Playwright at 1440x900,
2x scale. Not mocked up, not composed, and not hand cropped. The script signs in through
the real passcode gate and navigates like a visitor.

**Six of these are the live production deployment showing real data. Two are the test
harness and are named `MOCK` for that reason.** The distinction is the point of this file.

## Real, captured from the production deployment

| File | What it shows |
|---|---|
| `01-gate.png` | The passcode gate. Note the field has a visible border and its own background, which is the Phase 3 defect fixed |
| `02-console-idle.png` | The voice console, idle, behind the gate |
| `03-call-log.png`, `03-call-log-full.png` | `/calls`, 10 real conversations |
| `04-call-detail.png`, `04-call-detail-full.png` | The 2026-08-05 spoken call: all six extracted lead fields, the real Cal.com booking uid, and the transcript beside `check_availability` at 434 ms and `book_meeting` at 2296 ms |
| `05-call-detail-kb.png` | The 2026-08-06 knowledge base call, 29 s, ingested by a webhook ElevenLabs signed |

Every number in these is a real measurement written by `src/lib/tool-log.ts` during a real
call. Nothing is seeded.

## The test harness, and it says so on screen

| File | What it shows |
|---|---|
| `06-console-live-MOCK.png`, `06-console-live-MOCK-full.png` | The console mid call |
| `07-email-fallback-MOCK.png` | The typed email fallback revealed |

These run against the SPEC.md section 6.7 mock seam, the same one the end to end suite
uses, because the live mid call state cannot be captured without spending metered credits.
**The conversation id on screen reads `conv_mock000...`**, so the image labels itself and
cannot be mistaken for a real call even out of context.

The console chrome, the transcript layout, the tool row and the latency treatment are the
real components. The conversation inside them is scripted.

**They must never be presented as a recorded call.** `docs/CLAIMS.md` forbids any usage
metric or call volume claim, and passing a scripted transcript off as a real one would
breach that. Use `04` and `05` for anything that needs to show a real conversation.

## Attribution

`Voice by ElevenLabs` renders in the product, on the gate and in the console footer, so it
appears in these images by construction rather than by caption. That is a licence term of
the ElevenLabs free plan and is why the credit lives in the UI. See SPEC.md section 12.
