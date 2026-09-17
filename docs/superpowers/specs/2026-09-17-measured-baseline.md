# Measured baseline — chat route, before optimization

**Captured:** 2026-09-17, immediately after the metrics instrumentation landed
(`feat: log per-turn token, model and latency metrics`) and **before** any
tiering, reuse or ranking change.

Live capture: real `gemini-3.6-flash`, real Supabase, `POST /api/chat` against a
running dev server. Not estimated.

This file exists because these numbers decide Phase 6 of
[the optimization design](2026-09-17-rag-context-optimization-design.md), and
the only other copy lived in a scratch directory that gets deleted.

## The rows

Turn 1 — `"I have eggs, spinach and feta"`:

```
{"modelId":"gemini-3.6-flash","modelIndex":0,"inputTokens":3022,
 "outputTokens":941,"totalTokens":3963,"cachedTokens":0,"firstTokenMs":7085,
 "retrievalReused":false,"reuseReason":"not-implemented","contextTier":"full",
 "candidateCount":4,"matchCount":4,"refused":false,"embedMs":558,
 "retrieveMs":743,"totalMs":7486}
```

Turn 2 — `"how long does it take?"`, with turn 1 and an assistant turn in history:

```
{"modelId":"gemini-3.6-flash","modelIndex":0,"inputTokens":2300,
 "outputTokens":1603,"totalTokens":3903,"cachedTokens":0,"firstTokenMs":9145,
 "retrievalReused":false,"reuseReason":"not-implemented","contextTier":"full",
 "candidateCount":4,"matchCount":4,"refused":false,"embedMs":536,
 "retrieveMs":510,"totalMs":9306}
```

## What they establish

| Claim | Status |
| --- | --- |
| **Baseline prompt cost is 3,022 input tokens** on a first turn, 2,300 on a follow-up | measured |
| The design's `~2,241` estimate is **~35% low** — it came from a 4-chars-per-token approximation over `toChunk` | measured |
| **Gemini's implicit prefix cache never fires today.** `cachedTokens: 0` on both turns | measured |
| `SYSTEM_PROMPT` alone is ~723 tokens, under the 1,024-token Flash cache floor, which is *why* it cannot fire | measured independently |
| **A follow-up pays for an embedding it does not need** — `embedMs: 536` on a question with no ingredient content. This is the request Phase 2 removes | measured |
| Turn 2's context block was substantially smaller than turn 1's despite carrying more history, so retrieval drifted to different recipes — the grounding bug | **inference**, not measurement (see caveat) |
| **`outputTokens` is a large and growing share of cost**: 941 then 1,603, the latter ~70% of that turn's input cost | measured |

### Caveat on the drift claim

`TurnMetrics` records `matchCount` and `candidateCount` as counts only — never
recipe identity. That turn 2 retrieved *different* recipes than turn 1 is a
strongly-supported inference from the token delta, not something the logs prove.

**Consequence worth fixing in plan two:** nothing currently logged makes
retrieval drift, or the correctness of Phase 2's reuse, checkable from logs
alone. One slug field on `TurnMetrics` would close that gap cheaply. It was left
out of this plan deliberately, to avoid churning the pinned metrics fixture
mid-flight.

## Two things the design did not anticipate

1. **Output tokens are not addressed by any phase of plan one.** Phases 0–2b all
   attack input cost. On the measured follow-up, output was ~41% of the turn's
   total tokens. If the binding quota turns out to be total tokens rather than
   requests, output length needs its own lever — a `maxOutputTokens` cap, or a
   system-prompt instruction to be brief — and neither is in the current plan.
2. **First-token latency is 7–9 seconds.** Not a quota problem, so out of scope
   here, but `embedMs + retrieveMs` is only ~1.3s of it; the rest is the model.
   Phase 2's reuse removes ~0.5s of that on follow-ups.

## Reproducing

```bash
npm run dev
curl -s -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"I have eggs, spinach and feta"}]}]}' \
  -o /dev/null
# then read the [metrics] line from the dev server output
```
