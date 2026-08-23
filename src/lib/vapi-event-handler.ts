import { getServiceClient } from "./supabase";
import { getDefaultBoss, getBossByCountry, createOrUpdateWorkOrder, detectCountryFromPhone } from "./order";
import type { VapiWebhookPayload } from "./types";

/**
 * Shared Vapi event handlers — used by both /api/vapi/webhook and
 * /api/vapi/tools routes. Vapi sends ALL events to one serverUrl, so
 * each route should be able to handle any event type. This is a
 * belt-and-suspenders setup: phone number + emergency assistant are
 * pointed at /api/vapi/webhook, but the main assistant's serverUrl
 * still points at /api/vapi/tools (legacy config). If Vapi ever
 * changes which URL events go to, the other route will catch them.
 *
 * Multi-region: when a call comes in, we detect the country from the
 * customer's phone number prefix and use the matching country's boss.
 * If no country-specific boss is configured, fall back to default (US).
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
    console.log(`[vapi] tool-calls event (${(message.toolCalls || []).length} calls) — should be handled by /tools route`);
    return { handled: false, note: "tool-calls must be handled by /tools" };
  }

  return { handled: true, note: `event_type=${eventType} logged but no business action` };
}

/**
 * Look up the boss based on the customer's phone number country prefix.
 * For multi-region, this picks the US / SG / MY / ID boss accordingly.
 */
async function pickBossForCall(message: VapiWebhookPayload["message"]) {
  const customerNumber = message.call?.customer?.number;
  // Also check the dialed (Vapi) number as fallback — when Vapi sends
  // end-of-call-report, the customer's number is usually present, but
  // for some flows (outbound) only the Vapi number is available.
  const vapiNumber = (message as { phoneNumber?: { number?: string } }).phoneNumber?.number;
  const candidate = customerNumber || vapiNumber;
  const country = detectCountryFromPhone(candidate);
  if (country) {
    return getBossByCountry(country);
  }
  return getDefaultBoss();
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

  const boss = await pickBossForCall(message);
  if (!boss) {
    console.error("[vapi] No boss configured — cannot create work order");
    return;
  }
  const customerNumber = message.call?.customer?.number;
  const country = detectCountryFromPhone(customerNumber);
  if (country && boss.country && boss.country !== country) {
    console.warn(`[vapi] Country mismatch: customer phone=${country}, boss country=${boss.country} — using ${boss.country} boss anyway`);
  }

  const supabase = getServiceClient();
  const order = await createOrUpdateWorkOrder(boss, callId, message, undefined, dataSource);

  // Backfill call_events with work_order_id
  await supabase
    .from("call_events")
    .update({ work_order_id: order.id })
    .eq("vapi_call_id", callId);

  console.log(`[vapi] Work order ${order.id} (${order.ai_decision}) created/updated for call ${callId} (country=${boss.country || "US"})`);
}

async function handleStatusUpdate(
  message: VapiWebhookPayload["message"],
  dataSource: DataSource,
): Promise<void> {
  const status = message.status;
  const callId = message.call?.id;
  console.log(`[vapi] Call ${callId} status: ${status}`);

  if (status === "in-progress" && callId) {
    const supabase = getServiceClient();
    const { data: existing } = await supabase
      .from("work_orders")
      .select("id")
      .eq("vapi_call_id", callId)
      .single();

    if (!existing) {
      const boss = await pickBossForCall(message);
      if (!boss) return;

      const customerNumber = message.call?.customer?.number || "";
      const country = detectCountryFromPhone(customerNumber) || boss.country || "US";
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
          country: country,
        })
        .select()
        .single();

      if (error) {
        console.error("[vapi] Failed to create placeholder order:", error);
      } else {
        console.log(`[vapi] Placeholder work order ${data.id} created for call ${callId} (country=${country})`);
      }
    }
  }
}
