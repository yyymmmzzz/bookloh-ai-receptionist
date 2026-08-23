# Multi-Region Multi-Team Architecture

**Author:** Mavis (mavis) · **Date:** 2026-08-23 · **Status:** Planning doc

This document plans the structural changes needed to fully separate
US and Southeast Asia operations in HandyLine AI. The current demo
runs everything in a single Vapi assistant / single Supabase row
model. This needs to evolve into a multi-region, multi-team, multi-
phone-number architecture.

## TL;DR

| Layer | Current (single-region) | Target (multi-region) |
|---|---|---|
| **Phone numbers** | 1 US number | 1 per country (US, SG, MY, ID, ...) |
| **Vapi assistants** | 1 shared | 1 per country, each with own STT + TTS + prompt |
| **Tool endpoints** | 1 `/api/vapi/tools` | 1 shared, but country-aware logic |
| **Bosses table** | 1 row (Alex / US) | 1 row per country team |
| **Work orders** | `boss_id` only | `boss_id` + `country` (cached for fast filter) |
| **Dashboard** | `/` shows all (US + demo) | `/` (US), `/sg`, `/my`, `/id` per country |
| **Demo data** | 49 US records | 49 US + 5-10 each for SG/MY/ID |
| **Emergency call** | US number → US boss | Country-specific number → country-specific boss |

## 1. Architecture diagram

```
                ┌── +1 (US)  ─→  Vapi US Assistant (Alex team)  ─┐
                │                                              │
                ├── +65 (SG) ─→  Vapi SG Assistant (X team)   ─┤
                │                                              │
Incoming  ─────├── +60 (MY) ─→  Vapi MY Assistant (Y team)   ─┤
phone call       │                                              │
                ├── +62 (ID) ─→  Vapi ID Assistant (Z team)   ─┤
                │                                              │
                └── +66 (TH), +84 (VN), +63 (PH), ... (future) ┘
                                                               │
                                                               ↓ (webhook on call end)
                                                       /api/vapi/webhook
                                                               │
                                                               ↓
                                                src/lib/order.ts
                                                  - country detection
                                                  - boss lookup
                                                  - work_order insert
                                                               │
                                                               ↓
                                                     Supabase DB
                            ┌──────────────────────────────────┤
                            │                                  │
                       bosses table                    work_orders table
                            │                                  │
              ┌────┬────┬────┴───┐                  ┌────┬──────┴────┐
              │    │    │        │                  │    │           │
            US   SG   MY      ID              country=BossId     
           Alex   X    Y       Z                /        ↓
                              ↓                          US Alex
                            (future)                    /     SG X
                                                       /      MY Y
                                                               ID Z
```

## 2. Schema changes

### 2.1 `bosses` table (currently 1 row, expand to N rows)

```sql
-- Migration 010: Add multi-region support to bosses
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,                    -- 'US', 'SG', 'MY', 'ID', ...
  ADD COLUMN IF NOT EXISTS default_service_radius_km NUMERIC DEFAULT 25,  -- km for SG/MY/ID
  ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'USD',   -- 'USD', 'SGD', 'MYR', 'IDR'
  ADD COLUMN IF NOT EXISTS currency_symbol TEXT DEFAULT '$',
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en-US';          -- 'en-SG', 'en-MY', 'id-ID'

CREATE INDEX IF NOT EXISTS bosses_country_idx ON bosses (country);
```

**Updated seed** (1 row per team):

