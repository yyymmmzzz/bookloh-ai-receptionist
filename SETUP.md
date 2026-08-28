# Setup Guide — HandyLine AI Receptionist Demo

Estimated time: **30-60 minutes** for full setup, **10 minutes** if you just want to see the dashboard with fake data.

---

## Fastest path — see the dashboard in 10 minutes (no Vapi/Twilio needed)

If you just want to see the UI populated and verify the data model works, you can skip
Vapi/Twilio/Google Maps initially. Just need Supabase.

```bash
# 1. Set up Supabase only (steps 1.1-1.4 in Step 1 below)
#    Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, 
#    SUPABASE_SERVICE_ROLE_KEY in .env.local

# 2. Run dev server
npm run dev

# 3. Seed fake data — populates 5 work orders covering all 4 AI decisions
curl -X POST http://localhost:3000/api/dev/seed

# 4. Open the dashboard
open http://localhost:3000
```

You should see:
- 1 urgent job (red)
- 1 pending job (blue)
- 1 callback-needed job (amber)
- 1 out-of-scope job (gray)
- 1 already-confirmed job

Click into any of them to see the full detail page with mock transcript.

When you're ready to add real voice, continue with Steps 2-4 below.

---

## Full path — real phone calls

Estimated time: **30-60 minutes** if you have to create accounts.

---

## Step 0 — Prerequisites

You'll need:

- [x] Node.js 20+ (check with `node --version`)
- [x] npm
- [x] Accounts at: Supabase, Vapi, Twilio, Google Maps (4 signups, all have free tiers)
- [x] A US cell phone that can receive SMS (for testing the boss notification)
- [x] (Optional) `ngrok` for exposing localhost — `brew install ngrok` or `npm i -g ngrok`

---

## Step 1 — Supabase (5 minutes)

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign in with GitHub.
2. **New project** → name it `handyline-demo` → choose a region (US East for Houston latency).
3. Wait ~2 min for provisioning.
4. **Project Settings → API**:
   - Copy `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - Copy `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy `service_role` key (click "Reveal" first) → `SUPABASE_SERVICE_ROLE_KEY`
5. **SQL Editor → New query** → paste the entire contents of `supabase/schema.sql` → **Run**.
6. **Database → Replication** → make sure `work_orders` and `notifications` are in the
   `supabase_realtime` publication (the schema does this for you — verify under
   `Database → Publications → supabase_realtime`).

You should see one boss record: "Handy Works Home Services / Alex" in the `bosses` table.

---

## Step 2 — Vapi (10 minutes)

