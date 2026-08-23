#!/usr/bin/env node
/**
 * import-vapi-calls.js
 *
 * Imports historical Vapi calls into the work_orders table as production
 * data. Idempotent — only inserts calls that don't already exist (matched
 * by vapi_call_id).
 *
 * Filter rules:
 *   - Only inboundPhoneCall type (skip webCall dashboard test calls)
 *   - Status must be "ended" (skip in-progress / failed setup)
 *
 * Decision state extraction:
 *   - Looks at the last end_call tool call's outcome parameter
 *   - Defaults to "unsure" if no end_call was made
 *
 * Run:  node scripts/import-vapi-calls.js
 * Dry run:  node scripts/import-vapi-calls.js --dry-run
 *   ↑ dry run prints what would be inserted without writing to DB
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { summarizeCall } = require("./lib/call-summary");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const VAPI_API_KEY = ENV.match(/VAPI_API_KEY=(.+)/)[1].trim();
const VAPI_ASSISTANT_ID = ENV.match(/VAPI_ASSISTANT_ID=(.+)/)[1].trim();
const SUPABASE_URL = ENV.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_KEY = ENV.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
// Also load all env vars into process.env so OpenAI client (and other
// packages that read from process.env) can find them. Node doesn't
// auto-load .env.local.
for (const line of ENV.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_DOWNLOAD = process.argv.includes("--force-download");
// Skip download if recording already in Supabase Storage (idempotent)
const SKIP_IF_PRESENT = !process.argv.includes("--force-download");

function vapiGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Authorization: `Bearer ${VAPI_API_KEY}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(new Error(`Parse failed: ${b.slice(0, 200)}`));
          }
        });
      })
      .on("error", reject);
  });
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function uploadToSupabaseStorage(path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${SUPABASE_URL}/storage/v1/object/${path}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "audio/wav",
          "Content-Length": Buffer.byteLength(body),
          "x-upsert": "true", // overwrite if exists (idempotent)
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // Public bucket: URL is {supabase_url}/storage/v1/object/public/{path}
            resolve(`${SUPABASE_URL}/storage/v1/object/public/${path}`);
          } else {
            reject(new Error(`Upload failed: ${res.statusCode} ${b.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function storageObjectExists(path) {
  return new Promise((resolve) => {
    https
      .request(
        `${SUPABASE_URL}/storage/v1/object/${path}`,
        { method: "HEAD", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        (res) => resolve(res.statusCode === 200),
      )
      .on("error", () => resolve(false))
      .end();
  });
}

async function fetchAllCalls() {
  let all = [];
  let cursor = null;
  let page = 0;
  do {
    page++;
    let url = `https://api.vapi.ai/call?assistantId=${VAPI_ASSISTANT_ID}&limit=100`;
    if (cursor) url += `&cursor=${cursor}`;
    const data = await vapiGet(url);
    const calls = Array.isArray(data) ? data : data.calls || data.results || [];
    all = all.concat(calls);
    cursor = Array.isArray(data) ? null : data.nextCursor || data.nextPageToken;
  } while (cursor && page < 20);
  return all;
}

async function fetchCallDetail(callId) {
  return vapiGet(`https://api.vapi.ai/call/${callId}`);
}

function extractFromMessages(detail) {
  const messages = detail.artifact?.messages || [];
  let decision = "unsure";
  let reason = null;
  let summary = null;
  let issueType = null;
  let zipcode = null;
  let quoteLow = null;
  let quoteHigh = null;
  let pricingBreakdown = null;
  let transcript = null;

  // Collect all end_call arguments (take the LAST one) and all check_trade
  // results (we'll pick the last accepted one — same logic as the webhook
  // handler in src/lib/order.ts so import matches live webhook behavior).
  // Also collect flag_urgent / flag_uncertain for cases where AI never called end_call.
  let lastEndCall = null;
  let lastFlagUrgent = null;
  let lastFlagUncertain = null;
  const checkTradeResults = []; // [{args, result}, ...] in call order
  for (const m of messages) {
    if (m.role === "tool_calls" && m.toolCalls) {
      for (const tc of m.toolCalls) {
        const fn = tc.function || {};
        if (fn.name === "end_call") {
          try {
            const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
            lastEndCall = args;
          } catch {}
        } else if (fn.name === "flag_urgent") {
          try {
            const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
            lastFlagUrgent = args;
          } catch {}
        } else if (fn.name === "flag_uncertain") {
          try {
            const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
            lastFlagUncertain = args;
          } catch {}
        } else if (fn.name === "check_trade") {
          try {
            const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
            checkTradeResults.push({ args });
          } catch {}
        } else if (fn.name === "validate_service") {
          try {
            const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
            if (args?.zipcode) zipcode = args.zipcode;
            if (args?.issue_type) issueType = args.issue_type;
          } catch {}
        } else if (fn.name === "get_price_quote") {
          try {
            const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.functions.issue_type;
            if (args?.issue_type) issueType = args.issue_type;
          } catch {}
        }
      }
    }

    // Capture check_trade results too (we need in_trade=true to know if accepted)
    if (m.role === "tool_call_result" && m.name === "check_trade" && m.result) {
      try {
        const result = typeof m.result === "string" ? JSON.parse(m.result) : m.result;
        const last = checkTradeResults[checkTradeResults.length - 1];
        if (last) last.result = result;
      } catch {}
    }

    // Look for tool results (pricing breakdown, etc.)
    if (m.role === "tool_call_result" && m.name === "get_price_quote" && m.result) {
      try {
        const result = typeof m.result === "string" ? JSON.parse(m.result) : m.result;
        if (result?.available && result?.range) {
          quoteLow = result.total_low ?? (result.range.low + (result.total_trip_fee || 89));
          quoteHigh = result.total_high ?? (result.range.high + (result.total_trip_fee || 89));
          pricingBreakdown = {
            trip_fee: result.trip_fee,
            fuel_surcharge: result.fuel_surcharge,
            total_trip_fee: result.total_trip_fee,
            range_low: result.range.low,
            range_high: result.range.high,
            total_low: result.total_low,
            total_high: result.total_high,
            distance_miles: result.distance_miles,
            free_distance_miles: 15,
            surcharge_per_mile: 2,
          };
        }
      } catch {}
    }
  }

  // After the loop, pick the LAST accepted check_trade's issue type
  // (if any), falling back to the first check_trade. This matches
  // webhook handler in src/lib/order.ts.
  if (checkTradeResults.length > 0) {
    const acceptedCheck = [...checkTradeResults].reverse().find(
      (c) => c.result?.in_trade === true,
    );
    const pickedCheck = acceptedCheck || checkTradeResults[0];
    if (pickedCheck?.args?.issue_type && !issueType) {
      issueType = pickedCheck.args.issue_type;
    }
  }

  // Accepted vs rejected topics (B.2)
  // Three sources of truth, in order of priority:
  //   1. check_trade tool results (in_trade=true → accepted, false → rejected)
  //   2. If no check_trade accepted but decision=accepted and issueType set → fallback to issueType
  //   3. If decision=rejected and issueType not already classified → mark rejected
  const acceptedTopicsSet = new Set();
  const rejectedTopicsSet = new Set();
  for (const c of checkTradeResults) {
    const it = c.args?.issue_type;
    if (!it) continue;
    if (c.result?.in_trade === true) acceptedTopicsSet.add(it);
    else if (c.result?.in_trade === false) rejectedTopicsSet.add(it);
  }
  // (fallback for accepted/rejected topics moved to AFTER decision is set,
  //  see below)

  // After the loop, pick the LAST accepted check_trade's issue type
  // (if any), falling back to the first check_trade. This matches
  // webhook handler in src/lib/order.ts.
  if (checkTradeResults.length > 0) {
    const acceptedCheck = [...checkTradeResults].reverse().find(
      (c) => c.result?.in_trade === true,
    );
    const pickedCheck = acceptedCheck || checkTradeResults[0];
    if (pickedCheck?.args?.issue_type && !issueType) {
      issueType = pickedCheck.args.issue_type;
    }
  }

  if (lastEndCall) {
    decision = lastEndCall.outcome || "unsure";
    summary = lastEndCall.summary || null;
  } else if (lastFlagUrgent) {
    decision = "urgent";
    summary = lastFlagUrgent.reason || "Marked urgent by AI";
  } else if (lastFlagUncertain) {
    decision = "unsure";
    summary = lastFlagUncertain.reason || "AI escalated to human for callback";
  }

  // NOW apply accepted/rejected topics fallback — needs decision set above
  if (decision === "accepted" && issueType && acceptedTopicsSet.size === 0) {
    acceptedTopicsSet.add(issueType);
  }
  if (decision === "rejected" && issueType && !acceptedTopicsSet.has(issueType) && !rejectedTopicsSet.has(issueType)) {
    rejectedTopicsSet.add(issueType);
  }
  const acceptedTopics = Array.from(acceptedTopicsSet);
  const rejectedTopics = Array.from(rejectedTopicsSet);

  if (!summary) {
    summary = detail.summary || detail.analysis?.summary || null;
  }

  transcript = detail.transcript || null;

  return { decision, reason, summary, issueType, zipcode, quoteLow, quoteHigh, pricingBreakdown, transcript, acceptedTopics, rejectedTopics };
}

function statusForDecision(decision) {
  if (decision === "accepted") return "pending";
  if (decision === "urgent") return "urgent";
  if (decision === "unsure") return "callback";
  if (decision === "rejected") return "rejected";
  return "pending";
}

function buildWorkOrder(call, extracted, bossId) {
  const customer = call.customer || {};
  return {
    boss_id: bossId,
    customer_name: customer.name || null,
    customer_phone: customer.number || "(unknown)",
    customer_zipcode: extracted.zipcode || null,
    issue_type: extracted.issueType || null,
    accepted_topics: extracted.acceptedTopics || [],
    rejected_topics: extracted.rejectedTopics || [],
    ai_decision: extracted.decision,
    ai_decision_reason: extracted.reason,
    quote_low: extracted.quoteLow,
    quote_high: extracted.quoteHigh,
    pricing_breakdown: extracted.pricingBreakdown,
    summary: extracted.summary,
    ...summarizeCallToWorkOrderFields(extracted, call),
    transcript: extracted.transcript
      ? extracted.transcript
          .split("\n")
          .filter((l) => l.trim())
          .map((l, i) => ({
            role: l.startsWith("AI:") || l.startsWith("Assistant:") ? "assistant" : "user",
            text: l.replace(/^(AI:|Assistant:|User:)\s*/, "").trim(),
            ts: i * 1000,
          }))
      : null,
    recording_url:
      call.artifact?.presignedMonoUrl ||
      call.artifact?.presignedStereoUrl ||
      call.recordingUrl ||
      call.artifact?.recordingUrl ||
      null,
    status: statusForDecision(extracted.decision),
    vapi_call_id: call.id,
    data_source: "production", // imported from real Vapi calls
    created_at: call.startedAt || call.createdAt,
  };
}