```sql
-- US: Alex (existing)
UPDATE bosses
SET company_name = 'Handy Works Home Services',
    country = 'US',
    currency_code = 'USD',
    currency_symbol = '$',
    timezone = 'America/Chicago',
    locale = 'en-US'
WHERE id = (SELECT id FROM bosses LIMIT 1);

-- SG: 1 new team
INSERT INTO bosses (id, owner_name, phone, company_name, country, base_zipcode, base_postal_code, radius_miles, diagnostic_fee, currency_code, currency_symbol, timezone, locale)
VALUES (gen_random_uuid(), 'X (SG Team Lead)', '+6581234567', 'SG Home Fix', 'SG', NULL, '238859', 25, 89, 'SGD', 'S$', 'Asia/Singapore', 'en-SG')
ON CONFLICT DO NOTHING;

-- MY: 1 new team
INSERT INTO bosses (...)
VALUES (gen_random_uuid(), 'Y (MY Team Lead)', '+60123456789', 'MY Home Services', 'MY', NULL, '50000', 50, 89, 'MYR', 'RM', 'Asia/Kuala_Lumpur', 'en-MY')
ON CONFLICT DO NOTHING;

-- ID: 1 new team
INSERT INTO bosses (...)
VALUES (gen_random_uuid(), 'Z (ID Team Lead)', '+62812345678', 'ID Home Service', 'ID', NULL, '10110', 30, 150000, 'IDR', 'Rp', 'Asia/Jakarta', 'id-ID')
ON CONFLICT DO NOTHING;
```

### 2.2 `work_orders` table (already has `country` from migration 009)

```sql
-- Already has: country TEXT (nullable)
-- Add index for fast country filter
CREATE INDEX IF NOT EXISTS work_orders_country_idx
  ON work_orders (country)
  WHERE country IS NOT NULL;

-- Optional: backfill country from customer_phone for old records
UPDATE work_orders
SET country = CASE
  WHEN customer_phone LIKE '+1%' THEN 'US'
  WHEN customer_phone LIKE '+65%' THEN 'SG'
  WHEN customer_phone LIKE '+60%' THEN 'MY'
  WHEN customer_phone LIKE '+62%' THEN 'ID'
  ELSE country
END
WHERE country IS NULL;
```

### 2.3 `validate_service` tool — country-aware

The current tool accepts `zipcode` (5 digits, US). For SEA, we need
`postal_code` (6 digits) and a different in/out rule. Two options:

**Option A (recommended): single tool, country-aware parameter**
```typescript
// Tool: validate_service
{
  country: string,           // "US" | "SG" | "MY" | "ID" (required)
  zipcode?: string,          // 5 digits (US only)
  postal_code?: string,      // 6 digits (SG/MY/ID)
  issue_type: string,
}
```
Handler:
```typescript
if (country === "US") { /* US zipcode lookup */ }
if (country === "SG") { /* SG postal district check (01-20, 22-28) */ }
if (country === "MY") { /* MY postcode check (5 digits, prefix 50-69) */ }
if (country === "ID") { /* ID postcode check (5 digits) */ }
```

**Option B (future): one tool endpoint per country**
```
/api/vapi/tools/us/validate_service
/api/vapi/tools/sg/validate_service
/api/vapi/tools/my/validate_service
/api/vapi/tools/id/validate_service
```
Easier to scale but more code. Stick with Option A for v1.

### 2.4 `get_price_quote` tool — country-aware

Current tool returns `trip_fee` (hardcoded $89) + fuel surcharge. For SEA:
- **SG**: trip fee S$89, no fuel surcharge (SG is small)
- **MY**: trip fee RM89 (~$20 USD), no fuel surcharge
- **ID**: trip fee Rp 150,000 (~$10 USD), no fuel surcharge

Tool needs `country` parameter to return correct currency + amount.

## 3. Vapi configuration

### 3.1 Multi-number + multi-assistant setup

For each country, buy 1 phone number + create 1 Vapi assistant:

| Country | Number | Vapi Assistant ID | STT | TTS voice |
|---|---|---|---|---|
| US | +17243620422 (existing) | `42523b3e-...` (existing) | Deepgram | 11labs Yimo (existing) |
| SG | +65 XXXX XXXX (buy) | `asst_sg_xxxx` | AssemblyAI | 11labs SG clone (TBD) |
| MY | +60 XX XXXX XXXX (buy) | `asst_my_xxxx` | AssemblyAI | 11labs MY clone (TBD) |
| ID | +62 XXX XXXX XXXX (buy) | `asst_id_xxxx` | Whisper (multilingual) | 11labs ID clone (TBD) |

Vapi supports multiple phone numbers per account. Each number is
associated with one assistant via the Vapi dashboard. The association
takes effect automatically when the call comes in.

### 3.2 Number purchasing

