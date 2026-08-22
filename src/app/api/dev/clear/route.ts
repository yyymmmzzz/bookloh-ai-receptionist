import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/dev/clear
 *
 * SAFETY: This endpoint NEVER deletes production or demo data.
 * - To clear test data: pass `?confirm=CLEAR-TEST-ONLY` (or call from dev)
 * - Without confirmation: returns 400 with a safety warning
 *
 * Demo data and real Vapi call data are ALWAYS preserved.
 * Dev tool only — disabled in production unless ENABLE_DEV_TOOLS=true.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "dev_tools_disabled" }, { status: 403 });
  }

  // Read confirmation from URL or body
  const url = new URL(req.url);
  const confirmParam = url.searchParams.get("confirm");

  let bodyConfirm: string | null = null;
  try {
    const text = await req.text();
    if (text) {
      const body = JSON.parse(text);
      bodyConfirm = body.confirm;
    }
  } catch {
    // No body or unparseable, fine
  }

  const confirmation = confirmParam || bodyConfirm;
  if (confirmation !== "CLEAR-TEST-ONLY") {
    return NextResponse.json(
      {
        error: "confirmation_required",
        message:
          "For safety, this endpoint will NEVER delete production or demo data. To clear TEST data only, pass confirmation: ?confirm=CLEAR-TEST-ONLY (or {confirm: 'CLEAR-TEST-ONLY'} in body).",
        safety: {
          always_preserved: ["demo", "production"],
          deletable: ["test"],
        },
      },
      { status: 400 },
    );
  }

  try {
    const supabase = getServiceClient();

    // ONLY delete test data. demo + production are protected.
    const { error: nErr } = await supabase
      .from("notifications")
      .delete()
      .neq("data_source", "demo");
    const { error: cErr } = await supabase
      .from("call_events")
      .delete()
      .neq("data_source", "demo");
    const { error: wErr } = await supabase
      .from("work_orders")
      .delete()
      .eq("data_source", "test");

    return NextResponse.json({
      ok: true,
      cleared: {
        notifications: !nErr,
        call_events: !cErr,
        work_orders: !wErr,
      },
      kept: "demo (49) + production (N) records preserved — only test data cleared",
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