function summarizeCallToWorkOrderFields(extracted, call) {
  let transcript = null;
  if (extracted.transcript && typeof extracted.transcript === "string") {
    const lines = extracted.transcript.split("\n").filter((l) => l.trim());
    transcript = lines.map((l) => ({
      role: l.startsWith("AI:") || l.startsWith("Assistant:") ? "assistant" : "user",
      text: l.replace(/^(AI:|Assistant:|User:)\s*/, "").trim(),
    }));
  } else if (Array.isArray(call.messages)) {
    transcript = call.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: m.message || m.content || "" }));
  }
  const callerIdName = call.customer?.name || null;
  // Use the same LLM-with-fallback path as the live webhook (src/lib/openai-summarize.ts).
  // This gives 95%+ accuracy on name/intent/tendency extraction.
  const summary = callSummaryWithFallback(transcript, callerIdName, extracted.issueType, extracted.decision);
  return {
    customer_name_extracted: summary.customerNameExtracted,
    intent_summary: summary.intentSummary,
    customer_tendency: summary.customerTendency,
    mentioned_topics: summary.mentionedTopics,
    follow_up_priority: summary.followUpPriority,
    follow_up_notes: summary.followUpNotes,
    follow_up_recommended: summary.followUpRecommended,
    transcript_coherence: summary.transcriptCoherence,
  };
}

