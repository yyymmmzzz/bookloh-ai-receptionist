import { NextRequest, NextResponse } from "next/server";
import { getDefaultBoss, getBossByCountry, getBossByVapiAssistantId, detectCountryFromPhone } from "@/lib/order";
import { validateService, getPriceQuote, checkTrade } from "@/lib/validation";
import type {
  AIDecision,
  IssueType,
  ValidateServiceResult,
  GetPriceQuoteResult,
  CheckTradeResult,
  Boss,
} from "@/lib/types";

/**
 * Vapi Tools Endpoint — receives function calls from the AI assistant.
 *
 * Multi-region: detects country from call.customer.number and looks up
 * the country-specific boss. Falls back to default (US) boss if no
 * country-specific boss is configured yet.
 *
 * Docs: https://docs.vapi.ai/tools/custom-tools
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
    call?: {
      id: string;
      customer?: { number?: string };
      assistantId?: string;
    };
    toolCalls?: VapiToolCall[];
  };
}

export async function POST(req: NextRequest) {
  // Verify webhook secret
  const secret = req.headers.get("x-vapi-secret") || req.headers.get("x-webhook-secret");
  if (process.env.WEBHOOK_SECRET && secret && secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: VapiToolsRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // If this is NOT a tool-calls event (e.g. Vapi sent end-of-call-report
  // or status-update to the legacy /tools URL), forward to the shared
  // event handler. Belt-and-suspenders: phone number + emergency
  // assistant point at /webhook, but main assistant still points here.
  const eventType = body.message?.type;
  if (eventType && eventType !== "tool-calls") {
    console.log(`[tools] Received non-tool event '${eventType}', forwarding to shared handler`);
    try {
      const { handleVapiEvent } = await import("@/lib/vapi-event-handler");
      const dataSource: "production" | "test" =
        body.message.call?.assistantId === "test-org" ? "test" : "production";
      await handleVapiEvent(body as unknown as Parameters<typeof handleVapiEvent>[0], dataSource);
    } catch (err) {
      console.error(`[tools] Forward to handler failed:`, err);
    }
    return NextResponse.json({ results: [] });
  }

  const toolCalls = body.message?.toolCalls || [];
  if (toolCalls.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Pick boss — prefer exact match by Vapi assistant ID, then country, then default
  const assistantId = body.message.call?.assistantId;
  const customerNumber = body.message.call?.customer?.number;

  let boss: Boss | null = null;
  let bossSource = "unknown";
  if (assistantId) {
    boss = await getBossByVapiAssistantId(assistantId);
    if (boss) bossSource = `assistant(${assistantId.slice(0, 8)})`;
  }
  if (!boss) {
    const country = detectCountryFromPhone(customerNumber);
    if (country) {
      boss = await getBossByCountry(country);
      if (boss) bossSource = `country(${country})`;
    }
  }
  if (!boss) {
    boss = await getDefaultBoss();
    if (boss) bossSource = "default";
  }
  if (!boss) {
    console.error("[tools] No boss configured");
    return NextResponse.json(
      { error: "no_boss_configured" },
      { status: 500 },
    );
  }
  console.log(`[tools] Boss via ${bossSource}: ${boss.company_name} (${boss.country})`);

  // Reset per-call cache
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

let lastValidatedZip: { zipcode: string; distance_miles: number | null; ok: boolean } | null = null;

async function dispatchToolCall(
  boss: Boss,
  tc: VapiToolCall,
): Promise<unknown> {
  const { name, arguments: args } = tc.function;

  console.log(`[tools] Call: ${name}(${JSON.stringify(args)})`);

  switch (name) {
    // Merged tool: check_trade + validate_service + get_price_quote in one call
    case "check_and_quote": {
      const issue_type = (args.issue_type as IssueType) || "general";
      const zipcode = (args.zipcode as string) || "";

      // Step 1: trade check
      const trade = checkTrade(boss, issue_type);
      if (!trade.in_trade) {
        return {
          in_trade: false,
          reason: trade.reason,
        };
      }

      // Step 2: validate service area (if zipcode provided)
      if (zipcode) {
        const validate = await validateService(boss, zipcode, issue_type);
        lastValidatedZip = {
          zipcode,
          distance_miles: validate.distance_miles ?? null,
          ok: validate.ok,
        };
        if (!validate.ok) {
          return {
            in_trade: true,
            matched_trade: trade.matched_trade,
            in_service: false,
            reason: validate.reason,
            distance_miles: validate.distance_miles,
          };
        }

        // Step 3: get price quote with the distance
        const distance = validate.distance_miles;
        const quote = getPriceQuote(boss, issue_type, distance);
        return {
          in_trade: true,
          matched_trade: trade.matched_trade,
          in_service: true,
          distance_miles: distance,
          trip_fee: quote.trip_fee,
          fuel_surcharge: quote.fuel_surcharge,
          total_trip_fee: quote.total_trip_fee,
          range_low: quote.range?.low,
          range_high: quote.range?.high,
          total_low: quote.total_low,
          total_high: quote.total_high,
          currency_symbol: quote.currency_symbol,
        };
      }

      // No zipcode yet — return trade check only
      return {
        in_trade: true,
        matched_trade: trade.matched_trade,
        in_service: null,  // unknown
      };
    }

    // Legacy tool names (kept for backward compat with old system prompts)
    case "check_trade": {
      const issue_type = (args.issue_type as IssueType) || "general";
      const result: CheckTradeResult = checkTrade(boss, issue_type);
      return result;
    }

    case "validate_service": {
      const postal = (args.zipcode as string) || (args.postal_code as string) || "";
      const issue_type = (args.issue_type as IssueType) || "general";
      const result: ValidateServiceResult = await validateService(boss, postal, issue_type);
      lastValidatedZip = {
        zipcode: postal,
        distance_miles: result.distance_miles ?? null,
        ok: result.ok,
      };
      return result;
    }

    case "get_price_quote": {
      const issue_type = (args.issue_type as IssueType) || "general";
      const explicitDistance = (args.distance_miles as number | undefined) ?? null;
      const distance = explicitDistance ?? lastValidatedZip?.distance_miles ?? null;
      const result: GetPriceQuoteResult = getPriceQuote(boss, issue_type, distance);
      return result;
    }

    case "flag_urgent": {
      const reason = (args.reason as string) || "unspecified";
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
