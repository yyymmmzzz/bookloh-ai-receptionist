#!/usr/bin/env node
/**
 * update-vapi-assistant-my.js
 *
 * PATCH Vapi Malaysia assistant (uses vapi/assistant-my.json). Re-runnable.
 *
 * Before running:
 *   1. Record a Malaysian English/Manglish speaker (1-2 min clean audio)
 *   2. Upload to ElevenLabs Instant Voice Cloning → get voice_id
 *   3. Replace <MY_VOICE_ID_FROM_ELEVENLABS_CLONE> in vapi/assistant-my.json
 *   4. Replace YOUR_DOMAIN and serverUrlSecret in the JSON
 *   5. Then: node scripts/update-vapi-assistant-my.js
 *
 * The script is idempotent — re-running updates the same assistant.
 */

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const VAPI_API_KEY = process.env.VAPI_API_KEY;
if (!VAPI_API_KEY) {
  console.error("✗ Missing VAPI_API_KEY in .env.local");
  process.exit(1);
}

const https = require("https");

const json = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vapi", "assistant-my.json"), "utf-8"),
);

// Refuse to send with placeholder values
function checkPlaceholders(obj, path = "") {
  for (const [k, v] of Object.entries(obj)) {
    const full = `${path}.${k}`;
    if (typeof v === "string" && (v.includes("<<") || v.includes("YOUR_DOMAIN") || v.includes("MY_VOICE_ID_FROM_ELEVENLABS_CLONE"))) {
      throw new Error(`Placeholder not filled: ${full} = ${v}`);
    }
    if (typeof v === "object" && v !== null) {
      checkPlaceholders(v, full);
    }
  }
}
try {
  checkPlaceholders(json);
} catch (e) {
  console.error(`✗ ${e.message}`);
  console.error("  → Fill in placeholders in vapi/assistant-my.json (voiceId, serverUrl, serverUrlSecret)");
  process.exit(1);
}

// Read the system prompt markdown and inject into the JSON
const sysPromptPath = path.join(__dirname, "..", "vapi", "system-prompt-my.md");
const md = fs.readFileSync(sysPromptPath, "utf-8");
const match = md.match(/```\n([\s\S]+?)\n```/);
if (!match) {
  console.error("✗ Could not find code-fenced prompt block in system-prompt-my.md");
  process.exit(1);
}
json.model.systemPrompt = match[1];

const body = JSON.stringify(json);

const url = process.env.VAPI_MY_ASSISTANT_ID
  ? `https://api.vapi.ai/assistant/${process.env.VAPI_MY_ASSISTANT_ID}`
  : "https://api.vapi.ai/assistant";

const method = process.env.VAPI_MY_ASSISTANT_ID ? "PATCH" : "POST";

console.log(`→ ${method} ${url}`);
console.log(`  name: ${json.name}`);
console.log(`  voice: ${json.voice.provider}/${json.voice.voiceId} (model ${json.voice.model})`);
console.log(`  transcriptionProvider: ${json.transcriptionProvider}`);
console.log(`  systemPrompt: ${json.model.systemPrompt.length} chars`);

const req = https.request(
  url,
  {
    method,
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const a = JSON.parse(d);
        console.log(`✓ ${method === "POST" ? "Created" : "Updated"} Malaysia assistant`);
        console.log(`  ID: ${a.id}`);
        console.log(`  Name: ${a.name}`);
        console.log(`  Voice: ${a.voice?.provider}/${a.voice?.voiceId}/${a.voice?.model}`);
        console.log(`  Transcription: ${a.transcriptionProvider}`);
        if (method === "POST") {
          console.log(`\n  → Add this to .env.local:`);
          console.log(`  VAPI_MY_ASSISTANT_ID=${a.id}`);
        }
      } else {
        console.error(`✗ Vapi API error ${res.statusCode}`);
        console.error(d.slice(0, 1000));
        process.exit(1);
      }
    });
  },
);
req.on("error", (e) => console.error("✗", e.message));
req.write(body);
req.end();
