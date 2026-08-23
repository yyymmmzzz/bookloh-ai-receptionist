/**
 * openai-summarize.ts — Optional LLM-based call summary extraction
 *
 * This is an OPT-IN replacement for the regex-based call-summary.ts.
 * When OPENAI_API_KEY is configured, we call gpt-4o-mini to extract:
 *   - customer_name
 *   - intent_summary (1-sentence natural language)
 *   - tendency
 *   - topics
 *   - accepted_topics / rejected_topics
 *   - follow-up priority + notes
 *
 * If the LLM call fails (timeout, no API key, rate limit), we fall back
 * to the regex-based summarizeCall() so the webhook still works.
 *
 * Cost: ~$0.001 per call (gpt-4o-mini at ~500-2000 input tokens).
 * Latency: +200-500ms to webhook processing.
 *
 * Set OPENAI_API_KEY in .env.local and Vercel to enable.
 */

import OpenAI from "openai";
import { summarizeCall, type CallSummary } from "./call-summary";

const SYSTEM_PROMPT = `You are a structured data extractor for a home services AI receptionist in Houston, Texas.
Given a phone call transcript (with speaker roles: "user" = customer, "assistant" = AI receptionist), extract the following fields as JSON:

{
  "customer_name": string | null,
  // Name of the CUSTOMER (not the AI). Extract from patterns like "my name is X",
  // "I'm X", "This is X", or "His/Her name is X". Do NOT extract common words like
  // "in", "here", "looking" (these are false positives from "I'm in Houston" etc.).
  // If no name mentioned, return null.

  "intent_summary": string,
  // 1-sentence natural-language summary of what the customer was asking about.
  // Surface the SPECIFIC problem ("My sink is leaking" not "Hello?"). Even if the
  // AI rejected the call, the customer's actual ask is what the boss needs to know
  // (maybe we should still call back if it's a service we can do).

  "tendency": "scheduling" | "service_inquiry" | "price_shopping" | "considering" | "complaint" | "urgent" | "uncertain" | "info_general",
  // scheduling: explicitly setting an appointment
  // service_inquiry: asking what we cover
  // price_shopping: asking rates / comparing
  // considering: "let me think about it" / "call you back"
  // complaint: unhappy with prior service
  // urgent: emergency (burst pipe, no power, AC broken in Houston heat, gas smell, etc.)
  // uncertain: couldn't identify
  // info_general: chitchat

  "topics": string[],
  // All services the customer mentioned. Lowercase, single words or short phrases.
  // E.g. ["sink", "leak", "AC", "roof"].

  "accepted_topics": string[],
  // Topics the AI said YES to (in_trade=true check_trade results, or end_call outcome=accepted).

  "rejected_topics": string[],
  // Topics the AI said NO to (in_trade=false check_trade, or end_call outcome=rejected).

  "follow_up_priority": "high" | "medium" | "low" | "none",
  // Recommendation for the boss: should they call this customer back?
  // high: customer asked something we should be doing but AI missed it
  // medium: AI couldn't fully understand; or customer is "considering"
  // low: short / unclear transcript
  // none: clean accept/reject, no opportunity

  "follow_up_notes": string | null,
  // 1-sentence reason for the follow-up recommendation. Explain WHY the boss
  // should call back, or null if no follow-up needed.
}

Return only valid JSON. No prose. No markdown code blocks.`;

export async function summarizeWithLLM(
  transcript: Array<{ role: string; text: string }>,
  callerIdName: string | null,
  issueType: string | null,
  decision: string,
  acceptedTopics: string[] = [],
  rejectedTopics: string[] = [],
  extraContext?: { durationSeconds?: number },
): Promise<CallSummary> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured — caller should fall back to regex");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userPayload = {
    caller_id_name: callerIdName,
    ai_decision: decision,
    recognized_issue_type: issueType,
    call_duration_seconds: extraContext?.durationSeconds ?? null,
    ai_accepted_topics: acceptedTopics,
    ai_rejected_topics: rejectedTopics,
    transcript: transcript.map((m) => ({
      role: m.role,
      text: m.text,
    })),
  };

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 500,
  });

  const raw = completion.choices[0].message.content || "{}";
  const parsed = JSON.parse(raw);

  return {
    customerNameExtracted: parsed.customer_name ?? null,
    intentSummary: parsed.intent_summary ?? null,
    customerTendency: (parsed.tendency as CallSummary["customerTendency"]) ?? "uncertain",
    mentionedTopics: Array.isArray(parsed.topics) ? parsed.topics.map((t: string) => t.toLowerCase()) : [],
    acceptedTopics: Array.isArray(parsed.accepted_topics) ? parsed.accepted_topics : [],
    rejectedTopics: Array.isArray(parsed.rejected_topics) ? parsed.rejected_topics : [],
    followUpPriority: (parsed.follow_up_priority as CallSummary["followUpPriority"]) ?? "none",
    followUpNotes: parsed.follow_up_notes ?? null,
    followUpRecommended: ["high", "medium"].includes(parsed.follow_up_priority),
    transcriptCoherence: "medium", // LLM doesn't set this; default to medium
  };
}

/**
 * Best-effort summarize: try LLM first, fall back to regex.
 * Returns CallSummary and a flag indicating which path was used.
 */
export async function summarizeWithFallback(
  transcript: Array<{ role: string; text: string }>,
  callerIdName: string | null,
  issueType: string | null,
  decision: string,
  acceptedTopics: string[] = [],
  rejectedTopics: string[] = [],
): Promise<{ summary: CallSummary; source: "llm" | "regex" }> {
  if (process.env.OPENAI_API_KEY) {
    try {
      const llmResult = await summarizeWithLLM(
        transcript,
        callerIdName,
        issueType,
        decision,
        acceptedTopics,
        rejectedTopics,
      );
      return { summary: llmResult, source: "llm" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[openai-summarize] LLM failed, falling back to regex: ${msg}`);
    }
  }
  return {
    summary: summarizeCall(transcript, callerIdName, issueType, decision, acceptedTopics, rejectedTopics),
    source: "regex",
  };
}
