#!/usr/bin/env node
/**
 * analyze-calls.js — Pull each production call and run call-summary,
 * print results. READ-ONLY (no DB writes, no git changes).
 *
 * Use this to:
 *   - See what call-summary currently extracts for each real call
 *   - Find missed extractions, false positives, summary issues
 *   - Spot systematic improvements before we commit changes
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { summarizeCall, extractCustomerName, extractMentionedTopics, classifyTendency } = require("./lib/call-summary");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const VAPI_API_KEY = ENV.match(/VAPI_API_KEY=(.+)/)[1].trim();
const SUPABASE_URL = ENV.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_KEY = ENV.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();

const CALL_IDS = [
  // Inbound
  "01a00957-fe56-7000-83f1-e5ecfa4f22b7",  // 2026-08-16 06:52 — unsure
  "01a029e7-0363-7331-b961-30dc2a205fd6",  // 2026-08-22 14:36 — accepted
  "01a029ff-2c61-7667-94ca-552d6aaf08b8",  // 2026-08-22 15:03 — rejected
  "01a029ff-8b91-7442-a76b-5eecdd53fc48",  // 2026-08-22 15:04 — unsure
  "01a02c54-c00b-7000-81d2-d018fc540012",  // 2026-08-23 01:57 — unsure (Nathan!)
  // WebCall
  "01a008ac-593d-7bba-b420-64cfa7397f50",  // webCall — unsure
  "01a0087e-dec6-7113-ab04-fa214db2f155",  // webCall — unsure
  "01a0088a-d77c-7000-8302-d0048a3b515c",  // webCall — unsure
  "01a02c00-ae60-7bb7-b0b5-b00d63022de3",  // webCall — accepted (handyman)
  "01a02c09-19f9-7ffc-b25b-eeb8c753f287",  // webCall — accepted (hvac)
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${VAPI_API_KEY}` } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(`Parse: ${b.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

function getWorkOrder(callId) {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/rest/v1/work_orders?vapi_call_id=eq.${encodeURIComponent(callId)}&select=ai_decision,issue_type,summary,mentioned_topics,customer_name_extracted,intent_summary,customer_tendency,follow_up_priority,follow_up_notes`;
    https.get(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try {
          const arr = JSON.parse(b);
          resolve(arr[0] || null);
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  Production call extraction analysis (READ-ONLY)");
  console.log("═══════════════════════════════════════════════════════════════════════════\n");

  for (const callId of CALL_IDS) {
    let detail, db;
    try {
      [detail, db] = await Promise.all([
        get(`https://api.vapi.ai/call/${callId}`),
        getWorkOrder(callId),
      ]);
    } catch (e) {
      console.log(`✗ ${callId}: fetch failed — ${e.message}\n`);
      continue;
    }

    // Convert raw transcript to [{role, text}] format
    let transcript = [];
    if (detail.artifact?.messages) {
      transcript = detail.artifact.messages
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "bot")
        .map((m) => ({ role: m.role === "bot" ? "assistant" : m.role, text: m.message || m.content || "" }));
    } else if (detail.messages) {
      transcript = detail.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, text: m.message || m.content || "" }));
    } else if (detail.transcript) {
      // Parse raw transcript with AI:/User: prefixes
      transcript = detail.transcript.split("\n").filter((l) => l.trim()).map((l) => ({
        role: l.match(/^(AI:|Assistant:)/i) ? "assistant" : "user",
        text: l.replace(/^(AI:|Assistant:|User:)\s*/i, "").trim(),
      }));
    }

    // Get AI decision (from DB or from tool calls)
    const decision = db?.ai_decision || "unsure";
    const issueType = db?.issue_type || null;

    // Run call-summary
    const result = summarizeCall(transcript, detail.customer?.name || null, issueType, decision);

    // Pull customer messages
    const userMessages = transcript.filter((m) => m.role === "user" && m.text).map((m) => m.text);
    const userMsgCount = userMessages.length;
    const firstUser = userMessages[0] || "(none)";
    const lastUser = userMessages[userMessages.length - 1] || "(none)";

    console.log(`━━━ ${callId.slice(0, 18)}... | decision: ${decision} | issue: ${issueType || "—"} ━━━`);
    console.log(`📞 customer: ${detail.customer?.number || "(no phone)"} | started: ${detail.startedAt?.slice(0, 19)} | msgs: ${userMsgCount} user / ${transcript.filter((m) => m.role === "assistant").length} assistant`);
    console.log(`👤 NAME extracted: ${result.customerNameExtracted || "❌ (no name found)"} | caller ID: ${detail.customer?.name || "(none)"}`);
    console.log(`🏷️  TENDENCY: ${result.customerTendency}`);
    console.log(`📌 TOPICS: ${result.mentionedTopics.join(", ") || "(none)"}`);
    console.log(`🔥 FOLLOW-UP: ${result.followUpPriority} | recommended: ${result.followUpRecommended ? "YES" : "no"}`);
    console.log(`💡 INTENT: ${result.intentSummary}`);
    console.log(`📝 FOLLOW-UP NOTES: ${result.followUpNotes || "(none)"}`);
    console.log(`💬 FIRST USER: "${firstUser.slice(0, 90)}${firstUser.length > 90 ? "..." : ""}"`);
    console.log(`💬 LAST USER:  "${lastUser.slice(0, 90)}${lastUser.length > 90 ? "..." : ""}"`);
    console.log("");
  }
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