Vapi charges $1-2/month per number + per-minute usage. Numbers available
in 100+ countries. For SEA, we need to request SG/MY/ID numbers via
Vapi dashboard (or via API):

```bash
# List available SG numbers
curl -X POST "https://api.vapi.ai/phone-number" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"provider": "twilio", "country": "SG", "areaCode": "65"}'

# Create number
curl -X POST "https://api.vapi.ai/phone-number" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "twilio",
    "number": "+6512345678",
    "assistantId": "asst_sg_xxxx"
  }'
```

### 3.3 Per-country assistant config

Each Vapi assistant has:
- `transcriptionProvider`: deepgram (US) | assemblyai (SG/MY) | openai (ID)
- `voice`: cloned local voice per country
- `firstMessage`: localized greeting
- `systemPrompt`: country-specific (see `vapi/system-prompt-{country}.md`)

We've already written:
- `vapi/system-prompt-sg.md` (Singlish)
- Need to write: `vapi/system-prompt-my.md` (Manglish), `vapi/system-prompt-id.md` (Bahasa Indonesia + English)

## 4. Boss/team routing logic

When Vapi sends a webhook, we need to:
1. Detect the country from the customer's phone number
2. Find the matching boss (default = 1 boss per country)
3. Write the work_order with `boss_id` (FK) + `country` (cached)

```typescript
// src/lib/order.ts (current logic)
function getBossForCall(country: string): Boss {
  // Round-robin / sticky if multiple teams per country
  // v1: 1 boss per country
  // Future: load balance across N bosses in same country
  return boss; // where bosses.country = callCountry LIMIT 1
}
```

For multi-team per country (future), the routing table:
```sql
CREATE TABLE IF NOT EXISTS boss_routing_rules (
  country TEXT NOT NULL,
  issue_type TEXT,                 -- NULL = default
  zipcode_pattern TEXT,            -- e.g. '770%' (Houston) or '239%' (Orchard)
  boss_id UUID NOT NULL REFERENCES bosses(id),
  priority INT DEFAULT 0,
  active BOOLEAN DEFAULT true
);
```

## 5. Dashboard architecture

### 5.1 Current routes
- `/` — single dashboard, all records

### 5.2 Target routes

```
/                  → admin view (all teams, all countries) — country filter tab
/us/[team]        → US team (alex)
/sg/[team]        → SG team
/my/[team]        → MY team
/id/[team]        → ID team
/customer/[phone] → customer's call history
```

For v1 (simpler), use:
```
/        → existing dashboard (admin: all records, country filter)
/us      → all US records
/sg      → all SG records
/my      → all MY records
/id      → all ID records
/us/team-1 → specific team within US
```

### 5.3 Implementation

The cleanest approach is **dynamic route** `[country]/page.tsx` that
loads the country from URL params. Existing `/` stays the same
(admin view). New `[country]/page.tsx` filters to that country.

```typescript
// src/app/[country]/page.tsx (dynamic)
import DashboardPage from "@/app/page";

export default async function CountryDashboard({ params }: { params: { country: string } }) {
  // validate params.country is "us" | "sg" | "my" | "id" | "all"
  // pass via searchParams to dashboard
}
```

URL examples:
- `https://demo-navy-chi-47.vercel.app/us` → US records only
- `https://demo-navy-chi-47.vercel.app/sg` → SG records only
- `https://demo-navy-chi-47.vercel.app/my` → MY records only
- `https://demo-navy.chicago-47.vercel.app/id` → ID records only

### 5.4 Work order display

Each work order row should show:
- Country flag (🇺🇸 🇸🇬 🇲🇾 🇮🇩)
- Country code chip (US/SG/MY/ID)
- Boss / team name ("Handy Works" / "SG Home Fix" / etc.)
- Currency (USD/SGD/MYR/IDR)
- Existing fields: name, intent, tendency, etc.

