#!/usr/bin/env node
/**
 * create-vapi-assistant.js
 *
 * Creates the Bookloh AI Receptionist assistant in Vapi via the API.
 * Reads the system prompt from vapi/system-prompt.md and creates the
 * full assistant with all 5 function-call tools in one shot.
 *
 * Usage:
 *   VAPI_API_KEY=xxx node scripts/create-vapi-assistant.js
 *
 * After running, the assistant ID is written back to .env.local.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// Load .env.local manually (no dotenv dep)
function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
loadEnvLocal();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
if (!VAPI_API_KEY) {
  console.error("✗ VAPI_API_KEY not set. Set it in .env.local or pass as env var.");
  process.exit(1);
}

// 1. Read the system prompt from vapi/system-prompt.md
const promptPath = path.join(__dirname, "..", "vapi", "system-prompt.md");
const promptMd = fs.readFileSync(promptPath, "utf-8");
const match = promptMd.match(/## Full System Prompt[\s\S]*?```\n([\s\S]*?)\n```/);
if (!match) {
  console.error("✗ Could not find '## Full System Prompt' block in", promptPath);
  process.exit(1);
}
const systemPrompt = match[1].trim();
console.log(`✓ Loaded system prompt (${systemPrompt.length} chars)`);

// Tool definitions
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
        "Get a reference price range for a known issue type. Returns null if we don't have a price band for this issue type.",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            enum: ["plumbing", "electrical", "hvac", "handyman", "roofing", "general"],
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
        "End the call with a specific outcome. This tells the system the call is done and what the decision was.",
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

// 2. Build the assistant config (tools nested in model)
const assistant = {
  name: "Bookloh AI Receptionist — Handy Works",
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    maxTokens: 500,
    systemPrompt: systemPrompt,
    tools: TOOLS,
  },
  voice: {
    provider: "openai",
    voiceId: "alloy",
  },
  firstMessage:
    "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?",
  endCallFunctionEnabled: true,
  endCallPhrases: ["goodbye", "have a good day", "thanks bye", "have a great day"],
  silenceTimeoutSeconds: 30,
  responseDelaySeconds: 0.3,
  maxDurationSeconds: 600,
};

// 3. POST to Vapi
const data = JSON.stringify(assistant);

const req = https.request(
  {
    hostname: "api.vapi.ai",
    path: "/assistant",
    method: "POST",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    },
  },
  (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const result = JSON.parse(body);
        console.log(`✓ Assistant created`);
        console.log(`  ID:     ${result.id}`);
        console.log(`  Name:   ${result.name}`);
        console.log(`  Model:  ${result.model?.model} (temp ${result.model?.temperature})`);
        console.log(`  Voice:  ${result.voice?.voiceId}`);
        console.log(`  Tools:  ${result.model?.tools?.length || 0}`);
        writeAssistantId(result.id);
        console.log(`\n✓ Assistant ID written to .env.local`);
      } else {
        console.error(`✗ Vapi API error ${res.statusCode}:`);
        console.error(body);
        process.exit(1);
      }
    });
  },
);

req.on("error", (err) => {
  console.error("✗ Request failed:", err.message);
  process.exit(1);
});

req.write(data);
req.end();

function writeAssistantId(id) {
  const envPath = path.join(__dirname, "..", ".env.local");
  let content = fs.readFileSync(envPath, "utf-8");
  content = content.replace(/^VAPI_ASSISTANT_ID=.*$/m, `VAPI_ASSISTANT_ID=${id}`);
  fs.writeFileSync(envPath, content);
}
