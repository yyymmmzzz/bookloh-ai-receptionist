#!/usr/bin/env node
/**
 * create-vapi-assistant-my.js
 *
 * CREATE (POST) a new Vapi assistant for H-Master Bintulu (MY).
 * Use this once to create the assistant. After creation, the new ID
 * is saved to .env.local as VAPI_MY_ASSISTANT_ID and to the boss
 * row in Supabase.
 *
 * Idempotent: if the assistant already exists (env VAPI_MY_ASSISTANT_ID
 * set), this script will PATCH it instead. Re-run safely.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

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

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vapi", "assistant-my.json"), "utf-8"),
);

const sysPromptPath = path.join(__dirname, "..", "vapi", "system-prompt-my.md");
const md = fs.readFileSync(sysPromptPath, "utf-8");
const codeBlocks = [...md.matchAll(/```\n([\s\S]+?)\n```/g)].map((m) => m[1]);
if (codeBlocks.length === 0) {
  console.error("✗ Could not find code-fenced prompt block in system-prompt-my.md");
  process.exit(1);
}
cfg.model.systemPrompt = codeBlocks.reduce((a, b) => (b.length > a.length ? b : a), "");

const existingAssistantId = process.env.VAPI_MY_ASSISTANT_ID;
const method = existingAssistantId ? "PATCH" : "POST";
const path2 = existingAssistantId
  ? `/assistant/${existingAssistantId}`
  : "/assistant";

console.log(`→ ${method} https://api.vapi.ai${path2}`);
console.log(`  name: ${cfg.name}`);
console.log(`  model: ${cfg.model.provider}/${cfg.model.model}`);
console.log(`  tools: ${cfg.tools.length}`);
console.log(`  systemPrompt: ${cfg.model.systemPrompt.length} chars`);

const body = JSON.stringify({
  name: cfg.name,
  model: {
    provider: cfg.model.provider,
    model: cfg.model.model,
    temperature: cfg.model.temperature,
    maxTokens: cfg.model.maxTokens,
    systemPrompt: cfg.model.systemPrompt,
    tools: cfg.tools,
  },
  voice: cfg.voice,
  firstMessage: cfg.firstMessage,
  endCallPhrases: cfg.endCallPhrases || [],
  endCallFunctionEnabled: cfg.endCallFunctionEnabled !== false,
  silenceTimeoutSeconds: cfg.silenceTimeoutSeconds,
  responseDelaySeconds: cfg.responseDelaySeconds,
  llmRequestDelaySeconds: cfg.llmRequestDelaySeconds,
  maxDurationSeconds: cfg.maxDurationSeconds,
  serverUrl: cfg.serverUrl,
  serverUrlSecret: process.env.WEBHOOK_SECRET || cfg.serverUrlSecret,
});

const req = https.request(
  {
    hostname: "api.vapi.ai",
    path: path2,
    method,
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
        console.log(`\n✓ Vapi MY assistant ${method === "POST" ? "created" : "updated"}`);
        console.log(`  ID: ${a.id}`);
        console.log(`  Name: ${a.name}`);
        console.log(`  Model: ${a.model?.provider}/${a.model?.model}`);
        console.log(`  Tools: ${a.model?.tools?.length}`);
        if (method === "POST") {
          console.log(`\n  → Add to .env.local:`);
          console.log(`  VAPI_MY_ASSISTANT_ID=${a.id}`);
          console.log(`\n  → Update H-Master boss row in Supabase:`);
          console.log(`  PATCH bosses SET vapi_assistant_id='${a.id}' WHERE id='855835b7-833e-4a2c-a173-db774ef20a2f'`);
        }
      } else {
        console.error(`\n✗ Vapi API error ${res.statusCode}`);
        console.error(data.slice(0, 1000));
        process.exit(1);
      }
    });
  },
);
req.on("error", (e) => console.error("✗", e.message));
req.write(body);
req.end();
