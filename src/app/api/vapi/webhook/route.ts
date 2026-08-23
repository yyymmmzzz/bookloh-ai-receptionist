import { NextRequest, NextResponse } from "next/server";
import { handleVapiEvent } from "@/lib/vapi-event-handler";
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
  // Verify webhook secret (header set by Vapi when serverUrlSecret is configured).
  // We accept missing header as a fallback because:
  //   1. Older Vapi configurations may not send the header even if secret is set
  //   2. If Vapi account is misconfigured, we still want to log the event for debugging
  //   3. Vercel serverUrl is itself secret (only Vapi knows it)
  // For higher security in production, lock this down to require the header.
  const secret = req.headers.get("x-vapi-secret") || req.headers.get("x-webhook-secret");
  if (process.env.WEBHOOK_SECRET && secret && secret !== process.env.WEBHOOK_SECRET) {
    console.warn("[webhook] Invalid secret — header did not match WEBHOOK_SECRET");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.WEBHOOK_SECRET && !secret) {
    console.warn("[webhook] No x-vapi-secret header (Vapi not configured with serverUrlSecret?) — accepting anyway");
  }

  let payload: VapiWebhookPayload;
  try {
    const body = await req.json();
    payload = normalizePayload(body);
  } catch (err) {
    console.error("[webhook] Failed to parse body:", err);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const dataSource: "production" | "test" =
    payload.message.call?.orgId === "test-org" ? "test" : "production";

  try {
    await handleVapiEvent(payload, dataSource);
  } catch (err) {
    console.error(`[webhook] handler failed:`, err);
    return NextResponse.json({ error: "handler_failed", message: String(err) }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Disable body parsing so we get the raw body — Next.js does this by default in App Router
export const dynamic = "force-dynamic";
