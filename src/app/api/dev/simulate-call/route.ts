import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getDefaultBoss, createOrUpdateWorkOrder } from "@/lib/order";

/**
 * POST /api/dev/simulate-call
 *
 * Simulates a Vapi end-of-call-report webhook without making a real phone call.
 * Useful for testing the full work-order-creation flow.
 *
 * Body (optional):
 * {
 *   scenario: "accept" | "urgent" | "unsure" | "reject"  // default: "accept"
 *   customerNumber?: string  // default: random Houston number
 *   customerName?: string
 * }
 *
 * Only available in dev mode.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "dev_tools_disabled" }, { status: 403 });
  }

  let body: {
    scenario?: "accept" | "urgent" | "unsure" | "reject";
    customerNumber?: string;
    customerName?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const scenario = body.scenario || "accept";
  const customerNumber = body.customerNumber || `+1713${Math.floor(5550000 + Math.random() * 9999)}`;
  const customerName = body.customerName || "Test Customer";

  const boss = await getDefaultBoss();
  if (!boss) {
    return NextResponse.json(
      { error: "no_boss_found", hint: "Seed the database first (POST /api/dev/seed or run SQL seed)" },
      { status: 400 },
    );
  }

  // Build a synthetic Vapi end-of-call-report payload
  const callId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = buildVapiPayload(scenario, customerNumber, customerName, callId);

  // Post it to the webhook handler logic
  // (We directly call the create logic instead of going through HTTP to avoid auth)
  const supabase = getServiceClient();
  const message = payload.message as unknown as Parameters<typeof createOrUpdateWorkOrder>[2];
  const order = await createOrUpdateWorkOrder(boss, callId, message);

  // Log the simulated event
  await supabase.from("call_events").insert({
    vapi_call_id: callId,
    event_type: "end-of-call-report",
    payload: payload as unknown,
    work_order_id: order.id,
  });

  return NextResponse.json({
    ok: true,
    scenario,
    workOrder: {
      id: order.id,
      ai_decision: order.ai_decision,
      status: order.status,
      summary: order.summary,
      customer_phone: order.customer_phone,
    },
    openInDashboard: `/orders/${order.id}`,
  });
}

function buildVapiPayload(
  scenario: "accept" | "urgent" | "unsure" | "reject",
  customerNumber: string,
  customerName: string,
  callId: string,
) {
  const transcripts: Record<string, Array<{ role: string; message: string }>> = {
    accept: [
      { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?" },
      { role: "user", message: "Hi, my kitchen sink is leaking under the cabinet." },
      { role: "assistant", message: "Sorry to hear that. What's your zip code?" },
      { role: "user", message: "77006" },
      { role: "assistant", message: "Got it. When did it start?" },
      { role: "user", message: "Last night, it's been dripping all night." },
      { role: "assistant", message: "And when are you available for a visit?" },
      { role: "user", message: "Friday afternoon works." },
      { role: "assistant", message: "Great. I can give you a reference range — our diagnostic fee is $89, which goes toward the repair. For kitchen sink leaks, typical cost is $150 to $400, but the final price depends on what we find on site. We can probably get someone out Friday afternoon — someone will call you to confirm the exact time. Can I get your name?" },
      { role: "user", message: `${customerName}. And the number you're calling from is fine.` },
      { role: "assistant", message: "Perfect, I've got everything. Someone will call you Friday morning to confirm. Thanks for calling!" },
    ],
    urgent: [
      { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. How can I help?" },
      { role: "user", message: "My pipe burst! Water is everywhere!" },
      { role: "assistant", message: "I understand. Let me have someone call you back in 5 to 15 minutes. Can I get your zip code and phone number?" },
      { role: "user", message: "77008, the number you're calling from is my cell." },
      { role: "assistant", message: "Got it. I'm flagging this as urgent. Stay safe — someone will call you back within 15 minutes." },
    ],
    unsure: [
      { role: "assistant", message: "Hi, thanks for calling. How can I help?" },
      { role: "user", message: "I need help with my septic tank. It smells bad." },
      { role: "assistant", message: "Let me check with my team on that and call you back with details. Can I get your name and number?" },
      { role: "user", message: `${customerName}, ${customerNumber}` },
      { role: "assistant", message: "Thanks. Someone will call you back shortly." },
    ],
    reject: [
      { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. How can I help?" },
      { role: "user", message: "I have an outlet that stopped working. I'm in Dallas, 75201." },
      { role: "assistant", message: "I'm sorry, Dallas is outside our service area — we cover the Houston metroplex. I'd recommend searching for an electrician closer to you on Google. Have a good day." },
    ],
  };

  const toolCallList = (() => {
    if (scenario === "accept") {
      return [
        {
          id: "tc_1",
          type: "function",
          function: {
            name: "validate_service",
            arguments: { zipcode: "77006", issue_type: "plumbing" },
            result: JSON.stringify({ ok: true, distance_miles: 4.2 }),
          },
        },
        {
          id: "tc_2",
          type: "function",
          function: {
            name: "get_price_quote",
            arguments: { issue_type: "plumbing" },
            result: JSON.stringify({ available: true, diagnostic_fee: 89, range: { low: 150, high: 400 } }),
          },
        },
        {
          id: "tc_3",
          type: "function",
          function: {
            name: "end_call",
            arguments: {
              outcome: "accepted",
              summary: "Kitchen sink leak at 77006, available Friday afternoon. Quote: $150-$400 + $89 diagnostic.",
            },
            result: JSON.stringify({ ended: true, outcome: "accepted" }),
          },
        },
      ];
    } else if (scenario === "urgent") {
      return [
        {
          id: "tc_1",
          type: "function",
          function: {
            name: "flag_urgent",
            arguments: { reason: "water everywhere, burst pipe" },
            result: JSON.stringify({ flagged: true, severity: "urgent" }),
          },
        },
        {
          id: "tc_2",
          type: "function",
          function: {
            name: "end_call",
            arguments: {
              outcome: "urgent",
              summary: "Burst pipe, water everywhere. 77008. Call back in 5-15 min.",
            },
            result: JSON.stringify({ ended: true, outcome: "urgent" }),
          },
        },
      ];
    } else if (scenario === "unsure") {
      return [
        {
          id: "tc_1",
          type: "function",
          function: {
            name: "flag_uncertain",
            arguments: { reason: "septic tank not in price list" },
            result: JSON.stringify({ flagged: true, severity: "callback" }),
          },
        },
        {
          id: "tc_2",
          type: "function",
          function: {
            name: "end_call",
            arguments: {
              outcome: "unsure",
              summary: "Septic tank issue. Need boss follow-up.",
            },
            result: JSON.stringify({ ended: true, outcome: "unsure" }),
          },
        },
      ];
    } else {
      return [
        {
          id: "tc_1",
          type: "function",
          function: {
            name: "validate_service",
            arguments: { zipcode: "75201", issue_type: "electrical" },
            result: JSON.stringify({ ok: false, reason: "Outside service area", distance_miles: 240 }),
          },
        },
        {
          id: "tc_2",
          type: "function",
          function: {
            name: "end_call",
            arguments: {
              outcome: "rejected",
              summary: "Outlet issue in Dallas (75201) — outside service area.",
            },
            result: JSON.stringify({ ended: true, outcome: "rejected" }),
          },
        },
      ];
    }
  })();

  return {
    message: {
      type: "end-of-call-report",
      call: {
        id: callId,
        orgId: "demo-org",
        type: "inboundPhoneCall" as const,
        customer: { number: customerNumber, name: customerName },
        startedAt: new Date(Date.now() - 180000).toISOString(),
        endedAt: new Date().toISOString(),
        cost: 0.12,
        recordingUrl: null,
      },
      messages: transcripts[scenario].map((m, i) => ({
        role: m.role,
        message: m.message,
        time: Date.now() - (transcripts[scenario].length - i) * 10000,
      })),
      toolCallList,
      summary:
        scenario === "accept"
          ? "Kitchen sink leak at 77006, available Friday afternoon"
          : scenario === "urgent"
            ? "URGENT: Burst pipe, water everywhere, 77008"
            : scenario === "unsure"
              ? "Septic tank — needs boss follow-up"
              : "Outlet in Dallas — out of service area",
    },
  };
}

export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "dev_tools_disabled" }, { status: 403 });
  }
  return NextResponse.json({
    description: "POST to simulate a Vapi end-of-call-report. Body: { scenario: 'accept'|'urgent'|'unsure'|'reject' }",
  });
}