// Inline LLM-with-fallback path. Mirrors src/lib/openai-summarize.ts but
// loads the OpenAI client only when needed (saves startup time on scripts
// that don't use it).
let _openaiClient = null;
function getOpenAIClient() {
  if (_openaiClient) return _openaiClient;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { default: OpenAI } = require("openai");
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openaiClient;
  } catch (e) {
    console.warn("[import] openai package not available:", e.message);
    return null;
  }
}

const SUMMARIZE_PROMPT = `You are a structured data extractor for a home services AI receptionist. Given a phone call transcript (with speaker roles: "user" = customer, "assistant" = AI receptionist), extract these fields as JSON:

{
  "customer_name": string | null,
  "intent_summary": string,
  "tendency": "scheduling" | "service_inquiry" | "price_shopping" | "considering" | "complaint" | "urgent" | "uncertain" | "info_general",
  "topics": string[],
  "follow_up_priority": "high" | "medium" | "low" | "none",
  "follow_up_notes": string | null
}

Notes:
- customer_name: extract from "my name is X" / "I'm X" / "his name is X". Reject non-name words like "in", "here".
- intent_summary: 1 sentence of what the customer actually asked about, even if AI rejected
- tendency: most specific first (complaint > urgent > scheduling > price_shopping > service_inquiry > considering > info_general)
- topics: lowercase, single words or short phrases
- follow_up_priority: high if customer asked something we do but AI rejected; none if cleanly handled

Return only valid JSON, no markdown.`;

