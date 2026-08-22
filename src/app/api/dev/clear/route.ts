import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/dev/clear
 *
 * Clears test + production work orders and notifications (keeps the boss
 * record and demo data). Use to start fresh for test scenarios.
 * Dev tool only.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "dev_tools_disabled" }, { status: 403 });
  }

  try {
    const supabase = getServiceClient();

    // Only clear test + production; keep demo records so the dashboard
    // stays populated when running regression tests.
    // (notifications and call_events don't have data_source, so clear all)
    const { error: nErr } = await supabase.from("notifications").delete().not("id", "is", null);
    const { error: cErr } = await supabase.from("call_events").delete().not("id", "is", null);
    const { error: wErr } = await supabase
      .from("work_orders")
      .delete()
      .neq("data_source", "demo");

    return NextResponse.json({
      ok: true,
      cleared: {
        notifications: !nErr,
        call_events: !cErr,
        work_orders: !wErr,
      },
      kept: "demo records (data_source='demo') preserved",
      errors: {
        notifications: nErr?.message,
        call_events: cErr?.message,
        work_orders: wErr?.message,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
