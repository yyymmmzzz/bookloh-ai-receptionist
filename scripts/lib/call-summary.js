/**
 * call-summary.js — JavaScript port of src/lib/call-summary.ts
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

const PHRASE_SIGNALS = {
  scheduling: [/\b(schedule|book|appointment|come (out|over|by)|tomorrow|today|tonight|this week|next week|morning|afternoon|evening)\b/i],
  price_shopping: [/\b(how much|what.*(cost|charge|rate|price)|rate|estimate|quote|cheaper|afford|budget|expensive)\b/i],
  considering: [/\b(let me think|i'?ll (think|consider|get back|let you know)|call you back|think about it|maybe|perhaps|not sure yet|decide (later|soon))\b/i],
  service_inquiry: [/\b(do you (do|handle|service|cover|repair|fix)|can you|are you (open|available)|what (do you|services|kind)|services you (offer|provide))\b/i],
  complaint: [/\b(terrible|awful|unacceptable|frustrat|angry|upset|complaint|terrible (service|experience)|never again|refund|manager)\b/i],
  urgent: [
    /\b(emergency|urgent|right now|asap|burst|flood|leak(ing|ed)?|water (everywhere|damage)|sparking|electrocute|gas (leak|smell)|no power|can'?t wait)\b/i,
    /\b(ac|air condition(er|ing)?|hvac|compressor|condenser|furnace|heater|boiler).{0,30}(broken|not work|dead|down|out|stop|leak|noise|won'?t turn)\b/i,
    /\b(no power|no (hot )?water|no heat|flooding|frozen|burst pipe|sewage backup)\b/i,
  ],
  info_general: [],
  uncertain: [],
};

const JUNK_CONTEXT_PATTERNS = [
  /\b(disregarded|throw out|throw away|haul|debris|junk|carried in (the )?(garage|yard|attic))\b/,
  /\b(electrical devices|junk (hauling|removal|pickup))\b/,
];

const NON_NAME_WORDS = new Set([
  "in", "on", "at", "by", "to", "of", "for", "with", "from", "as", "at",
  "here", "there", "now", "then", "still", "just", "also", "too", "very", "much",
  "looking", "calling", "interested", "having", "sorry", "going", "trying",
  "doing", "really", "actually", "definitely", "probably", "maybe", "kinda",
  "sorta", "pretty", "going to", "kind of", "sort of",
  "can", "will", "would", "should", "may", "must", "could",
  "able", "free", "available", "open", "closed", "busy", "ready",
  "home", "back", "today", "tomorrow", "yesterday",
]);

function capitalize(s) {
  return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function isLikelyName(word) {
  const lower = word.toLowerCase();
  if (NON_NAME_WORDS.has(lower)) return false;
  if (word.length < 2 || word.length > 20) return false;
  return true;
}

function extractCustomerName(transcript, callerIdName = null) {
  if (!transcript || transcript.length === 0) return callerIdName;
  for (const m of transcript) {
    if (m.role !== "user" || !m.text) continue;
    const text = m.text.trim();
    let m1 = text.match(/\bmy name(?:'s)?\s+(?:is\s+)?([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
    if (m1 && isLikelyName(m1[1])) return capitalize(m1[1]);
    let m2 = text.match(/\b(?:I'?m|I am)\s+([A-Za-z][a-z]+)(?:\s|,|\.|$)/);
    if (m2 && isLikelyName(m2[1])) return capitalize(m2[1]);
    let m3 = text.match(/^(?:this is\s+)?([A-Za-z][a-z]+)(?:\s+speaking|\s+here|\s+calling)/i);
    if (m3 && isLikelyName(m3[1])) return capitalize(m3[1]);
    let m4 = text.match(/\b(?:his|her|their) name(?:'s)?\s+(?:is\s+)?([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
    if (m4 && isLikelyName(m4[1])) return capitalize(m4[1]);
    let m5 = text.match(/\b(?:the )?name'?s\s+([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)/i);
    if (m5 && isLikelyName(m5[1])) return capitalize(m5[1]);
  }
  return callerIdName;
}

function isJunkContext(text) {
  return JUNK_CONTEXT_PATTERNS.some((p) => p.test(text));
}

function scoreUserMessage(text) {
  const t = text.toLowerCase();
  let score = 0;
  if (t.length >= 5 && t.length <= 20) score += 0.3;
  else if (t.length > 20 && t.length <= 60) score += 0.7;
  else if (t.length > 60 && t.length <= 100) score += 1.0;
  else if (t.length > 100) score += 0.5;
  const problemKeywords = /\b(leak|broken|not work|dead|stop|cracked|won'?t|can'?t|no (power|water|heat)|how (to|do|can)|need|want|fix|repair|install|broken|not turn)\b/;
  if (problemKeywords.test(t)) score += 0.5;
  const allServices = [...SERVICES_WE_DO, ...SERVICES_WE_DONT_DO];
  for (const svc of allServices) {
    if (t.includes(svc)) {
      score += 0.4;
      break;
    }
  }
  if (/\bmy name is\b/i.test(t)) score += 0.3;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(t)) score += 0.3;
  if (/\b77\d{3}\b/.test(t)) score += 0.3;
  if (/\barea (code|restriction|zip)\b/i.test(t)) score += 0.2;
  if (/\b(how much|cost|price|rate|charge|tomorrow|today|morning|afternoon|when)\b/i.test(t)) score += 0.3;
  if (/^\s*(yes|no|okay|ok|sure|right|uh huh|mm hmm|hello|hi|bye|thank you|thanks|thank)\s*[\.\?]?\s*$/i.test(t)) {
    score -= 1.0;
  }
  return score;
}

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n).trim() + "…";
}

function analyzeTranscriptCoherence(transcript) {
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
  const allServices = [...SERVICES_WE_DO, ...SERVICES_WE_DONT_DO];
  const allUserText = userMessages.map((m) => m.text).join(" ").toLowerCase();
  const hasService = allServices.some((svc) => allUserText.includes(svc));
  if (!hasService) return "low";
  if (avgLen >= 30 && userMessages.length >= 4 && hasService) return "high";
  return "medium";
}

function generateIntentSummary(transcript, issueType, decision) {
  if (!transcript || transcript.length === 0) {
    return issueType ? `Customer asked about ${issueType} service.` : "Call recorded (no transcript available).";
  }
  const userMessages = transcript.filter((m) => m.role === "user" && m.text && m.text.length > 5);
  if (userMessages.length === 0) {
    return issueType ? `Customer asked about ${issueType} service.` : "Customer inquiry recorded.";
  }
  const scored = userMessages
    .map((m, i) => ({ idx: i, msg: m.text.trim(), score: scoreUserMessage(m.text) }))
    .sort((a, b) => b.score - a.score);
  const top1 = scored[0];
  const top2 = scored[1];
  if (top1.score < 0.2) {
    return issueType && decision !== "rejected"
      ? `Customer asked about ${issueType} service.`
      : `Customer said: "${truncate(userMessages[0].text, 120)}"`;
  }
  const parts = [];
  if (issueType && decision !== "rejected") {
    parts.push(`Customer asked about ${issueType} service.`);
  }
  parts.push(`Initial request: "${truncate(top1.msg, 100)}"`);
  if (top2 && top2.score > 0.5 && top2.idx !== top1.idx) {
    parts.push(`Then: "${truncate(top2.msg, 80)}"`);
  }
  return parts.join(" ");
}

function extractMentionedTopics(transcript) {
  if (!transcript) return [];
  const allUserText = transcript.filter((m) => m.role === "user" && m.text).map((m) => m.text).join(" ").toLowerCase();
  const topics = new Set();
  const junk = isJunkContext(allUserText);
  if (junk) topics.add("junk removal");
  for (const svc of SERVICES_WE_DO) {
    if (allUserText.includes(svc) && !(junk && svc === "electrical")) topics.add(svc);
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
        const norm = m.toLowerCase().split(/\s+/)[0];
        if (junk && (norm === "electrical" || norm === "electricity")) continue;
        topics.add(norm);
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

function recommendFollowUp(transcript, decision, tendency, mentionedTopics, coherence) {
  if (!transcript || transcript.length === 0) return { priority: "none", notes: null, recommended: false };
  if (coherence === "low") {
    return {
      priority: "low",
      notes: "Transcript was short or unclear — call back only if you recognize the number or context.",
      recommended: false,
    };
  }
  const allUserText = transcript.filter((m) => m.role === "user" && m.text).map((m) => m.text).join(" ").toLowerCase();
  const junk = isJunkContext(allUserText);
  const weDoTopics = mentionedTopics.filter((t) => {
    if (junk && t === "electrical") return false;
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

function summarizeCall(transcript, callerIdName, issueType, decision, acceptedTopics = [], rejectedTopics = []) {
  const customerNameExtracted = extractCustomerName(transcript, callerIdName);
  const mentionedTopics = extractMentionedTopics(transcript);
  const customerTendency = classifyTendency(transcript);
  const transcriptCoherence = analyzeTranscriptCoherence(transcript);
  const intentSummary = generateIntentSummary(transcript, issueType, decision);
  const followUp = recommendFollowUp(transcript, decision, customerTendency, mentionedTopics, transcriptCoherence);
  return {
    customerNameExtracted, intentSummary, customerTendency, mentionedTopics,
    acceptedTopics, rejectedTopics,
    followUpPriority: followUp.priority, followUpNotes: followUp.notes, followUpRecommended: followUp.recommended,
    transcriptCoherence,
  };
}

module.exports = {
  extractCustomerName, extractMentionedTopics, classifyTendency,
  generateIntentSummary, analyzeTranscriptCoherence, recommendFollowUp, summarizeCall,
  scoreUserMessage, isJunkContext, isLikelyName,
  SERVICES_WE_DO, SERVICES_WE_DONT_DO,
};