```
┌────────────────────────────────────────────────────┐
│ 🇺🇸 US  Alex (Handy Works Home Services)   2h ago   │
│ Name: Nathan                                          │
│ Intent: "My kitchen sink is clogged..."              │
│ Tendency: 🛒 Price shopping                          │
│ 🔥 High follow-up                                    │
│ Topics: garbage, water pump, junk removal            │
│ Quote: $89 trip + ... = $89-389                      │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ 🇸🇬 SG  X (SG Home Fix)                       5m ago  │
│ Name: Wei Ming                                        │
│ Intent: "My kitchen sink leaking already, can fix?"  │
│ Tendency: 📅 Scheduling                              │
│ ✓ Accepted → callback                                │
│ Topics: sink, leak, plumbing                         │
│ Quote: S$89                                          │
└────────────────────────────────────────────────────┘
```

## 6. Demo data per country

Each team needs 5-10 demo records + 1-2 production records.

| Country | Team | Demo records | Production records | Currency |
|---|---|---|---|---|
| US | Alex (Handy Works) | 49 (existing) | 10 (existing) | USD |
| SG | X (SG Home Fix) | 5-10 (new) | 1-2 (TBD) | SGD |
| MY | Y (MY Home Services) | 5-10 (new) | 1-2 (TBD) | MYR |
| ID | Z (ID Home Service) | 5-10 (new) | 1-2 (TBD) | IDR |

**New demo data to seed** (3 countries × 5-10 records):
- Issue types: plumbing, electrical, handyman, hvac (mixed)
- Postcodes: realistic SG/MY/ID postcodes
- Customer names: realistic local names (Wei Ming, Ahmad, Budi)
- Status: pending / accepted / urgent (mixed)
- Source: demo (different from existing 49 US demo)

Script: `scripts/seed-sea-demo-data.js` (parallel to existing `seed-demo-data.js`)

## 7. Implementation Roadmap

### Phase 1: Schema + Bosses (1-2 days, $0)
- [ ] Migration 010: bosses columns (country, currency, timezone, locale)
- [ ] Update existing Alex boss: country='US'
- [ ] Insert 3 new bosses (SG/MY/ID)
- [ ] Seed demo data: 5-10 records per SEA country
- [ ] Backfill country for existing 10 production records

### Phase 2: Tool localization (2-3 days, $0)
- [ ] Update `validate_service` tool: accept `country` + `zipcode` / `postal_code`
- [ ] Update `get_price_quote` tool: accept `country` + return correct currency
- [ ] Test tools work for US zipcode, SG postal code, MY postcode, ID postcode

### Phase 3: Vapi multi-number (1-2 weeks, ~$5-10/mo per country)
- [ ] Buy 1 phone number per country (SG/MY/ID)
- [ ] Create 3 Vapi assistants (one per country)
- [ ] Associate phone number → assistant in Vapi dashboard
- [ ] Test: call each number → correct assistant picks up
- [ ] Test: assistant uses correct voice + correct system prompt + correct tools

### Phase 4: Webhook routing (1-2 days, $0)
- [ ] Update `order.ts`: detect country from customer.phone, lookup matching boss
- [ ] Update `vapi/tools/route.ts`: country-aware validate_service + get_price_quote
- [ ] Test: end-to-end call → work_order with correct boss_id + country

### Phase 5: Dashboard split (2-3 days, $0)
- [ ] Create `/[country]/page.tsx` dynamic route
- [ ] Update nav: tabs for US / SG / MY / ID
- [ ] Add country flag + team name + currency to work order rows
- [ ] Update source counts to break down by country

### Phase 6: Multi-team per country (Phase 2+, $0)
- [ ] Add `boss_routing_rules` table for zipcode-based routing within country
- [ ] Add load balancing / sticky routing for multi-team markets
- [ ] Test: customer in zipcode 77002 → Alex team; customer in 77099 → other team

### Phase 7: Demo data (1 day, $0)
- [ ] Write `scripts/seed-sea-demo-data.js`
- [ ] Seed 5-10 records × 3 countries
- [ ] Backfill 1-2 production records per country (real test calls)

**Total time to multi-region ready:** ~3-4 weeks
**Total cost:** ~$15-30/mo (Vapi numbers + ElevenLabs clones + STT/TTS)

## 8. Cost per 1000 calls (multi-region)

