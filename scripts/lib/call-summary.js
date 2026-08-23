/**
 * call-summary.js — JavaScript port of src/lib/call-summary.ts
 * Same logic but importable from CommonJS Node scripts.
 */

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

const SERVICES_WE_DONT_DO = [
  "roof", "roofing", "shingle",
  "hvac", "ac unit", "ac system", "central air", "compressor", "condenser",
  "foundation", "slab leak", "tankless water heater",
  "electrical panel", "panel upgrade", "meter",
  "landscap", "lawn", "mow", "tree",
  "pest", "termite", "rodent",
  "water heater", "water pump", "well pump", "submersible",
  "junk", "haul", "debris removal",
  "renovation", "remodel", "addition",
  "septic",
];

const PHRASE_SIGNALS = {
  scheduling: [/\b(schedule|book|appointment|come (out|over|by)|tomorrow|today|tonight|this week|next week|morning|afternoon|evening)\b/i],
  price_shopping: [/\b(how much|what.*(cost|charge|rate|price)|rate|estimate|quote|cheaper|afford|budget|expensive)\b/i],
  considering: [/\b(let me think|i'?ll (think|consider|get back|let you know)|call you back|think about it|maybe|perhaps|not sure yet|decide (later|soon))\b/i],
  service_inquiry: [/\b(do you (do|handle|service|cover|repair|fix)|can you|are you (open|available)|what (do you|services|kind)|services you (offer|provide))\b/i],
  complaint: [/\b(terrible|awful|unacceptable|frustrat|angry|upset|complaint|terrible (service|experience)|never again|refund|manager)\b/i],
  urgent: [/\b(emergency|urgent|right now|asap|burst|flood|leak(ing|ed)?|water (everywhere|damage)|sparking|electrocute|gas (leak|smell)|no power|can'?t wait)\b/i],
  info_general: [],
  uncertain: [],
};

function capitalize(s) {
  return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function extractCustomerName(transcript, callerIdName = null) {
  if (!transcript || transcript.length === 0) return callerIdName;
  for (const m of transcript) {
    if (m.role !== "user" || !m.text) continue;
    const text = m.text.trim();
    let m1 = text.match(/\bmy name(?:'s)?\s+(?:is\s+)?([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
    if (m1) return capitalize(m1[1]);
    let m2 = text.match(/\b(?:I'?m|I am)\s+([A-Za-z][a-z]+)(?:\s|,|\.|$)/);
    if (m2 && !/^(here|looking|calling|interested|having|a|not|the|sorry)/i.test(m2[1])) {
      return capitalize(m2[1]);
    }
    let m3 = text.match(/^(?:this is\s+)?([A-Za-z][a-z]+)(?:\s+speaking|\s+here|\s+calling)/i);
    if (m3) return capitalize(m3[1]);
    let m4 = text.match(/\bname'?s\s+([A-Za-z][a-z]+)/i);
    if (m4) return capitalize(m4[1]);
  }
  return callerIdName;
}

function extractMentionedTopics(transcript) {
  if (!transcript) return [];
  const allUserText = transcript.filter((m) => m.role === "user" && m.text).map((m) => m.text).join(" ").toLowerCase();
  const topics = new Set();
  // Detect junk-removal context FIRST
  const junkContextPatterns = [
    /\b(disregarded|throw out|throw away|haul|debris|junk|carried in (the )?(garage|yard|attic))\b/,
    /\b(electrical devices|junk (hauling|removal|pickup))\b/,
  ];
  const isJunkContext = junkContextPatterns.some((p) => p.test(allUserText));
  if (isJunkContext) topics.add("junk removal");
  for (const svc of SERVICES_WE_DO) {
    if (allUserText.includes(svc) && !(isJunkContext && svc === "electrical")) topics.add(svc);
  }
  for (const svc of SERVICES_WE_DONT_DO) {
    if (allUserText.includes(svc) && svc !== "electrical panel") topics.add(svc);
  }
  const genericPatterns = [
    /\b(water pump|well pump|pump)\b/g, /\b(leak|leaking|leaked)\b/g,
    /\b(pipe|pipes|piping)\b/g, /\b(drain|drains|drainage|clogged|clog)\b/g,
    /\b(roof|roofing|shingle|shingles)\b/g,
    /\b(ac|air condition|air conditioning|hvac|compressor)\b/g,
    /\b(electrical|electricity|wiring|outlet|outlets|switch|switches|breaker|breakers)\b/g,
    /\b(furniture|cabinet|cabinets|shelf|shelves|tv mount|assembly|assemble)\b/g,
    /\b(fence|fencing|gate|deck|decking)\b/g,
    /\b(garbage disposal|disposal|garbage|trash)\b/g,
    /\b(faucet|faucets|tap|taps)\b/g, /\b(toilet|toilets)\b/g, /\b(sink|sinks)\b/g,
    /\b(junk|trash|haul)\b/g,
  ];
  for (const p of genericPatterns) {
    const matches = allUserText.match(p);
    if (matches) {
      for (const m of matches) {
        const word = m.toLowerCase().split(/\s+/)[0];
        // In junk context, skip generic "electrical"/"electricity" — we
        // already tagged "junk removal" which is more useful than the bare
        // word "electrical". Keep "outlet", "switch", "breaker" as those
        // are real work categories the customer might want.
        if (isJunkContext && (word === "electrical" || word === "electricity")) continue;
        topics.add(word);
      }
    }
  }
  return Array.from(topics).sort();
}

function classifyTendency(transcript) {
  if (!transcript || transcript.length === 0) return "uncertain";
  const allUserText = transcript.filter((m) => m.role === "user" && m.text).map((m) => m.text).join(" ");
  const priority = ["complaint", "urgent", "scheduling", "price_shopping", "service_inquiry", "considering", "info_general"];
  for (const tendency of priority) {
    for (const p of PHRASE_SIGNALS[tendency]) {
      if (p.test(allUserText)) return tendency;
    }
  }
  return "uncertain";
}

function truncate(s, n) { return s.length <= n ? s : s.slice(0, n).trim() + "…"; }

function generateIntentSummary(transcript, issueType, decision) {
  if (!transcript || transcript.length === 0) {
    return issueType ? `Customer asked about ${issueType} service.` : "Call recorded (no transcript available).";
  }
  const userMessages = transcript.filter((m) => m.role === "user" && m.text && m.text.length > 5).slice(0, 2).map((m) => m.text.trim());
  if (userMessages.length === 0) {
    return issueType ? `Customer asked about ${issueType} service.` : "Customer inquiry recorded.";
  }
  if (issueType && decision !== "rejected") {
    return `Customer asked about ${issueType} service. Initial request: "${truncate(userMessages[0], 80)}"`;
  }
  if (decision === "rejected") {
    return `Customer wanted help with: "${truncate(userMessages[0], 120)}"${userMessages[1] ? ` Then: "${truncate(userMessages[1], 80)}"` : ""}`;
  }
  return `Customer said: "${truncate(userMessages[0], 120)}"`;
}

function recommendFollowUp(transcript, decision, tendency, mentionedTopics) {
  if (!transcript || transcript.length === 0) return { priority: "none", notes: null, recommended: false };
  // Re-check junk context here so we don't recommend "we do electrical!" for
  // a customer asking about electrical junk removal.
  const allUserText = transcript.filter((m) => m.role === "user" && m.text).map((m) => m.text).join(" ").toLowerCase();
  const junkContextPatterns = [
    /\b(disregarded|throw out|throw away|haul|debris|junk|carried in (the )?(garage|yard|attic))\b/,
    /\b(electrical devices|junk (hauling|removal|pickup))\b/,
  ];
  const isJunkContext = junkContextPatterns.some((p) => p.test(allUserText));
  const weDoTopics = mentionedTopics.filter((t) => {
    if (isJunkContext && t === "electrical") return false;
    return SERVICES_WE_DO.some((svc) => t.includes(svc) || svc.includes(t));
  });
  const weDontTopics = mentionedTopics.filter((t) => SERVICES_WE_DONT_DO.some((svc) => t.includes(svc) || svc.includes(t)));
  if (weDoTopics.length > 0 && (decision === "unsure" || decision === "rejected")) {
    return {
      priority: "high",
      notes: `Customer asked about ${weDoTopics.join(", ")} — these are services we offer. AI may have incorrectly rejected. Call back to confirm.`,
      recommended: true,
    };
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

function summarizeCall(transcript, callerIdName, issueType, decision) {
  const customerNameExtracted = extractCustomerName(transcript, callerIdName);
  const mentionedTopics = extractMentionedTopics(transcript);
  const customerTendency = classifyTendency(transcript);
  const intentSummary = generateIntentSummary(transcript, issueType, decision);
  const followUp = recommendFollowUp(transcript, decision, customerTendency, mentionedTopics);
  return {
    customerNameExtracted, intentSummary, customerTendency, mentionedTopics,
    followUpPriority: followUp.priority, followUpNotes: followUp.notes, followUpRecommended: followUp.recommended,
  };
}

module.exports = {
  extractCustomerName, extractMentionedTopics, classifyTendency,
  generateIntentSummary, recommendFollowUp, summarizeCall,
};
