#!/usr/bin/env node
/**
 * update-vapi-assistant.js
 *
 * Push the local system prompt + tools to the Vapi assistant.
 * Use this after editing vapi/system-prompt.md or tools.
 *
 * IMPORTANT: Vapi PATCH REPLACES the model object, so we must send
 * the full model config (provider, model, systemPrompt, tools) each time.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
if (!VAPI_API_KEY || !ASSISTANT_ID) {
  console.error("✗ Missing VAPI_API_KEY or VAPI_ASSISTANT_ID");
  process.exit(1);
}

const promptMd = fs.readFileSync(
  path.join(__dirname, "..", "vapi", "system-prompt.md"),
  "utf-8",
);
const m = promptMd.match(/## Full System Prompt[\s\S]*?```\n([\s\S]*?)\n```/);
if (!m) {
  console.error("✗ Could not find system prompt block in vapi/system-prompt.md");
  process.exit(1);
}
let systemPrompt = m[1].trim();

const EXTRA_RULES = `## CRITICAL: handle "test" and "demo" calls
If the customer says "I'm calling to test", "just testing", "is this AI?", "who are you?",
or anything that suggests they're probing rather than asking for service:
- DO NOT dismiss them or say goodbye
- Treat it as a real call: ask "what can I help you with today?"
- If they explicitly confirm it's just a test, say "Great, thanks for testing! Let me know if you have a real job for us." and then USE the end_call tool with outcome="accepted" and a summary like "Test call from customer. No real job."
- The call MUST always end with the end_call tool so the system logs it. Never let the call end on a free-text goodbye without calling end_call.

---

`;

const finalPrompt = EXTRA_RULES + systemPrompt;

// Tool definitions (must mirror what's in vapi/system-prompt.md)
const TOOLS = [
  {
    type: "function",
    function: {
      name: "validate_service",
      description:
        "Check if the customer's zip code is in our service area AND if their issue type is in our trade list. Always call this BEFORE discussing details or making any commitment.",
      parameters: {
        type: "object",
        properties: {
          zipcode: { type: "string", description: "Customer's 5-digit US zip code" },
          issue_type: {
            type: "string",
            enum: ["plumbing", "electrical", "hvac", "handyman", "roofing", "general"],
            description: "Type of repair needed",
          },
        },
        required: ["zipcode", "issue_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_price_quote",
      description:
        "Get a reference price range for a known issue type, plus the trip fee and any fuel surcharge. The trip fee is always $89. A fuel surcharge of $2 per mile is added for customers beyond 15 miles from our base. Returns the full pricing breakdown so the AI can quote a total estimate.",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            enum: ["plumbing", "electrical", "hvac", "handyman", "roofing", "general"],
          },
          distance_miles: {
            type: "number",
            description:
              "Optional. Driving distance to customer in miles. If omitted, the server will use the distance from the most recent validate_service call in this same conversation.",
          },
        },
        required: ["issue_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_urgent",
      description:
        "Mark this call as URGENT. Use when the customer describes an emergency (water leak, electrical sparking, gas smell, no power in whole house, sewage backup, burst pipe). The boss will be called back within 5-15 minutes.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why this is urgent (e.g. 'water everywhere', 'gas smell')",
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_uncertain",
      description:
        "Mark this call as needing a callback. Use when the customer wants to talk to a person, you don't understand them, the issue is outside our price list, or anything else requires the boss's input.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why the boss needs to follow up",
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_call",
      description:
        "End the call with a specific outcome. This tells the system the call is done and what the decision was. ALWAYS call this to formally end the call — do not rely on free-text goodbyes.",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            enum: ["accepted", "urgent", "unsure", "rejected"],
            description:
              "accepted=we'll send someone, urgent=immediate callback, unsure=boss follow-up, rejected=out of scope",
          },
          summary: {
            type: "string",
            description: "One-sentence summary of the call for the boss's records",
          },
        },
        required: ["outcome", "summary"],
      },
    },
  },
];

console.log(`✓ System prompt: ${finalPrompt.length} chars`);
console.log(`✓ Tools: ${TOOLS.length}`);

// PATCH with FULL model object (Vapi replaces, not merges)
const body = JSON.stringify({
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    maxTokens: 500,
    systemPrompt: finalPrompt,
    tools: TOOLS,
  },
  // Texas-friendly opening — Alex's own voice, not a robot script
  firstMessage:
    "Hey, this is Alex over at Handy Works Home Services. This call may be recorded for quality. What can I help you with today?",
  // Remove auto end-call phrases — the AI must use the end_call tool instead
  endCallPhrases: [],
});

const req = https.request(
  {
    hostname: "api.vapi.ai",
    path: "/assistant/" + ASSISTANT_ID,
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const a = JSON.parse(data);
        console.log(`\n✓ Vapi assistant updated`);
        console.log(`  System prompt: ${a.model?.systemPrompt?.length || 0} chars`);
        console.log(`  Tools:         ${a.model?.tools?.length || 0}`);
        console.log(`  endCallPhrases: ${JSON.stringify(a.endCallPhrases || [])}`);
      } else {
        console.error(`\n✗ Failed: ${res.statusCode}`);
        console.error(data);
        process.exit(1);
      }
    });
  },
);
req.on("error", (e) => console.error("✗", e.message));
req.write(body);
req.end();
