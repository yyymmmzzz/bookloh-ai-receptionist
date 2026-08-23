/**
 * /api/admin/reclassify — re-run LLM extraction on existing production
 * records. Useful when:
 *   1. You add OPENAI_API_KEY after the fact and want to upgrade
 *      70-80% regex extraction to 95%+ LLM extraction for all old calls.
 *   2. You improve the LLM prompt and want to refresh without re-running
 *      real phone calls.
 *
 * Usage:
 *   POST /api/admin/reclassify
 *   Body: { "call_ids": [...], "admin_token": "..." }
 *
 * Auth: requires admin_token to match WEBHOOK_SECRET env var.
 * Rate limit: processes up to 20 calls per request (returns 400 if more).
 *
 * Note: This endpoint is only available in production (NODE_ENV=production).
 * The local dev server is configured to block this.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { summarizeWithLLM } from "@/lib/openai-summarize";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60s — Vercel Pro limit

const MAX_CALLS_PER_REQUEST = 20;

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { error: "disabled in dev" },
      { status: 403 },
    );
  }

  // Auth
  const authHeader = req.headers.get("x-admin-token") || "";
  const body = await req.json().catch(() => ({}));
  const adminToken = body.admin_token || authHeader;

  if (!process.env.WEBHOOK_SECRET || adminToken !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const callIds: string[] = body.call_ids || [];
  if (callIds.length === 0) {
    return NextResponse.json(
      { error: "call_ids array required" },
      { status: 400 },
    );
  }
  if (callIds.length > MAX_CALLS_PER_REQUEST) {
    return NextResponse.json(
      { error: `max ${MAX_CALLS_PER_REQUEST} call_ids per request` },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 },
    );
  }

  const supabase = getServiceClient();
  const results: Array<{
    call_id: string;
    status: "ok" | "err";
    error?: string;
    new_name?: string | null;
    new_intent?: string | null;
  }> = [];

  for (const callId of callIds) {
    try {
      // Fetch the work_order
      const { data: order, error: orderErr } = await supabase
        .from("work_orders")
        .select("id, customer_name, transcript, issue_type, ai_decision, accepted_topics, rejected_topics")
        .eq("vapi_call_id", callId)
        .single();

      if (orderErr || !order) {
        results.push({ call_id: callId, status: "err", error: "work_order not found" });
        continue;
      }

      // Convert transcript [{role,text,ts}] → [{role,text}] for LLM
      const transcript = Array.isArray(order.transcript)
        ? order.transcript
            .filter((m: { role: string; text: string }) => m.role && m.text)
            .map((m: { role: string; text: string }) => ({ role: m.role, text: m.text }))
        : [];

      if (transcript.length === 0) {
        results.push({ call_id: callId, status: "err", error: "no transcript" });
        continue;
      }

      // Call LLM
      const summary = await summarizeWithLLM(
        transcript,
        order.customer_name,
        order.issue_type,
        order.ai_decision,
        order.accepted_topics || [],
        order.rejected_topics || [],
        { callId },
      );

      // Update work_order (also write summary_hash for caching)
      const { error: updateErr } = await supabase
        .from("work_orders")
        .update({
          customer_name_extracted: summary.customerNameExtracted,
          intent_summary: summary.intentSummary,
          customer_tendency: summary.customerTendency,
          mentioned_topics: summary.mentionedTopics,
          follow_up_priority: summary.followUpPriority,
          follow_up_notes: summary.followUpNotes,
          follow_up_recommended: summary.followUpRecommended,
          transcript_coherence: summary.transcriptCoherence,
          // summary_hash is already set in original work_order; we don't
          // recompute it here because the transcript hasn't changed.
        })
        .eq("id", order.id);

      if (updateErr) {
        results.push({ call_id: callId, status: "err", error: `db update: ${updateErr.message}` });
        continue;
      }

      const newName = summary.customerNameExtracted ?? null;
      const newIntent = (summary.intentSummary ?? "").slice(0, 80);
      results.push({
        call_id: callId,
        status: "ok",
        new_name: newName,
        new_intent: newIntent,
      });
    } catch (e) {
      results.push({
        call_id: callId,
        status: "err",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const err = results.length - ok;

  return NextResponse.json({
    processed: results.length,
    succeeded: ok,
    failed: err,
    // Strip null fields for cleaner JSON response
    results: results.map((r) => {
      const out: {
        call_id: string;
        status: "ok" | "err";
        error?: string;
        new_name?: string;
        new_intent?: string;
      } = {
        call_id: r.call_id,
        status: r.status,
      };
      if (r.error !== undefined) out.error = r.error;
      if (r.new_name !== undefined && r.new_name !== null) out.new_name = r.new_name;
      if (r.new_intent !== undefined && r.new_intent !== null) out.new_intent = r.new_intent;
      return out;
    }),
  });
}
