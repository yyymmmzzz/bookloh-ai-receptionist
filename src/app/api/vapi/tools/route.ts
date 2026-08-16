import { NextRequest, NextResponse } from "next/server";
import { getDefaultBoss } from "@/lib/order";
import { validateService, getPriceQuote } from "@/lib/validation";
import type {
  AIDecision,
  IssueType,
  ValidateServiceResult,
  GetPriceQuoteResult,
} from "@/lib/types";

/**
 * Vapi Tools Endpoint — receives function calls from the AI assistant.
 *
 * Vapi sends a single POST with one or more tool calls. We respond with
 * the results in the order Vapi expects.
 *
 * Docs: https://docs.vapi.ai/tools/custom-tools
 *
 * Request body (Vapi format):
 * {
 *   message: {
 *     type: "tool-calls",
 *     call: { id, ... },
 *     toolCalls: [
 *       { id: "tc_1", type: "function", function: { name: "validate_service", arguments: {...} } }
 *     ]
 *   }
 * }
 *
 * Response body (Vapi format):
 * {
 *   results: [
 *     { toolCallId: "tc_1", result: "..." }
 *   ]
 * }
 */

interface VapiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface VapiToolsRequest {
  message: {
    type: string;
    call?: { id: string };
    toolCalls?: VapiToolCall[];
  };
}

export async function POST(req: NextRequest) {
  // Verify webhook secret
  const secret = req.headers.get("x-vapi-secret") || req.headers.get("x-webhook-secret");
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: VapiToolsRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const toolCalls = body.message?.toolCalls || [];
  if (toolCalls.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const boss = await getDefaultBoss();
  if (!boss) {
    console.error("[tools] No boss configured");
    return NextResponse.json(
      { error: "no_boss_configured" },
      { status: 500 },
    );
  }

  // Module-level cache: feed validate_service's distance into the subsequent
  // get_price_quote call so the AI can quote a total including fuel surcharge.
  // We reset it at the start of each /tools request (one Vapi call = one request).
  lastValidatedZip = null;

  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      try {
        const result = await dispatchToolCall(boss, tc);
        return { toolCallId: tc.id, result: JSON.stringify(result) };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[tools] ${tc.function.name} failed:`, errMsg);
        return {
          toolCallId: tc.id,
          result: JSON.stringify({ error: errMsg }),
        };
      }
    }),
  );

  return NextResponse.json({ results });
}

/**
 * Per-call cache for the most recent validate_service result.
 * Vapi sends tool calls in a single POST; we chain validate_service's
 * distance_miles into the next get_price_quote call automatically.
 */
let lastValidatedZip: { zipcode: string; distance_miles: number | null; ok: boolean } | null = null;

async function dispatchToolCall(
  boss: Awaited<ReturnType<typeof getDefaultBoss>> & {},
  tc: VapiToolCall,
): Promise<unknown> {
  const { name, arguments: args } = tc.function;

  console.log(`[tools] Call: ${name}(${JSON.stringify(args)})`);

  switch (name) {
    case "validate_service": {
      const zipcode = (args.zipcode as string) || "";
      const issue_type = (args.issue_type as IssueType) || "general";
      const result: ValidateServiceResult = await validateService(boss, zipcode, issue_type);
      lastValidatedZip = {
        zipcode,
        distance_miles: result.distance_miles ?? null,
        ok: result.ok,
      };
      return result;
    }

    case "get_price_quote": {
      const issue_type = (args.issue_type as IssueType) || "general";
      // Honor an explicit distance_miles arg, or fall back to the chained
      // distance from validate_service in this same call.
      const explicitDistance = (args.distance_miles as number | undefined) ?? null;
      const distance = explicitDistance ?? lastValidatedZip?.distance_miles ?? null;
      const result: GetPriceQuoteResult = getPriceQuote(boss, issue_type, distance);
      return result;
    }

    case "flag_urgent": {
      const reason = (args.reason as string) || "unspecified";
      // Logged in call_events via the webhook. Return acknowledgment for the AI.
      return { flagged: true, severity: "urgent", reason };
    }

    case "flag_uncertain": {
      const reason = (args.reason as string) || "unspecified";
      return { flagged: true, severity: "callback", reason };
    }

    case "end_call": {
      const outcome = (args.outcome as AIDecision) || "unsure";
      const summary = (args.summary as string) || "";
      return { ended: true, outcome, summary };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export const dynamic = "force-dynamic";
