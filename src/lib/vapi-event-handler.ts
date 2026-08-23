import { getServiceClient } from "./supabase";
import { getDefaultBoss, createOrUpdateWorkOrder } from "./order";
import type { VapiWebhookPayload } from "./types";

/**
 * Shared Vapi event handlers — used by both /api/vapi/webhook and
 * /api/vapi/tools routes. Vapi sends ALL events to one serverUrl, so
 * each route should be able to handle any event type. This is a
 * belt-and-suspenders setup: phone number + emergency assistant are
 * pointed at /api/vapi/webhook, but the main assistant's serverUrl
 * still points at /api/vapi/tools (legacy config). If Vapi ever
 * changes which URL events go to, the other route will catch them.
 */

type DataSource = "production" | "test" | "demo";

export async function handleVapiEvent(
  payload: VapiWebhookPayload,
  dataSource: DataSource = "production",
): Promise<{ handled: boolean; note?: string }> {
  const { message } = payload;
  const eventType = message.type;
  const callId = message.call?.id;

  // Log every event to call_events for debugging — both routes share this
  try {
    const supabase = getServiceClient();
    await supabase.from("call_events").insert({
      vapi_call_id: callId || null,
      event_type: eventType,
      payload: payload as unknown,
    });
  } catch (err) {
    // Don't fail the whole flow on logging errors
    console.error(`[vapi] Failed to log ${eventType} event:`, err);
  }

  if (eventType === "end-of-call-report") {
    await handleEndOfCall(message, dataSource);
    return { handled: true };
  }

  if (eventType === "status-update") {
    await handleStatusUpdate(message, dataSource);
    return { handled: true };
  }

  if (eventType === "tool-calls") {
    // Tool calls are handled inline by the /api/vapi/tools route — it
    // needs to return the results back to Vapi in the same response.
    // So this route just acknowledges them.
    console.log(`[vapi] tool-calls event (${(message.toolCalls || []).length} calls) — should be handled by /tools route`);
    return { handled: false, note: "tool-calls must be handled by /tools" };
  }

  // Other event types (transcript, conversation-update, etc.) are logged
  // but don't trigger business logic
  return { handled: true, note: `event_type=${eventType} logged but no business action` };
}

async function handleEndOfCall(
  message: VapiWebhookPayload["message"],
  dataSource: DataSource,
): Promise<void> {
  const callId = message.call?.id;
  if (!callId) {
    console.warn("[vapi] end-of-call-report without call.id");
    return;
  }

  const boss = await getDefaultBoss();
  if (!boss) {
    console.error("[vapi] No boss configured — cannot create work order");
    return;
  }

  const supabase = getServiceClient();
  const order = await createOrUpdateWorkOrder(boss, callId, message, undefined, dataSource);

  // Backfill call_events with work_order_id
  await supabase
    .from("call_events")
    .update({ work_order_id: order.id })
    .eq("vapi_call_id", callId);

  console.log(`[vapi] Work order ${order.id} (${order.ai_decision}) created/updated for call ${callId}`);
}

async function handleStatusUpdate(
  message: VapiWebhookPayload["message"],
  dataSource: DataSource,
): Promise<void> {
  const status = message.status;
  const callId = message.call?.id;
  console.log(`[vapi] Call ${callId} status: ${status}`);

  if (status === "in-progress" && callId) {
    // Create a placeholder work_order so the boss sees the call happening
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
          data_source: dataSource,
        })
        .select()
        .single();

      if (error) {
        console.error("[vapi] Failed to create placeholder order:", error);
      } else {
        console.log(`[vapi] Placeholder work order ${data.id} created for call ${callId}`);
      }
    }
  }
}