| Component | US | SG | MY | ID |
|---|---|---|---|---|
| Vapi phone | $1.50 | $1.50 | $1.50 | $1.50 |
| STT | $4.30 (Deepgram) | $4.30 (AssemblyAI) | $4.30 (AssemblyAI) | $6.00 (Whisper) |
| LLM (gpt-4o-mini extraction) | $0.15 | $0.15 | $0.15 | $0.15 |
| TTS (11labs Pro clone) | $5-22 | $5-22 | $5-22 | $5-22 |
| Twilio SMS | $0.50 | $0.50 | $0.50 | $0.50 |
| **Total per 1000 calls** | **$11-28** | **$11-28** | **$11-28** | **$13-30** |

## 9. Migration from current state

### Step 1: Run migration 010 (bosses columns) — safe, additive
```sql
ALTER TABLE bosses
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'USD',
  ...;
```

### Step 2: Backfill existing boss
```sql
UPDATE bosses
SET country = 'US', company_name = 'Handy Works Home Services',
    currency_code = 'USD', currency_symbol = '$',
    timezone = 'America/Chicago', locale = 'en-US';
```

### Step 3: Backfill existing work_orders
```sql
UPDATE work_orders
SET country = CASE
  WHEN customer_phone LIKE '+1%' THEN 'US'
  WHEN customer_phone LIKE '+65%' THEN 'SG'
  WHEN customer_phone LIKE '+60%' THEN 'MY'
  WHEN customer_phone LIKE '+62%' THEN 'ID'
  ELSE 'US'
END
WHERE country IS NULL;
```

### Step 4: Insert new bosses (idempotent)
```sql
INSERT INTO bosses (...) VALUES (..., 'SG', ...) ON CONFLICT DO NOTHING;
INSERT INTO bosses (...) VALUES (..., 'MY', ...) ON CONFLICT DO NOTHING;
INSERT INTO bosses (...) VALUES (..., 'ID', ...) ON CONFLICT DO NOTHING;
```

### Step 5: Add new routes to dashboard
- `src/app/[country]/page.tsx` (dynamic)
- Update nav with country flags

### Step 6: Buy numbers + create assistants (1-2 weeks)
- Vapi dashboard: buy 3 numbers (SG/MY/ID)
- Vapi dashboard: create 3 assistants
- Vapi dashboard: associate number → assistant

### Step 7: Update tools (1-2 days)
- validate_service: accept country parameter
- get_price_quote: return country-specific price

## 10. Risks & mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Multi-team routing misroutes call | Low | High | Default to US Alex; add explicit country check; log routing decisions |
| Vapi number unavailable in target country | Low | High | Use Twilio direct numbers + Vapi BYOC (Bring Your Own Carrier) |
| Currency confusion (USD vs SGD vs MYR) | Medium | Medium | Currency code in work_order; dashboard displays with $ / S$ / RM / Rp symbols |
| Time zone confusion (Houston vs Singapore) | Medium | Low | Dashboard shows times in user's browser local time via Intl.DateTimeFormat |
| ID has multiple time zones (WIB/WITA/WIT) | Medium | Low | Store timezone in `bosses` table; display in local time |

## 11. Open questions for user decision

1. **Currency display**: show $89 vs S$89 vs RM89 — same number different symbol?
2. **Multi-team per country v1**: do we need it on day 1, or is 1 team per country enough?
3. **Number purchase**: which country first — SG (cheapest, most data), MY (medium), or ID (hardest)?
4. **Voice cloning**: do we record 1 voice per country or 1 voice per team (if multi-team later)?
5. **Pricing**: should trip fee be same $89 USD equivalent across countries, or local-priced?

## 12. Immediate next steps (when user approves)

1. Run migration 010 (additive, no breaking change)
2. Backfill existing boss + work_orders
3. Insert 3 new bosses (SG/MY/ID)
4. Write `seed-sea-demo-data.js` + seed 5-10 records × 3 countries
5. Test dashboard: `/` shows everything, country chip visible

**Implementation start time:** 1-2 days for Phase 1 (schema + data). Phases 2-5 (tooling + Vapi + dashboard) are 2-3 weeks.

**Open question for you:** which country to start with for Vapi number purchase? (Recommendation: SG first — best tech readiness, most demo impact, lowest STT cost.)

---

*This is a planning document. No code changes are proposed without user approval.*
