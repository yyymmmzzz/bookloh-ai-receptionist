# QA — Automated Testing for the AI Receptionist

**Date:** 2026-08-29 · **Status:** Active

Two test scripts cover config + LLM behavior. Together they catch ~80% of regressions before any real phone test.

## Quick start

```bash
# Run both (recommended before every commit)
npm run test:all

# Or individually
npm run test:static            # config check, no API calls
npm run test:conversations    # runs 24 test cases through gpt-4o-mini
```

## What's covered

### `test:static` — config check (~3 seconds, no API cost)

Verifies the system is correctly configured:

**Vapi assistant** (live API call):
- US assistant exists
- Model: gpt-4o-mini
- Max tokens: ≤ 100 (enforces short replies)
- Temperature: ≤ 0.3 (consistency)
- Voice: 11labs / eleven_turbo_v2_5 (good number reading)
- Server URL: set to Vercel
- First message: correct greeting
- Tools: exactly 4 (check_and_quote, flag_urgent, flag_uncertain, end_call)
- Tool names match expected set

**System prompt** (loaded from Vapi live):
- "I will certainly" (replaces "Alex will call")
- "Have a good day" (replaces "Bye")
- "Anything else" check present
- "twenty-five" (spelled out, not "25")
- "eighty-nine" (spelled out, not "89")
- All 13 trades mentioned
- Roofing / gas use "coordinate" (not "outside scope")
- Pest control in out-of-scope list
- 911 mentioned for gas emergency
- "Stay safe" / "open windows" for urgent
- "Alex and Abel" both mentioned
- No "Alex will call" (old phrasing)
- No bare "Bye"
- No Chinese characters (TTS misreads)

**Supabase Alex boss row**:
- Phone matches website (+17137422387)
- All 13 service trades present
- `vapi_assistant_id` linked to VAPI_ASSISTANT_ID env
- Service base is Bellaire 77401
- Owner name mentions Alex

### `test:conversations` — LLM behavior test (~60 seconds, ~$0.01 OpenAI cost)

Runs **24 test cases** from `docs/US-USER-TEST-CASES.md` through the **actual system prompt + actual gpt-4o-mini** (same model Vapi uses).

For each case:
1. Loads the AI's first message ("Handy Works, this is Alex. What's the issue.")
2. Sends the customer's spoken line as the next turn
3. Captures the AI's response + any tool calls
4. If the AI called `check_and_quote`, simulates a tool response (always in_service unless the case is `out_of_area`)
5. Gets the AI's final response (where it should call `end_call`)
6. Scores against criteria:
   - **Decision**: did AI call `end_call` with the expected outcome?
   - **Keywords**: are expected phrases present (e.g. "in service", "stay safe", "911")?
   - **Forbidden**: are unexpected phrases absent (e.g. "zip" in urgent cases)?
   - **TTS safety**: no digit prices like "$89" or "120 to 500"?
   - **No Chinese**: no CJK characters (TTS misreads)?
   - **Length**: response ≤ 80 words?

**Covers:** TC-001 through TC-010 (regular), TC-U01 to U03 (urgent), TC-OS01 to OS03 (out of scope), TC-OSA01 to OSA03 (out of area), TC-B01 (behavior), TC-M01 (multiple), TC-S01 to S02 (coordinated). That's **24 of 32 cases** — the rest (8 cases) require nuanced multi-turn customer behavior that's hard to mock.

## What's NOT covered

- **Real Vapi calls** (audio quality, voice clarity, network latency)
- **TTS pronunciation** (requires actual phone call)
- **Customer behavior edge cases** (TC-V01, TC-V02, TC-W01, TC-W02, TC-B02, TC-B03, TC-H01, TC-H02, TC-T01, TC-T02, TC-M02)
- **Real webhook → Supabase** flow (covered separately by `test:scenarios` if needed)
- **Live dashboard rendering** (manual visual check)

## When to run

| Trigger | What to run |
|---|---|
| After editing `vapi/system-prompt.md` | `npm run test:all` |
| After editing `vapi/assistant.json` (tools, model) | `npm run test:static` |
| After PATCHing Vapi | `npm run test:static` |
| After editing Supabase boss row | `npm run test:static` |
| Before merging to main | `npm run test:all` |
| Before H-Master go-live | `npm run test:all` + manual phone test |
| Weekly regression check | `npm run test:all` |

## Adding new test cases

Edit `scripts/test-conversations.js`, find the `CASES` array, and add:

```js
{
  id: "TC-NEW",
  category: "regular",       // regular | urgent | out_of_scope | out_of_area | behavior | multiple | coordinated
  customer: "What the customer says",
  expectDecision: "accepted",  // accepted | urgent | rejected | unsure
  expectIn: ["keyword1", "keyword2"],
  mustNotHave: ["forbidden1"],
}
```

`expectIn` — AI response must contain these substrings (case-insensitive).
`mustNotHave` — AI response must NOT contain these.

## Example output

```
═══════════════════════════════════════════
  Handy Works AI - Conversation Test
  (24 cases)
═══════════════════════════════════════════

  TC-001 (regular)... ✓
  TC-002 (regular)... ✓
  TC-003 (regular)... ✓
  TC-U01 (urgent)... ✓
  TC-OS01 (out_of_scope)... ✓
  ...
  TC-S02 (coordinated)... ✓

═══════════════════════════════════════════
  Results: 22 passed, 2 failed
═══════════════════════════════════════════

Failed cases:

  TC-U02: FAIL
    - expected outcome=urgent, got accepted
    AI: "Got it, in service. Trip eighty-nine..."
```

## CI / pre-commit hook (optional)

Add to `.husky/pre-commit` or `package.json`:

```json
"pre-commit": "npm run test:all"
```

This blocks any commit that breaks the AI behavior.

## Cost

- `test:static`: 1 Vapi API call, 1 Supabase API call. Free.
- `test:conversations`: 24 OpenAI calls (gpt-4o-mini, ~150 tokens each). **~$0.01 per run.**

Run as often as you want.
