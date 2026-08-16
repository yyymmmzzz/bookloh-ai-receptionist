import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/dev/clear
 *
 * Clears all work orders and notifications (keeps the boss record).
 * Dev tool only.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "dev_tools_disabled" }, { status: 403 });
  }

  try {
    const supabase = getServiceClient();

    const { error: nErr } = await supabase.from("notifications").delete().not("id", "is", null);
    const { error: cErr } = await supabase.from("call_events").delete().not("id", "is", null);
    const { error: wErr } = await supabase.from("work_orders").delete().not("id", "is", null);
    const { error: custErr } = await supabase.from("customers").delete().not("id", "is", null);

    return NextResponse.json({
      ok: true,
      cleared: {
        notifications: !nErr,
        call_events: !cErr,
        work_orders: !wErr,
        customers: !custErr,
      },
      errors: {
        notifications: nErr?.message,
        call_events: cErr?.message,
        work_orders: wErr?.message,
        customers: custErr?.message,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
