import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getDefaultBoss, createOrUpdateWorkOrder } from "@/lib/order";
import type { VapiWebhookPayload } from "@/lib/types";

/**
 * Vapi Webhook — receives call lifecycle events from Vapi.
 *
 * Events we care about:
 * - status-update: call started, ringing, ended, etc.
 * - end-of-call-report: call finished, has transcript + analysis
 * - tool-calls: function call results (for live tracking)
 *
 * Docs: https://docs.vapi.ai/server-url
 *
 * We verify the request is from Vapi by checking the `serverUrlSecret`
 * header (set in Vapi dashboard as "Server URL Secret").
 */

// Vapi sends events as a flat object — we normalize to { message: {...} }
function normalizePayload(body: unknown): VapiWebhookPayload {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid webhook payload");
  }
  const obj = body as Record<string, unknown>;
  // Vapi sometimes sends {message: {...}}, sometimes flat — handle both
  if (obj.message && typeof obj.message === "object") {
    return obj as unknown as VapiWebhookPayload;
  }
  return { message: obj as unknown as VapiWebhookPayload["message"] };
}

export async function POST(req: NextRequest) {
  // Verify webhook secret (header set by Vapi)
  const secret = req.headers.get("x-vapi-secret") || req.headers.get("x-webhook-secret");
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    console.warn("[webhook] Invalid or missing secret");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: VapiWebhookPayload;
  try {
    const body = await req.json();
    payload = normalizePayload(body);
  } catch (err) {
    console.error("[webhook] Failed to parse body:", err);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { message } = payload;
  const eventType = message.type;
  const callId = message.call?.id;

  console.log(`[webhook] Event: ${eventType}, call: ${callId}`);

  // Log all raw events to call_events for debugging
  try {
    const supabase = getServiceClient();
    await supabase.from("call_events").insert({
      vapi_call_id: callId || null,
      event_type: eventType,
      payload: payload as unknown,
    });
  } catch (err) {
    console.error("[webhook] Failed to log event:", err);
  }

  // Handle the events that matter
  try {
    if (eventType === "end-of-call-report") {
      await handleEndOfCall(message);
    } else if (eventType === "status-update") {
      await handleStatusUpdate(message);
    } else if (eventType === "tool-calls") {
      // Tool call events are mostly for monitoring — the actual tool
      // responses are sent back inline from the /tools endpoint
      console.log("[webhook] tool-calls:", JSON.stringify(message.toolCalls));
    }
    // Other event types (transcript, conversation-update, etc.) are logged
    // but don't trigger business logic
  } catch (err) {
    console.error(`[webhook] Handler failed for ${eventType}:`, err);
    return NextResponse.json({ error: "handler_failed", message: String(err) }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEndOfCall(message: VapiWebhookPayload["message"]) {
  const callId = message.call?.id;
  if (!callId) {
    console.warn("[webhook] end-of-call-report without call.id");
    return;
  }

  const boss = await getDefaultBoss();
  if (!boss) {
    console.error("[webhook] No boss configured — cannot create work order");
    return;
  }

  // Link the call_events to a work_order
  const supabase = getServiceClient();

  // Create or update the work order
  const order = await createOrUpdateWorkOrder(boss, callId, message);

  // Backfill call_events with work_order_id
  await supabase
    .from("call_events")
    .update({ work_order_id: order.id })
    .eq("vapi_call_id", callId);

  console.log(`[webhook] Work order ${order.id} (${order.ai_decision}) created/updated for call ${callId}`);
}

async function handleStatusUpdate(message: VapiWebhookPayload["message"]) {
  const status = message.status;
  const callId = message.call?.id;
  console.log(`[webhook] Call ${callId} status: ${status}`);

  if (status === "in-progress" && callId) {
    // Create a placeholder work_order in "AI processing" state
    // so the boss sees the call happening in real-time
    const supabase = getServiceClient();
    const { data: existing } = await supabase
      .from("work_orders")
      .select("id")
      .eq("vapi_call_id", callId)
      .single();

    if (!existing) {
      const boss = await getDefaultBoss();
      if (!boss) return;

      const customerNumber = message.call?.customer?.number || "";
      const { data, error } = await supabase
        .from("work_orders")
        .insert({
          boss_id: boss.id,
          customer_phone: customerNumber,
          ai_decision: "unsure", // placeholder
          status: "pending",
          vapi_call_id: callId,
          summary: "📞 Call in progress...",
        })
        .select()
        .single();

      if (error) {
        console.error("[webhook] Failed to create placeholder order:", error);
      } else {
        console.log(`[webhook] Placeholder work order ${data.id} created for call ${callId}`);
      }
    }
  }
}

// Disable body parsing so we get the raw body — Next.js does this by default in App Router
export const dynamic = "force-dynamic";
