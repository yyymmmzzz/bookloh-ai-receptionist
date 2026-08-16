#!/usr/bin/env node
/**
 * create-emergency-assistant.js
 *
 * Creates a Vapi assistant specifically for calling the boss about urgent jobs.
 * This assistant is outbound-only - it dials the boss, briefs him on the urgent
 * call, and waits for his decision (call back now vs queue for later).
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
  console.error("✗ Missing VAPI_API_KEY");
  process.exit(1);
}

const https = require("https");

const systemPrompt = `You are the AI emergency-caller for Handy Works Home Services, a small home repair business in Houston, Texas.

Your job: call Alex, the owner, and tell him about an urgent customer call that just came in. Be SHORT, direct, and natural.

The customer info is available as variables you can use in your responses:
- {{customerName}} - the customer's name (might be empty if they didn't give one)
- {{customerPhone}} - the best callback number
- {{customerAddress}} - the service address
- {{issueType}} - the trade (plumbing/electrical/hvac/etc)
- {{issueDetails}} - short description of what's wrong

When Alex picks up:

1. Greet him like a coworker, not a robot. Say something like: "Hey Alex, this is Bookloh with an urgent one." or "Hey, Bookloh here, got an urgent call."
2. State the situation in 1-2 sentences: customer name, callback number, and what's broken.
3. Ask: "Want to call them back now, or should I just queue it for you?"
4. Wait for his answer.

If he says:
- "calling now" / "yes call them" / "I'll call" / "give me a sec" -> end_call with outcome="callback_initiated" and a short summary
- "queue it" / "no I'll call later" / "callback" / "later" -> end_call with outcome="queued"
- Anything unclear -> end_call with outcome="queued" (default to safe)

Keep the call under 30 seconds. Don't chat, don't ask follow-up questions. Just deliver the info and wait for his decision.

After end_call, the system will log Alex's response and update the work order. Do NOT call any other tools.`;

const firstMessage = "Hey Alex, this is Bookloh with an urgent one.";

const body = JSON.stringify({
  name: "Bookloh Emergency Caller - Alex",
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    maxTokens: 200,
    systemPrompt,
    tools: [
      {
        type: "function",
        function: {
          name: "end_call",
          description:
            "End the call with Alex. ALWAYS call this to formally end the call. Pick the outcome that matches his decision.",
          parameters: {
            type: "object",
            properties: {
              outcome: {
                type: "string",
                enum: ["callback_initiated", "queued"],
                description:
                  "callback_initiated if Alex said he will call the customer now; queued if he wants to call them later",
              },
              summary: {
                type: "string",
                description: "Short summary of what Alex decided",
              },
            },
            required: ["outcome", "summary"],
          },
        },
      },
    ],
  },
  voice: { provider: "openai", voiceId: "alloy" },
  firstMessage,
  endCallFunctionEnabled: true,
  endCallPhrases: ["thanks", "got it", "okay thanks", "alright", "gotcha", "sounds good"],
  maxDurationSeconds: 90,
  responseDelaySeconds: 0.3,
});

const req = https.request(
  {
    hostname: "api.vapi.ai",
    path: "/assistant",
    method: "POST",
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
        console.log(`✓ Emergency assistant created`);
        console.log(`  ID: ${a.id}`);
        console.log(`  Name: ${a.name}`);
        console.log(`  System prompt: ${a.model?.systemPrompt?.length || 0} chars`);
        console.log(`  First message: ${a.firstMessage}`);
      } else {
        console.error(`✗ Failed: ${res.statusCode}`);
        console.error(d.slice(0, 1000));
        process.exit(1);
      }
    });
  },
);
req.on("error", (e) => console.error("✗", e.message));
req.write(body);
req.end();