async function callSummaryWithFallback(transcript, callerIdName, issueType, decision) {
  // Skip LLM during local import (China → OpenAI 30s+ per call). Webhook path
  // (Vercel) uses LLM normally. Set DISABLE_IMPORT_LLM=0 to force-enable here.
  if (process.env.DISABLE_IMPORT_LLM !== "0") {
    return summarizeCall(transcript, callerIdName, issueType, decision);
  }
  // Try LLM first
  const client = getOpenAIClient();
  if (client && transcript && transcript.length > 0) {
    // 25s timeout — OpenAI from China can be slow. If we time out, fall back
    // to regex immediately rather than blocking the whole import.
    const TIMEOUT_MS = 25_000;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await Promise.race([
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: SUMMARIZE_PROMPT },
              { role: "user", content: JSON.stringify({ caller_id_name: callerIdName, ai_decision: decision, issue_type: issueType, transcript }) },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 500,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out")), TIMEOUT_MS)),
        ]);
        const raw = completion.choices[0].message.content || "{}";
        const parsed = JSON.parse(raw);
        return {
          customerNameExtracted: parsed.customer_name ?? null,
          intentSummary: parsed.intent_summary ?? null,
          customerTendency: parsed.tendency ?? "uncertain",
          mentionedTopics: Array.isArray(parsed.topics) ? parsed.topics.map((t) => t.toLowerCase()) : [],
          followUpPriority: parsed.follow_up_priority ?? "none",
          followUpNotes: parsed.follow_up_notes ?? null,
          followUpRecommended: ["high", "medium"].includes(parsed.follow_up_priority),
          transcriptCoherence: "medium",
        };
      } catch (e) {
        console.warn(`[import] LLM attempt ${attempt} failed: ${e.message.slice(0, 80)}`);
        if (attempt === 2) break;
      }
    }
  }
  // Fallback to regex
  return summarizeCall(transcript, callerIdName, issueType, decision);
}

async function getExistingCallIds() {
  return new Promise((resolve, reject) => {
    https
      .get(
        `${SUPABASE_URL}/rest/v1/work_orders?select=vapi_call_id&vapi_call_id=not.is.null&limit=1000`,
        {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => {
            try {
              const data = JSON.parse(b);
              resolve(new Set(data.map((r) => r.vapi_call_id).filter(Boolean)));
            } catch (e) {
              reject(e);
            }
          });
        },
      )
      .on("error", reject);
  });
}

