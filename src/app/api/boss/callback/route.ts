import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { initiateCallback } from "@/lib/notify";

/**
 * POST /api/boss/callback
 *
 * Boss taps "Call back" on a work order. Marks the order as callback-initiated
 * and sends a click-to-call SMS to the boss.
 *
 * Body: { workOrderId: string }
 */
export async function POST(req: NextRequest) {
  let body: { workOrderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { workOrderId } = body;
  if (!workOrderId) {
    return NextResponse.json({ error: "missing_work_order_id" }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();
    const { data: order, error } = await supabase
      .from("work_orders")
      .select("*")
      .eq("id", workOrderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "work_order_not_found" }, { status: 404 });
    }

    await initiateCallback(order);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[callback] Failed:", errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

/**
 * PATCH /api/boss/callback
 *
 * Boss updates a work order's status (confirm / reject / cancel).
 *
 * Body: { workOrderId: string, status: 'confirmed' | 'rejected' | 'completed' | 'cancelled' }
 */
export async function PATCH(req: NextRequest) {
  let body: { workOrderId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { workOrderId, status } = body;
  if (!workOrderId || !status) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const valid = ["confirmed", "rejected", "completed", "cancelled"];
  if (!valid.includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();
    const updateData: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "confirmed") {
      updateData.confirmed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("work_orders")
      .update(updateData)
      .eq("id", workOrderId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[callback] PATCH failed:", errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
