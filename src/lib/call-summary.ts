/**
 * call-summary.ts — Extract intelligence from Vapi call transcripts
 *
 * The AI receptionist captures structured data (decision, issue_type, quote)
 * via its own tool calls. But it often misses:
 *   1. The customer's NAME (e.g. "my name is Nathan")
 *   2. What the customer actually SAID (intent / what they wanted)
 *   3. Their TENDENCY (price shopping, scheduling, considering, etc.)
 *   4. FOLLOW-UP recommendations for the boss
 *   5. ACCEPTED vs REJECTED topics (multi-issue calls)
 *   6. TRANSCRIPT COHERENCE (low/medium/high for follow-up triage)
 *
 * All functions are PURE (no side effects, no AI calls) so they can run
 * synchronously in the webhook handler.
 */

export type CustomerTendency =
  | "scheduling"          // explicitly setting up an appointment
  | "service_inquiry"    // asking what we can do / what's covered
  | "price_shopping"     // asking rates / comparing prices
  | "considering"        // "let me think about it / call you back"
  | "complaint"          // unhappy with prior service
  | "urgent"             // emergency situation
  | "uncertain"          // couldn't clearly identify intent
  | "info_general";      // general chitchat / no clear service intent

export type FollowUpPriority = "high" | "medium" | "low" | "none";

export type TranscriptCoherence = "low" | "medium" | "high";

export interface CallSummary {
  customerNameExtracted: string | null;
  intentSummary: string | null;
  customerTendency: CustomerTendency;
  mentionedTopics: string[];
  acceptedTopics: string[];
  rejectedTopics: string[];
  followUpPriority: FollowUpPriority;
  followUpNotes: string | null;
  followUpRecommended: boolean;
  transcriptCoherence: TranscriptCoherence;
}

// Topics we know we handle — used for follow-up scoring
const SERVICES_WE_DO = [
  "faucet", "toilet", "sink", "drain", "leak", "pipe", "plumb",
  "outlet", "switch", "breaker", "electrical", "wiring", "gfci",
  "fan", "ceiling fan", "light", "fixture",
  "furniture", "assembl", "mount", "tv mount", "shelf", "door", "hinge", "cabinet",
  "drywall", "patch", "ceiling", "wall", "paint", "stain",
  "fence", "gate", "deck",
  "pressure wash", "power wash",
  "garbage disposal", "disposal",
  "handyman", "small job", "odd job",
];

// Topics we explicitly DON'T do — these are real customer pain points we
// can still log for visibility, but no follow-up action
const SERVICES_WE_DONT_DO = [
  "roof", "roofing", "shingle",
  "hvac", "ac", "ac unit", "ac system", "central air", "compressor", "condenser",
  "foundation", "slab leak", "tankless water heater",
  "electrical panel", "panel upgrade", "meter",
  "landscap", "lawn", "mow", "tree",
  "pest", "termite", "rodent",
  "water heater", "water pump", "well pump", "submersible",
  "junk", "haul", "debris removal",
  "renovation", "remodel", "addition",
  "septic",
];