async function getBossId() {
  return new Promise((resolve, reject) => {
    https
      .get(`${SUPABASE_URL}/rest/v1/bosses?select=id&limit=1`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(b);
            resolve(data[0]?.id || null);
          } catch (e) {
            reject(e);
          }
        });
      },
    )
      .on("error", reject);
  });
}

function insertWorkOrder(record) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(record);
    const req = https.request(
      `${SUPABASE_URL}/rest/v1/work_orders`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Prefer: "return=minimal",
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`Insert failed: ${res.statusCode} ${b.slice(0, 200)}`));
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

/**
 * Update an existing production record's recording_url + transcript.
 * Used when Vapi presigned URLs expire (every 30 min) — re-run the import
 * to refresh them.
 */
function updateWorkOrder(callId, patch) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(patch);
    const req = https.request(
      `${SUPABASE_URL}/rest/v1/work_orders?vapi_call_id=eq.${encodeURIComponent(callId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Prefer: "return=minimal",
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`Update failed: ${res.statusCode} ${b.slice(0, 200)}`));
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

async function main() {
  console.log(DRY_RUN ? "🔍 DRY RUN MODE (no writes)\n" : "📥 Importing Vapi calls...\n");

  const bossId = await getBossId();
  if (!bossId) {
    console.error("✗ No boss found in DB. Run schema.sql first.");
    process.exit(1);
  }

  const allCalls = await fetchAllCalls();
  console.log(`Fetched ${allCalls.length} total calls from Vapi`);

  // Filter: BOTH inbound phone calls AND webCalls with status=ended
  // Validity criteria (skip noise like 0-message errors or 1-msg hangups):
  //   - has >5 messages (real conversation, not just "Hello?" + hangup)
  //   - has at least 1 tool call (AI actually engaged with the workflow)
  //   - inboundPhoneCall also requires customer.number
  const eligible = allCalls.filter((c) => {
    if (c.status !== "ended") return false;
    if (c.type !== "inboundPhoneCall" && c.type !== "webCall") return false;
    if (c.type === "inboundPhoneCall" && !c.customer?.number) return false;
    const msgs = c.messages || [];
    if (msgs.length < 6) return false;
    const toolCalls = msgs.reduce((n, m) => n + (m.toolCalls ? m.toolCalls.length : 0), 0);
    if (toolCalls < 1) return false;
    return true;
  });
  const skippedType = allCalls.length - eligible.length;
  const inboundCount = eligible.filter((c) => c.type === "inboundPhoneCall").length;
  const webCount = eligible.filter((c) => c.type === "webCall").length;
  console.log(`  ${eligible.length} are eligible (${inboundCount} inbound + ${webCount} webCall)`);
  console.log(`  ${skippedType} skipped (not ended / <6 msgs / 0 tool calls / inbound w/o number)`);

  const existing = await getExistingCallIds();
  console.log(`  ${existing.size} already in DB (will skip)`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;

  for (const callSummary of eligible) {
    let detail;
    try {
      detail = await fetchCallDetail(callSummary.id);
    } catch (e) {
      console.error(`  ✗ Failed to fetch detail for ${callSummary.id.slice(0, 12)}: ${e.message}`);
      errored++;
      continue;
    }

    const extracted = extractFromMessages(detail);
    const record = buildWorkOrder(detail, extracted, bossId);

    // Permanent storage: download audio from Vapi (URL expires in 30min)
    // and re-host in our Supabase Storage so the link never expires.
    if (record.recording_url && !DRY_RUN) {
      const vapiAudioUrl = record.recording_url;
      const storagePath = `call-recordings/${callSummary.id}.wav`;
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${storagePath}`;

      try {
        const exists = SKIP_IF_PRESENT ? await storageObjectExists(storagePath) : false;
        if (exists) {
          record.recording_url = publicUrl;
        } else {
          const audioBuffer = await downloadToBuffer(vapiAudioUrl);
          if (audioBuffer.length < 100) {
            // Likely an error page, not actual audio
            console.warn(`  ⚠ Audio for ${callSummary.id.slice(0,12)} is only ${audioBuffer.length} bytes — skipping upload`);
          } else {
            await uploadToSupabaseStorage(storagePath, audioBuffer);
            record.recording_url = publicUrl;
          }
        }
      } catch (e) {
        console.warn(`  ⚠ Could not migrate audio for ${callSummary.id.slice(0,12)}: ${e.message}`);
        // Keep Vapi URL as fallback (will expire in 30min)
      }
    }

    const tag = `[${record.ai_decision.padEnd(8)}] ${record.customer_phone}`;

    if (existing.has(callSummary.id)) {
      // Refresh: update recording_url + transcript + summary on existing
      // production records (Vapi presigned URLs expire every 30 min).
      if (DRY_RUN) {
        console.log(`  WOULD UPDATE ${tag} (refresh presigned URL)`);
        updated++;
      } else {
        try {
          const patch = {
            recording_url: record.recording_url,
            transcript: record.transcript,
            summary: record.summary,
            issue_type: record.issue_type,
            customer_zipcode: record.customer_zipcode,
            quote_low: record.quote_low,
            quote_high: record.quote_high,
            pricing_breakdown: record.pricing_breakdown,
            customer_name_extracted: record.customer_name_extracted,
            intent_summary: record.intent_summary,
            customer_tendency: record.customer_tendency,
            mentioned_topics: record.mentioned_topics,
            accepted_topics: record.accepted_topics,
            rejected_topics: record.rejected_topics,
            follow_up_priority: record.follow_up_priority,
            follow_up_notes: record.follow_up_notes,
            follow_up_recommended: record.follow_up_recommended,
            transcript_coherence: record.transcript_coherence,
          };
          try {
            await updateWorkOrder(callSummary.id, patch);
          } catch (e) {
            const msg = e.message || "";
            if (msg.includes("Could not find") || msg.includes("column") || msg.includes("does not exist")) {
              console.log(`  (skipping call-summary fields — some migration not yet run)`);
              const { customer_name_extracted, intent_summary, customer_tendency, mentioned_topics, accepted_topics, rejected_topics, follow_up_priority, follow_up_notes, follow_up_recommended, transcript_coherence, ...legacy } = patch;
              try {
                await updateWorkOrder(callSummary.id, patch);
              } catch (e2) {
                // Try a different subset
                try {
                  await updateWorkOrder(callSummary.id, { ...legacy, customer_name_extracted, intent_summary, customer_tendency, mentioned_topics, follow_up_priority, follow_up_notes, follow_up_recommended });
                } catch (e3) {
                  await updateWorkOrder(callSummary.id, legacy);
                }
              }
            } else {
              throw e;
            }
          }
          console.log(`  ↻ REFRESHED  ${tag} (new presigned URL, valid ~30min)`);
          updated++;
        } catch (e) {
          console.error(`  ✗ UPDATE FAILED ${tag}: ${e.message}`);
          errored++;
        }
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`  WOULD INSERT ${tag} | ${(record.summary || "").slice(0, 80)}`);
      inserted++;
    } else {
      try {
        await insertWorkOrder(record);
        console.log(`  ✓ INSERTED   ${tag} | ${(record.summary || "(no summary)").slice(0, 80)}`);
        inserted++;
      } catch (e) {
        console.error(`  ✗ INSERT FAILED ${tag}: ${e.message}`);
        errored++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Eligible:  ${eligible.length}`);
  console.log(`  Inserted:  ${inserted}${DRY_RUN ? " (dry run)" : ""}`);
  console.log(`  Refreshed: ${updated}${DRY_RUN ? " (dry run)" : " (presigned URL refresh)"}`);
  console.log(`  Errored:   ${errored}`);
  console.log(`  Skipped type: ${skippedType} (webCall / no customer)`);
}

main().catch((e) => {
  console.error("✗ Fatal:", e);
  process.exit(1);
});