1. Go to [vapi.ai](https://vapi.ai) → sign up.
2. **Account → API Keys** → create a new key → copy → `VAPI_API_KEY`.
3. **Phone Numbers → Buy Number** (Twilio sub-account) — Vapi will provision a US number
   for you automatically. **Cost:** ~$2/month + usage. Trial gives you free minutes.
   - Alternative: Bring your own Twilio number (see "BYO Twilio" below).
4. **Assistants → Create Assistant** → **From Scratch** (not from a template).
5. Configure:
   - **Name**: "HandyLine AI Receptionist — Handy Works"
   - **Model**: OpenAI → `gpt-4o` → temperature 0.3
   - **Voice**: ElevenLabs → `HZrCrY9LUzc3dRxar8U2` (Yimo voice clone) → model `eleven_turbo_v2_5`
   - **First Message**: `Hey, this is Alex over at Handy Works Home Services. This call may be recorded for quality. What can I help you with today?`
   - **System Prompt**: Paste the full system prompt from `vapi/system-prompt.md`
   - **End Call Function Enabled**: ON
   - **End Call Silences Timeout**: 30 seconds
   - **Max Duration**: 600 seconds
6. **Tools** → Add 5 tools (function calls) — copy each definition from `vapi/system-prompt.md`:
   - `validate_service`
   - `get_price_quote`
   - `flag_urgent`
   - `flag_uncertain`
   - `end_call`
7. **Server URL** (set this LAST — Vapi needs a public URL):
   - For now, leave blank. After Step 4 below, set it to `https://YOUR_NGROK_URL/api/vapi/tools`.
   - **Server URL Secret**: pick any random string (e.g. `super-secret-abc-123`) → save as `WEBHOOK_SECRET` in `.env.local`.
8. **Save** → copy the Assistant ID → `VAPI_ASSISTANT_ID`.

### BYO Twilio (optional, recommended for production)

If you have your own Twilio account:

1. Buy a US number in Twilio console.
2. In Vapi: **Phone Numbers → Import from Twilio** → follow the steps.
3. Use the Twilio SID/token in `.env.local` for SMS (see Step 3).

---

## Step 3 — Twilio (5 minutes)

1. Go to [console.twilio.com](https://console.twilio.com) → sign up.
2. **Console Dashboard** → copy `Account SID` → `TWILIO_ACCOUNT_SID` and `Auth Token` → `TWILIO_AUTH_TOKEN`.
3. **Phone Numbers → Manage → Active numbers** → if you used BYO Twilio, copy the number → `TWILIO_PHONE_NUMBER`.
4. **Verify a phone number** (trial accounts can only SMS verified numbers):
   - **Phone Numbers → Manage → Verified Caller IDs → Add** → enter the boss's cell → verify.
   - This is `TWILIO_BOSS_PHONE` (your test phone for the demo).

---

## Step 4 — Google Maps (3 minutes, optional for first run)

If you don't set this up, the validation will be permissive (won't reject by distance).

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create project.
2. **APIs & Services → Library** → enable: **Geocoding API** + **Distance Matrix API**.
3. **Credentials → Create Credentials → API Key** → restrict to those two APIs → copy → `GOOGLE_MAPS_API_KEY`.

---

## Step 5 — Local environment (2 minutes)

```bash
cd demo
npm install
cp .env.example .env.local
```

Open `.env.local` in your editor and fill in all the values from Steps 1-4.

The seeded boss has zip `77002` and radius `25` miles — if your Google Maps key works,
this is enough to test distance validation.

---

## Step 6 — Expose localhost (Vapi needs a public URL)

Vapi needs to POST to your `/api/vapi/tools` and `/api/vapi/webhook` endpoints. Locally,
you need a tunnel:

```bash
# In a separate terminal
npx ngrok http 3000
```

Copy the `https://xxxx-xx-xx-xx-xx.ngrok.io` URL. You'll set it in Vapi in Step 7.

> Production: deploy to Vercel, Fly.io, or Railway. Set the env vars there.

---

## Step 7 — Wire up Vapi (3 minutes)

1. Back in Vapi dashboard → **Assistants → HandyLine AI Receptionist**.
2. **Server URL**: `https://YOUR_NGROK_URL/api/vapi/tools`
3. **Server URL Secret**: same value as `WEBHOOK_SECRET` in `.env.local`.
4. Save.

Now Vapi will POST tool calls to your local server.

---

## Step 8 — Run it (2 minutes)

```bash
# In one terminal
npm run dev

# In another
npx ngrok http 3000  # keep running
```

Open [http://localhost:3000](http://localhost:3000) — you should see the dashboard with
"no work orders yet".

---

## Step 9 — First test call (5 minutes)

### Test from your cell

Call the Vapi/Twilio number from your cell. You should hear:
> "Hi, thanks for calling Handy Works Home Services. This call may be recorded for
> quality. How can I help you today?"

Try these scenarios in order:

#### Scenario 1: Plain request (decision = accept)

You: "Hi, my AC is not cooling and it's blowing hot air."
AI: Asks for zip code, etc.
You: "77002"
AI: Calls `validate_service` → returns OK. Asks for details.
You: "Just started this morning. I'm home tomorrow morning."
AI: Calls `get_price_quote` → returns $200-500. Tells you: "Diagnostic fee is $89,
that goes toward the repair. Typical cost for AC issues is $200 to $500, but final
price depends on what we find on site. We can probably get someone out tomorrow
morning — someone will call you to confirm."
AI: Calls `end_call` outcome "accepted".

Check the dashboard — new work order with status `pending`.

#### Scenario 2: Out of area (decision = reject)

You: "Hi, I have a leak. I'm in Dallas, 75201."
AI: "I'm sorry, that's outside our service area. I'd recommend searching for a
plumbing contractor closer to you. Have a good day."
AI: Calls `end_call` outcome "rejected".

Dashboard should show a `rejected` work order.

#### Scenario 3: Urgent (decision = urgent)

You: "Water is everywhere! My pipe burst!"
AI: "I understand. Let me have someone call you back in 5 to 15 minutes."
AI: Calls `flag_urgent` then `end_call` outcome "urgent".

Dashboard should show a `urgent` work order (red banner).
Your boss phone (TWILIO_BOSS_PHONE) should receive an SMS.

#### Scenario 4: AI doesn't know (decision = unsure)

You: "I need help with my septic tank."
AI: "Let me check with my team on that and call you back with details."
AI: Calls `flag_uncertain` then `end_call` outcome "unsure".

Dashboard should show a `callback` work order.

---

## Step 10 — Verify the SMS notification

After the first test call, check your boss cell. You should receive an SMS like:

```
✅ New job — Handy Works Home Services
AC not cooling at 123 Main St, 77002. Customer available tomorrow AM.
Customer: John (555-1234)
Quote: $200–$500 + $89 diagnostic
Open: http://localhost:3000/orders/xxxxx
```

(If you don't get the SMS, check Twilio console logs for the error.)

---

## Step 11 — Try the one-tap callback

1. Click into any work order.
2. Click **"Call back XXXXX"** button.
3. Your boss cell should receive an SMS with `tel:+1xxxx` link.
4. On mobile, tap the link → dialer opens with the customer's number.

---

## Dev tools (no Vapi needed)

For testing without making real phone calls, three dev-only endpoints are available:

### `POST /api/dev/seed`

Populates 5 fake work orders covering all 4 AI decisions (urgent / accepted / callback / rejected / confirmed). Existing seed data is cleared first.

```bash
curl -X POST http://localhost:3000/api/dev/seed
```

### `POST /api/dev/simulate-call`

Simulates a full Vapi end-of-call-report without making a real call. Creates a real
work order in the database and triggers the SMS notification (if Twilio is configured).

```bash
# Default: accept scenario
curl -X POST http://localhost:3000/api/dev/simulate-call

# Specific scenario
curl -X POST http://localhost:3000/api/dev/simulate-call \
  -H "Content-Type: application/json" \
  -d '{"scenario": "urgent", "customerName": "Test Customer"}'
```

Scenarios: `accept` (default), `urgent`, `unsure`, `reject`.

### `POST /api/dev/clear`

Wipes all work orders, customers, call events, and notifications. Keeps the boss record.

```bash
curl -X POST http://localhost:3000/api/dev/clear
```

**Note:** All `/api/dev/*` endpoints return 403 in production (`NODE_ENV=production`).
You can also force-disable them by setting `ENABLE_DEV_TOOLS=false` (default: enabled in dev).

---

## Troubleshooting### "Vapi not calling my webhook"

1. Check the Vapi dashboard → **Logs** for the call.
2. Make sure **Server URL** is set to your ngrok URL (not localhost).
3. Make sure **Server URL Secret** matches `WEBHOOK_SECRET` in `.env.local`.
4. Look at the terminal where `npm run dev` is running — the API route should log
   `Event: status-update` or `Event: end-of-call-report` when Vapi hits it.

### "Tool call failed"

1. Open browser dev tools → Network tab on the dashboard.
2. Trigger a call.
3. Look at the request Vapi made to your `/api/vapi/tools` endpoint.
4. The response should be `{results: [{toolCallId, result}]}`.

### "Dashboard not updating live"

1. Make sure `work_orders` is in the `supabase_realtime` publication.
2. Check browser console for Supabase connection errors.
3. Try a hard refresh — sometimes the realtime channel needs to reconnect.

### "SMS not sent"

1. Trial Twilio accounts can only send to verified numbers. Verify your boss's
   cell in Twilio console.
2. Make sure `TWILIO_PHONE_NUMBER` is set to the same number Vapi is using.
3. Check Twilio console → **Monitor → Logs → Messages** for the error.

### "Google Maps distance not working"

1. Make sure both APIs are enabled (Geocoding + Distance Matrix).
2. Make sure billing is enabled (free tier requires a card on file).
3. If the key doesn't work, the validation falls back to "permissive" — no
   out-of-area rejection. That's fine for the demo.

---

## Production checklist (NOT for this demo, but when you go live)

- [ ] Replace Vapi with self-hosted voice stack (Pipecat + GPT-4o Realtime) — only when paid > 500
- [ ] Add real auth (Supabase Auth or Clerk)
- [ ] Move from single-boss to multi-tenant with RLS
- [ ] Plug into real Bookloh EMS API
- [x] ~~Boss real-voice greeting (M4)~~ — done: Yimo 11labs clone
- [x] ~~Outbound AI calls for urgent (M3)~~ — done: Twilio outbound + IVR
- [ ] Per-state recording consent (Texas = one-party, California = two-party)
- [ ] CCPA-compliant data deletion flow
- [ ] 911 escalation
- [ ] Stripe billing
- [ ] Observability (Sentry + Vapi logs + custom metrics)
- [ ] E2E tests
- [ ] HIPAA-style data handling review (recordings contain PII)
