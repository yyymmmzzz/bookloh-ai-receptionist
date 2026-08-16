# Bookloh AI Receptionist — Demo (Tier A)

> **Status:** 3-day demo scaffold. Not production. For a real launch, use the
> PRD as a guide and rebuild with proper auth, observability, and compliance.

7×24 AI phone receptionist for US home services contractors. Takes calls,
qualifies jobs, makes decisions, sends the boss a text, lands the work order
in a dashboard.

**Stack:**
- **Vapi** — voice AI (ASR + LLM + TTS, hosted)
- **Twilio** — US phone number + SMS notifications
- **Supabase** — Postgres database + Realtime dashboard updates
- **Next.js 15** — dashboard + API routes (single app)

---

## What works

| Feature | Status |
|---|---|
| Inbound US phone call answered by AI | ✅ |
| Multi-turn conversation (issue type → address → details → time → name) | ✅ |
| Barge-in (interrupting the AI) | ✅ (Vapi native) |
| Business validation (trade list + service radius via Google Maps) | ✅ |
| 4 AI decisions (accept / urgent / unsure / reject) | ✅ |
| Natural language summary + recording + transcript | ✅ |
| SMS to boss (Twilio) | ✅ |
| Live dashboard (Realtime updates) | ✅ |
| One-tap callback | ✅ |
| Boss config UI (trades / radius / hours / price list) | ✅ |
| Boss real-voice greeting | ⏳ (deferred — see PRD M4) |
| Multi-boss / multi-tenant | ❌ (single boss only) |
| Outbound AI calls to boss (urgent) | ❌ (use SMS for now) |
| Multi-language | ❌ (English only) |
| 911 escalation | ❌ |

---

## Quick start (15 minutes if you have accounts)

```bash
# 1. Install
cd demo
npm install

# 2. Set up env
cp .env.example .env.local
# Fill in values — see SETUP.md for how to get each one

# 3. Set up database
# Go to Supabase SQL Editor → paste supabase/schema.sql → Run

# 4. Run dev server
npm run dev

# 5. (Separate terminal) Expose localhost for Vapi webhooks
npx ngrok http 3000
# Copy the https://xxxx.ngrok.io URL → set as your Vapi server URL
```

See **[SETUP.md](./SETUP.md)** for the full step-by-step.

---

## Project structure

```
demo/
├── README.md                    # This file
├── SETUP.md                     # Step-by-step onboarding
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── .env.example
│
├── supabase/
│   └── schema.sql               # Database schema + seed
│
├── vapi/
│   ├── assistant.json           # Vapi assistant config (paste into Vapi dashboard)
│   └── system-prompt.md         # The full system prompt + tool definitions
│
├── docs/                        # (empty for now — add postmortems here)
│
└── src/
    ├── app/
    │   ├── layout.tsx           # Root layout with nav
    │   ├── page.tsx             # Dashboard — work order list
    │   ├── globals.css
    │   ├── orders/[id]/page.tsx # Work order detail (one-tap callback)
    │   ├── config/page.tsx      # Boss configuration
    │   └── api/
    │       ├── vapi/
    │       │   ├── webhook/route.ts   # Receives Vapi call lifecycle events
    │       │   └── tools/route.ts     # Receives AI function calls
    │       └── boss/callback/route.ts # Boss action endpoints
    │
    └── lib/
        ├── types.ts             # All TypeScript types
        ├── supabase.ts          # Supabase client (server + browser)
        ├── validation.ts        # Service area / trade validation
        ├── notify.ts            # SMS notification dispatcher
        ├── order.ts             # Work order creation/extraction
        └── utils.ts             # Tailwind cn, formatters
```

---

## How the call flow works

```
[Customer calls Twilio US number]
        ↓
[Vapi picks up, plays first message]
        ↓
[AI gathers info, calls tools as needed]
        ↓
[Tools POST to our /api/vapi/tools endpoint]
        ↓
[Our server validates service area, returns price quote]
        ↓
[AI makes decision: accept / urgent / unsure / reject]
        ↓
[AI ends call with outcome + summary]
        ↓
[Vapi POSTs end-of-call-report to our /api/vapi/webhook]
        ↓
[We create a work_order, send SMS to boss, push to dashboard]
        ↓
[Boss sees it live, taps "Call back", gets a click-to-call SMS]
```

---

## Scripts

```bash
npm run dev         # Start dev server on :3000
npm run build       # Production build
npm run start       # Production server
npm run typecheck   # TypeScript check
npm run lint        # ESLint
```

---

## Debugging

- **Vapi not calling webhook?** Check the Vapi dashboard → Logs. Look at the request
  payload. Most common issue: wrong server URL or wrong secret.
- **Dashboard not updating?** Check browser console. Supabase Realtime needs to be
  enabled (it's in `schema.sql`). Try a hard refresh.
- **SMS not sending?** Twilio trial accounts can only send to verified numbers.
  Verify your boss's phone in the Twilio console first.

---

## What's next (after Tier A)

When you're ready to move beyond a 3-day demo:

1. **Replace Vapi with your own voice stack** (Pipecat + OpenAI Realtime + Twilio
   Media Streams). See `docs/upgrade-pipecat.md` (TBD).
2. **Plug into real Bookloh EMS** (currently a mock).
3. **Add multi-boss** (RLS policies, auth, org_id).
4. **Boss real-voice greeting** (record in dashboard → upload to S3 → Vapi first message).
5. **Outbound AI calls** (use Vapi's outbound call API for urgent).
6. **Compliance**: per-state recording notice, CCPA deletion flow, 911 escalation.
7. **Analytics dashboard** (calls/day, AI self-service rate, etc.).

---

## License

Internal demo. Do not distribute.
