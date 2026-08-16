import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import type { AIDecision, WorkOrder, WorkOrderStatus } from "@/lib/types";

/**
 * POST /api/dev/seed
 *
 * Inserts a set of realistic, demo-grade fake work orders. Covers all 4 AI
 * decisions across multiple customers, with diverse scenarios and time spread.
 *
 * Re-running this will clear and re-seed (idempotent for demo purposes).
 *
 * Only available when NODE_ENV !== "production" OR ENABLE_DEV_TOOLS=true.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "dev_tools_disabled" }, { status: 403 });
  }

  try {
    const supabase = getServiceClient();

    // Get the default boss
    const { data: boss, error: bossErr } = await supabase
      .from("bosses")
      .select("id")
      .limit(1)
      .single();

    if (bossErr || !boss) {
      return NextResponse.json(
        {
          error: "no_boss_found",
          hint: "Run the SQL seed in Supabase first (supabase/schema.sql)",
        },
        { status: 400 },
      );
    }

    const now = Date.now();
    const min = 60 * 1000;
    const hour = 60 * min;

    // Wipe previous seed/clear data (keep the boss record)
    await supabase
      .from("work_orders")
      .delete()
      .or("vapi_call_id.like.seed-%,vapi_call_id.like.sim-%");

    // Realistic Houston-area zips within 25-mile radius of 77002
    const fixtures: SeedFixture[] = [
      // ==== Most recent: 1 urgent (red) ====
      {
        minutesAgo: 3,
        customer: { name: "John Miller", phone: "+17135551234", address: "1234 Main St", city: "Houston", zip: "77002" },
        issue: { type: "hvac", details: "AC completely stopped working. It's 100°F outside and my kids are home. Started blowing room-temp air around 2pm today.", preferredTime: "ASAP — kids are home" },
        decision: "urgent",
        reason: "Customer reports AC failure during 100°F heat wave, kids at home",
        quote: { low: 200, high: 500 },
        status: "urgent",
        summary: "🚨 AC down in 100°F heat — John needs help NOW. 1234 Main St, 77002. Kids at home.",
        transcript: urgentTranscript,
      },

      // ==== 12 min ago: 1 accepted (pending) ====
      {
        minutesAgo: 12,
        customer: { name: "Sarah Johnson", phone: "+17135555678", address: "5678 Oak Ave", city: "Houston", zip: "77006" },
        issue: { type: "plumbing", details: "Kitchen sink drain very slow. Started about 2 days ago. Tried plunger, didn't help much.", preferredTime: "Friday afternoon (anytime after 1pm)" },
        decision: "accepted",
        reason: "In service area, in trade list, in price list",
        quote: { low: 150, high: 400 },
        status: "pending",
        summary: "Kitchen drain slow at 5678 Oak Ave, 77006. Sarah available Friday afternoon. Quote: $150–$400 + $89 diagnostic.",
        transcript: acceptTranscript,
      },

      // ==== 28 min ago: 1 callback (unsure) ====
      {
        minutesAgo: 28,
        customer: { name: "Mike Rodriguez", phone: "+17135559012", address: "9012 Pine St", city: "Houston", zip: "77008" },
        issue: { type: "handyman", details: "Need help assembling a large IKEA Pax wardrobe and mounting a 65\" TV on drywall. Have all the parts and mount kit.", preferredTime: "Saturday morning if possible" },
        decision: "unsure",
        reason: "Job is bigger than typical handyman scope — needs quote review",
        status: "callback",
        summary: "Furniture assembly + TV mount at 9012 Pine St, 77008. Mike available Saturday morning. Need to scope.",
        transcript: unsureTranscript,
      },

      // ==== 1 hour ago: 1 rejected (out of area) ====
      {
        minutesAgo: 65,
        customer: { name: "Lisa Chen", phone: "+12145554444", address: "4321 Elm St", city: "Dallas", zip: "75201" },
        issue: { type: "electrical", details: "Living room outlet stopped working. Tried the GFCI reset, no luck.", preferredTime: "Anytime this week" },
        decision: "rejected",
        reason: "Out of service area (240 miles from base zip 77002)",
        status: "rejected",
        summary: "Outlet not working in Dallas (75201) — 240 miles away, outside our 25-mile service area. Referred to local search.",
        transcript: rejectTranscript,
      },

      // ==== 2 hours ago: 1 confirmed ====
      {
        minutesAgo: 120,
        customer: { name: "Carlos Mendez", phone: "+17135557777", address: "7777 Bayou Dr", city: "Houston", zip: "77019" },
        issue: { type: "electrical", details: "GFCI outlet in master bathroom keeps tripping. Reset works for a few hours then trips again.", preferredTime: "Today if possible" },
        decision: "accepted",
        reason: "Standard electrical issue, in area, in trade list",
        quote: { low: 120, high: 350 },
        status: "confirmed",
        summary: "GFCI outlet tripping at 7777 Bayou Dr, 77019. Carlos available today. Quote: $120–$350 + $89 diagnostic.",
        confirmedAgo: 30,
        transcript: acceptTranscript,
      },

      // ==== 3 hours ago: 1 customer wants real person (unsure) ====
      {
        minutesAgo: 185,
        customer: { name: "Patricia Williams", phone: "+17135553344", address: "3344 Westheimer Rd", city: "Houston", zip: "77027" },
        issue: { type: "general", details: "Garage door opener making grinding noise, intermittently doesn't open.", preferredTime: "Tuesday or Wednesday" },
        decision: "unsure",
        reason: "Customer specifically asked to talk to a person",
        status: "callback",
        summary: "Garage door opener grinding at 3344 Westheimer, 77027. Patricia asked for the owner. Available Tue/Wed.",
        transcript: personWantsHumanTranscript,
      },

      // ==== 5 hours ago: 1 confirmed and completed ====
      {
        minutesAgo: 320,
        customer: { name: "David Park", phone: "+17135552211", address: "2211 Heights Blvd", city: "Houston", zip: "77008" },
        issue: { type: "handyman", details: "Need to replace 3 ceiling fan light fixtures and patch a few nail holes in the drywall.", preferredTime: "Yesterday" },
        decision: "accepted",
        reason: "Standard handyman job",
        quote: { low: 100, high: 300 },
        status: "completed",
        summary: "Fan fixture replacement + drywall patch at 2211 Heights Blvd, 77008. David, yesterday. Completed 2h later.",
        confirmedAgo: 300,
        completedAgo: 60,
        transcript: acceptTranscript,
      },

      // ==== Yesterday: 1 rejected (wrong trade) ====
      {
        minutesAgo: 60 * 26, // 26 hours ago
        customer: { name: "Robert Kim", phone: "+17135558899", address: "8899 Memorial Dr", city: "Houston", zip: "77024" },
        issue: { type: "general", details: "Need a full kitchen remodel — new cabinets, countertops, flooring, paint.", preferredTime: "Looking to start next month" },
        decision: "rejected",
        reason: "Out of scope — full kitchen remodel beyond handyman service",
        status: "rejected",
        summary: "Full kitchen remodel request — beyond handyman scope. Referred to a general contractor.",
        transcript: rejectScopeTranscript,
      },
    ];

    const rows = fixtures.map((f, i) => ({
      boss_id: boss.id,
      customer_name: f.customer.name,
      customer_phone: f.customer.phone,
      customer_address: `${f.customer.address}, ${f.customer.city}, TX ${f.customer.zip}`,
      customer_zipcode: f.customer.zip,
      issue_type: f.issue.type,
      issue_details: f.issue.details,
      preferred_time: f.issue.preferredTime,
      ai_decision: f.decision,
      ai_decision_reason: f.reason,
      quote_low: f.quote?.low ?? null,
      quote_high: f.quote?.high ?? null,
      summary: f.summary,
      status: f.status,
      confirmed_at: f.confirmedAgo ? new Date(now - f.confirmedAgo * min).toISOString() : null,
      vapi_call_id: `seed-${Date.now()}-${i}`,
      transcript: buildTranscript(f.transcript, f.minutesAgo),
      created_at: new Date(now - f.minutesAgo * min).toISOString(),
    }));

    const { data, error } = await supabase
      .from("work_orders")
      .insert(rows)
      .select("id, customer_name, ai_decision, status, created_at");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      seeded: data?.length || 0,
      orders: data,
      hint: "Open http://localhost:3000 to see the dashboard",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface SeedFixture {
  minutesAgo: number;
  customer: { name: string; phone: string; address: string; city: string; zip: string };
  issue: { type: string; details: string; preferredTime: string };
  decision: AIDecision;
  reason: string;
  quote?: { low: number; high: number };
  status: WorkOrderStatus;
  summary: string;
  transcript: Array<{ role: "assistant" | "user"; message: string }>;
  confirmedAgo?: number;
  completedAgo?: number;
}

type TranscriptLine = { role: "assistant" | "user"; message: string };

const urgentTranscript: TranscriptLine[] = [
  { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?" },
  { role: "user", message: "My AC just stopped working. It's 100 degrees outside and I have two kids at home." },
  { role: "assistant", message: "I understand, that's urgent. Let me have someone call you back in 5 to 15 minutes. Can I get your address and a callback number?" },
  { role: "user", message: "1234 Main Street, 77002. And the number you're calling from is my cell." },
  { role: "assistant", message: "Got it. I'm flagging this as urgent. Stay safe — Alex will call you back within 15 minutes." },
  { role: "user", message: "Thank you so much." },
];

const acceptTranscript: TranscriptLine[] = [
  { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?" },
  { role: "user", message: "Hi, my kitchen sink is leaking under the cabinet." },
  { role: "assistant", message: "Sorry to hear that. What's your zip code?" },
  { role: "user", message: "77006" },
  { role: "assistant", message: "Got it. When did it start?" },
  { role: "user", message: "Last night, it's been dripping all night." },
  { role: "assistant", message: "And when are you available for a visit?" },
  { role: "user", message: "Friday afternoon works." },
  { role: "assistant", message: "Great. I can give you a reference range — our diagnostic fee is $89, which goes toward the repair. For kitchen sink leaks, typical cost is $150 to $400, but the final price depends on what we find on site. We can probably get someone out Friday afternoon — someone will call you to confirm the exact time. Can I get your name?" },
  { role: "user", message: "Sarah Johnson. The number you're calling from is fine." },
  { role: "assistant", message: "Perfect, I've got everything. Someone will call you Friday morning to confirm. Thanks for calling!" },
];

const unsureTranscript: TranscriptLine[] = [
  { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?" },
  { role: "user", message: "Yeah hi, I need help with a few things. I bought a big wardrobe from IKEA and a 65-inch TV I want mounted on the wall." },
  { role: "assistant", message: "Sure, we can do that. What's your zip code?" },
  { role: "user", message: "77008" },
  { role: "assistant", message: "Great. When are you looking to get this done?" },
  { role: "user", message: "Saturday morning if possible, I work weekdays." },
  { role: "assistant", message: "Let me check with my team on the scope and call you back with a quote. Can I get your name and a good callback number?" },
  { role: "user", message: "Mike Rodriguez, this number is fine." },
  { role: "assistant", message: "Got it, Mike. Alex will call you back shortly with a quote for the assembly and TV mount. Thanks!" },
];

const rejectTranscript: TranscriptLine[] = [
  { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. How can I help you today?" },
  { role: "user", message: "Hi, I have an outlet that stopped working in my living room. I'm in Dallas, 75201." },
  { role: "assistant", message: "I'm sorry, Dallas is outside our service area — we cover the Houston metroplex, within about 25 miles of downtown. I'd recommend searching for an electrician closer to you on Google. Have a good day." },
  { role: "user", message: "Oh, okay. Thanks anyway." },
];

const rejectScopeTranscript: TranscriptLine[] = [
  { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. How can I help you today?" },
  { role: "user", message: "I want to do a full kitchen remodel — new cabinets, countertops, flooring, the works. Looking to start next month." },
  { role: "assistant", message: "I appreciate you calling, but a full kitchen remodel is bigger than what we handle. We do handyman and repair work — a remodel like that needs a general contractor. I'd recommend searching for \"kitchen remodel Houston\" on Google. Have a good day." },
  { role: "user", message: "Okay, thanks." },
];

const personWantsHumanTranscript: TranscriptLine[] = [
  { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. How can I help you?" },
  { role: "user", message: "Let me talk to a real person, please." },
  { role: "assistant", message: "No problem. Let me have Alex call you back in a few minutes. Can I get your name and a good callback number?" },
  { role: "user", message: "Patricia Williams, and you can call this number back." },
  { role: "assistant", message: "Got it, Patricia. Alex will call you back shortly." },
];

function buildTranscript(lines: TranscriptLine[], minutesAgo: number) {
  const startTime = Date.now() - minutesAgo * 60 * 1000;
  return lines.map((l, i) => ({
    role: l.role,
    text: l.message,
    ts: startTime + i * 8000, // ~8s between turns
  }));
}

export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "dev_tools_disabled" }, { status: 403 });
  }
  return NextResponse.json({
    description: "POST to seed 8 realistic fake work orders into the dashboard. Dev tools only.",
    nodeEnv: process.env.NODE_ENV,
  });
}