// Price-shopping / service-inquiry / scheduling signal phrases
const PHRASE_SIGNALS: Record<CustomerTendency, RegExp[]> = {
  scheduling: [
    /\b(schedule|book|appointment|come (out|over|by)|tomorrow|today|tonight|this week|next week|morning|afternoon|evening)\b/i,
  ],
  price_shopping: [
    /\b(how much|what.*(cost|charge|rate|price)|rate|estimate|quote|cheaper|afford|budget|expensive)\b/i,
  ],
  considering: [
    /\b(let me think|i'?ll (think|consider|get back|let you know)|call you back|think about it|maybe|perhaps|not sure yet|decide (later|soon))\b/i,
  ],
  service_inquiry: [
    /\b(do you (do|handle|service|cover|repair|fix)|can you|are you (open|available)|what (do you|services|kind)|services you (offer|provide))\b/i,
  ],
  complaint: [
    /\b(terrible|awful|unacceptable|frustrat|angry|upset|complaint|terrible (service|experience)|never again|refund|manager)\b/i,
  ],
  urgent: [
    // Original urgent phrases (water everywhere, gas leak, sparking, etc.)
    /\b(emergency|urgent|right now|asap|burst|flood|leak(ing|ed)?|water (everywhere|damage)|sparking|electrocute|gas (leak|smell)|no power|can'?t wait)\b/i,
    // ↓ New: Houston / home-services specific emergencies
    /\b(ac|air condition(er|ing)?|hvac|compressor|condenser|furnace|heater|boiler).{0,30}(broken|not work|dead|down|out|stop|leak|noise|won'?t turn)\b/i,
    /\b(no power|no (hot )?water|no heat|flooding|frozen|burst pipe|sewage backup)\b/i,
  ],
  info_general: [],
  uncertain: [],
};

// Junk-removal context patterns — when these match, "electrical" doesn't
// mean "wiring work" but rather "broken electrical items to be hauled away".
const JUNK_CONTEXT_PATTERNS = [
  /\b(disregarded|throw out|throw away|haul|debris|junk|carried in (the )?(garage|yard|attic))\b/,
  /\b(electrical devices|junk (hauling|removal|pickup))\b/,
];

// Names that look like English words but are very unlikely to be someone's name.
// Used to reject false-positive name extractions like "I'm in Houston" → "In".
const NON_NAME_WORDS = new Set([
  // prepositions / adverbs
  "in", "on", "at", "by", "to", "of", "for", "with", "from", "as", "at",
  "here", "there", "now", "then", "still", "just", "also", "too", "very", "much",
  // common words that follow "I'm" / "This is"
  "looking", "calling", "interested", "having", "sorry", "going", "trying",
  "doing", "really", "actually", "definitely", "probably", "maybe", "kinda",
  "sorta", "pretty", "going to", "kind of", "sort of",
  // status / ability
  "can", "will", "would", "should", "may", "must", "could",
  "able", "free", "available", "open", "closed", "busy", "ready",
  // locations / times
  "home", "back", "today", "tomorrow", "yesterday",
  // common names that are also words (too risky to extract)
  // We add a few short ambiguous ones, but we err on side of accepting (since
  // the harm of a false negative is worse than a false positive here).
]);

function capitalize(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isLikelyName(word: string): boolean {
  const lower = word.toLowerCase();
  if (NON_NAME_WORDS.has(lower)) return false;
  // Names are typically 2-20 characters
  if (word.length < 2 || word.length > 20) return false;
  return true;
}

/**
 * Extract customer name from transcript — looks for common self-introduction
 * patterns. Falls back to caller ID name only if no transcript match.
 */
export function extractCustomerName(
  transcript: Array<{ role: string; text: string }> | null | undefined,
  callerIdName: string | null = null,
): string | null {
  if (!transcript || transcript.length === 0) return callerIdName;

  for (const m of transcript) {
    if (m.role !== "user" || !m.text) continue;
    const text = m.text.trim();

    // "My name is Nathan" / "my names Nathan"
    let m1 = text.match(/\bmy name(?:'s)?\s+(?:is\s+)?([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
    if (m1 && isLikelyName(m1[1])) return capitalize(m1[1]);

    // "I'm Nathan" / "Im Nathan" / "I am Nathan" — but skip "I'm here for..." patterns
    let m2 = text.match(/\b(?:I'?m|I am)\s+([A-Za-z][a-z]+)(?:\s|,|\.|$)/);
    if (m2 && isLikelyName(m2[1])) return capitalize(m2[1]);

    // "This is Nathan" / "Nathan speaking" / "Nathan here"
    let m3 = text.match(/^(?:this is\s+)?([A-Za-z][a-z]+)(?:\s+speaking|\s+here|\s+calling)/i);
    if (m3 && isLikelyName(m3[1])) return capitalize(m3[1]);

    // "His/Her/Their name is X"
    let m4 = text.match(/\b(?:his|her|their) name(?:'s)?\s+(?:is\s+)?([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
    if (m4 && isLikelyName(m4[1])) return capitalize(m4[1]);

    // "Name's X" / "the name's X"
    let m5 = text.match(/\b(?:the )?name'?s\s+([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
    if (m5 && isLikelyName(m5[1])) return capitalize(m5[1]);
  }

  return callerIdName;
}

function isJunkContext(text: string): boolean {
  return JUNK_CONTEXT_PATTERNS.some((p) => p.test(text));
}

/**
 * Score a user message for its information content.
 * Higher score = more useful for intent_summary.
 */
function scoreUserMessage(text: string): number {
  const t = text.toLowerCase();
  let score = 0;

  // Length score (0-1): sweet spot is 20-100 chars
  if (t.length >= 5 && t.length <= 20) score += 0.3;
  else if (t.length > 20 && t.length <= 60) score += 0.7;
  else if (t.length > 60 && t.length <= 100) score += 1.0;
  else if (t.length > 100) score += 0.5;
  else score += 0; // too short

  // Problem keywords (the customer is explaining what they need)
  const problemKeywords = /\b(leak|broken|not work|dead|stop|cracked|won'?t|can'?t|no (power|water|heat)|how (to|do|can)|need|want|fix|repair|install|broken|not turn)\b/;
  if (problemKeywords.test(t)) score += 0.5;

  // Service keywords
  const allServices = [...SERVICES_WE_DO, ...SERVICES_WE_DONT_DO];
  for (const svc of allServices) {
    if (t.includes(svc)) {
      score += 0.4;
      break; // only count once
    }
  }

  // Name / phone / zipcode patterns
  if (/\bmy name is\b/i.test(t)) score += 0.3;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(t)) score += 0.3; // phone
  if (/\b77\d{3}\b/.test(t)) score += 0.3; // Houston ZIP
  if (/\barea (code|restriction|zip)\b/i.test(t)) score += 0.2;

  // Price / time keywords
  if (/\b(how much|cost|price|rate|charge|tomorrow|today|morning|afternoon|when)\b/i.test(t)) score += 0.3;

  // Acks (very negative score)
  if (/^\s*(yes|no|okay|ok|sure|right|uh huh|mm hmm|hello|hi|bye|thank you|thanks|thank)\s*[\.\?]?\s*$/i.test(t)) {
    score -= 1.0;
  }

  return score;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trim() + "…";
}

/**
 * Analyze transcript quality / coherence.
 *
 * "low" = likely wrong number, misdial, STT failure, or non-content call
 * "high" = full coherent conversation with clear service request
 * "medium" = everything else
 */
export function analyzeTranscriptCoherence(
  transcript: Array<{ role: string; text: string }> | null | undefined,
): TranscriptCoherence {
  if (!transcript || transcript.length === 0) return "low";

  const userMessages = transcript.filter((m) => m.role === "user" && m.text);
  if (userMessages.length < 3) return "low";

  const totalChars = userMessages.reduce((s, m) => s + m.text.length, 0);
  const avgLen = totalChars / userMessages.length;
  if (avgLen < 20) return "low";

  const ackOnlyCount = userMessages.filter((m) =>
    /^\s*(yes|no|okay|ok|sure|right|uh huh|mm hmm|hello|hi|bye|thank you|thanks|thank|are you|what'?s their)\s*[\.\?]?\s*$/i.test(m.text),
  ).length;
  if (ackOnlyCount / userMessages.length > 0.5) return "low";

  // Check for any service mention (we OR don't do)
  const allServices = [...SERVICES_WE_DO, ...SERVICES_WE_DONT_DO];
  const allUserText = userMessages.map((m) => m.text).join(" ").toLowerCase();
  const hasService = allServices.some((svc) => allUserText.includes(svc));
  if (!hasService) {
    // No service mention — could be just chitchat
    return "low";
  }

  if (avgLen >= 30 && userMessages.length >= 4 && hasService) return "high";
  return "medium";
}

/**
 * Generate a 1-sentence intent summary from transcript.
 * Picks the HIGHEST-SCORING user message (not just the first one) so short
 * acks like "Hello?" or "Hi. Mildly speaking," are skipped.
 */
export function generateIntentSummary(
  transcript: Array<{ role: string; text: string }> | null | undefined,
  issueType: string | null,
  decision: string,
): string | null {
  if (!transcript || transcript.length === 0) {
    return issueType
      ? `Customer asked about ${issueType} service.`
      : "Call recorded (no transcript available).";
  }

  const userMessages = transcript.filter((m) => m.role === "user" && m.text && m.text.length > 5);

  if (userMessages.length === 0) {
    return issueType
      ? `Customer asked about ${issueType} service.`
      : "Customer inquiry recorded.";
  }

  // Score each user message, pick top 1-2
  const scored = userMessages
    .map((m, i) => ({ idx: i, msg: m.text.trim(), score: scoreUserMessage(m.text) }))
    .sort((a, b) => b.score - a.score);

  const top1 = scored[0];
  const top2 = scored[1];

  // If best score is still very low, fall back to original behavior
  if (top1.score < 0.2) {
    return issueType && decision !== "rejected"
      ? `Customer asked about ${issueType} service.`
      : `Customer said: "${truncate(userMessages[0].text, 120)}"`;
  }

  // Compose summary
  const parts: string[] = [];
  if (issueType && decision !== "rejected") {
    parts.push(`Customer asked about ${issueType} service.`);
  }
  parts.push(`Initial request: "${truncate(top1.msg, 100)}"`);
  if (top2 && top2.score > 0.5 && top2.idx !== top1.idx) {
    parts.push(`Then: "${truncate(top2.msg, 80)}"`);
  }

  return parts.join(" ");
}

/**
 * Extract all topics the customer mentioned in the call.
 * Used for follow-up context + filtering dashboard.
 */
export function extractMentionedTopics(
  transcript: Array<{ role: string; text: string }> | null | undefined,
): string[] {
  if (!transcript) return [];

  const allUserText = transcript
    .filter((m) => m.role === "user" && m.text)
    .map((m) => m.text)
    .join(" ")
    .toLowerCase();

  const topics = new Set<string>();

  const junk = isJunkContext(allUserText);
  if (junk) topics.add("junk removal");

  for (const svc of SERVICES_WE_DO) {
    if (allUserText.includes(svc) && !(junk && svc === "electrical")) {
      topics.add(svc);
    }
  }
  for (const svc of SERVICES_WE_DONT_DO) {
    if (allUserText.includes(svc) && svc !== "electrical panel") topics.add(svc);
  }

  const genericPatterns: RegExp[] = [
    /\b(water pump|well pump|pump)\b/g,
    /\b(leak|leaking|leaked)\b/g,
    /\b(pipe|pipes|piping)\b/g,
    /\b(drain|drains|drainage|clogged|clog)\b/g,
    /\b(roof|roofing|shingle|shingles)\b/g,
    /\b(ac|air condition|air conditioning|hvac|compressor)\b/g,
    /\b(electrical|electricity|wiring|outlet|outlets|switch|switches|breaker|breakers)\b/g,
    /\b(furniture|cabinet|cabinets|shelf|shelves|tv mount|assembly|assemble)\b/g,
    /\b(fence|fencing|gate|deck|decking)\b/g,
    /\b(garbage disposal|disposal|garbage|trash)\b/g,
    /\b(faucet|faucets|tap|taps)\b/g,
    /\b(toilet|toilets)\b/g,
    /\b(sink|sinks)\b/g,
    /\b(junk|trash|haul)\b/g,
  ];
  for (const p of genericPatterns) {
    const matches = allUserText.match(p);
    if (matches) {
      for (const m of matches) {
        const norm = m.toLowerCase().split(/\s+/)[0];
        if (junk && (norm === "electrical" || norm === "electricity")) continue;
        topics.add(norm);
      }
    }
  }

  return Array.from(topics).sort();
}

/**
 * Classify customer's tendency based on phrases in their messages.
 */
export function classifyTendency(
  transcript: Array<{ role: string; text: string }> | null | undefined,
): CustomerTendency {
  if (!transcript || transcript.length === 0) return "uncertain";

  const allUserText = transcript
    .filter((m) => m.role === "user" && m.text)
    .map((m) => m.text)
    .join(" ");

  const priority: CustomerTendency[] = [
    "complaint",
    "urgent",
    "scheduling",
    "price_shopping",
    "service_inquiry",
    "considering",
    "info_general",
  ];

  for (const tendency of priority) {
    const patterns = PHRASE_SIGNALS[tendency];
    for (const p of patterns) {
      if (p.test(allUserText)) return tendency;
    }
  }

  return "uncertain";
}

/**
 * Compute follow-up recommendation for the boss.
 */
export function recommendFollowUp(
  transcript: Array<{ role: string; text: string }> | null | undefined,
  decision: string,
  tendency: CustomerTendency,
  mentionedTopics: string[],
  coherence: TranscriptCoherence,
): { priority: FollowUpPriority; notes: string | null; recommended: boolean } {
  if (!transcript || transcript.length === 0) {
    return { priority: "none", notes: null, recommended: false };
  }

  // Low coherence = don't recommend follow-up (likely wrong number, misdial)
  if (coherence === "low") {
    return {
      priority: "low",
      notes: "Transcript was short or unclear — call back only if you recognize the number or context.",
      recommended: false,
    };
  }

  const allUserText = transcript
    .filter((m) => m.role === "user" && m.text)
    .map((m) => m.text)
    .join(" ")
    .toLowerCase();
  const junk = isJunkContext(allUserText);

  const weDoTopics = mentionedTopics.filter((t) => {
    if (junk && t === "electrical") return false;
    return SERVICES_WE_DO.some((svc) => t.includes(svc) || svc.includes(t));
  });
  const weDontTopics = mentionedTopics.filter((t) =>
    SERVICES_WE_DONT_DO.some((svc) => t.includes(svc) || svc.includes(t)),
  );

  if (weDoTopics.length > 0 && (decision === "unsure" || decision === "rejected")) {
    return {
      priority: "high",
      notes: `Customer asked about ${weDoTopics.join(", ")} — these are services we offer. AI may have incorrectly rejected. Call back to confirm.`,
      recommended: true,
    };
  }

  // NEW: HVAC emergency (customer has AC/heater issue — refer to partner)
  if (weDontTopics.includes("hvac") || weDontTopics.includes("ac")) {
    if (/\b(ac|air condition|hvac|furnace|heater).{0,30}(broken|dead|not work|stop)\b/i.test(allUserText)) {
      return {
        priority: "high",
        notes: `HVAC emergency — AC/heater broken. Refer to partner HVAC contractor (or recommend they call a specialist). Time-sensitive in Houston weather.`,
        recommended: true,
      };
    }
  }

  if (decision === "unsure" && (tendency === "considering" || tendency === "price_shopping" || tendency === "service_inquiry")) {
    return {
      priority: "medium",
      notes: `Customer said "${tendency}" — call back to clarify their question${weDoTopics.length > 0 ? ` about ${weDoTopics.join(", ")}` : ""}.`,
      recommended: true,
    };
  }

  if (decision === "unsure") {
    return {
      priority: "medium",
      notes: `AI couldn't fully understand the customer (speech unclear, no issue identified, etc.). Call back to clarify what they need.`,
      recommended: true,
    };
  }

  if (decision === "accepted" && tendency === "considering") {
    return {
      priority: "medium",
      notes: `Customer accepted but said "let me think about it". Call back in 1-2 days to confirm timing.`,
      recommended: true,
    };
  }

  if (weDontTopics.length > 0 && weDoTopics.length === 0 && decision === "rejected") {
    return {
      priority: "none",
      notes: `Customer wanted ${weDontTopics.join(", ")} which are outside our service area. No follow-up action.`,
      recommended: false,
    };
  }

  if (decision === "accepted" || decision === "urgent") {
    return { priority: "none", notes: null, recommended: false };
  }

  return { priority: "low", notes: null, recommended: false };
}

/**
 * Main entry point — generate the full CallSummary from raw inputs.
 */
export function summarizeCall(
  transcript: Array<{ role: string; text: string }> | null | undefined,
  callerIdName: string | null,
  issueType: string | null,
  decision: string,
  acceptedTopics: string[] = [],
  rejectedTopics: string[] = [],
): CallSummary {
  const customerNameExtracted = extractCustomerName(transcript, callerIdName);
  const mentionedTopics = extractMentionedTopics(transcript);
  const customerTendency = classifyTendency(transcript);
  const transcriptCoherence = analyzeTranscriptCoherence(transcript);
  const intentSummary = generateIntentSummary(transcript, issueType, decision);
  const followUp = recommendFollowUp(
    transcript,
    decision,
    customerTendency,
    mentionedTopics,
    transcriptCoherence,
  );

  return {
    customerNameExtracted,
    intentSummary,
    customerTendency,
    mentionedTopics,
    acceptedTopics,
    rejectedTopics,
    followUpPriority: followUp.priority,
    followUpNotes: followUp.notes,
    followUpRecommended: followUp.recommended,
    transcriptCoherence,
  };
}
