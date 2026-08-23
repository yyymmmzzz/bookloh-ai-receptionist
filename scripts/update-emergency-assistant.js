#!/usr/bin/env node
/**
 * update-emergency-assistant.js
 *
 * PATCHes the Vapi emergency assistant (id from VAPI_EMERGENCY_ASSISTANT_ID)
 * to use the same Yimo voice clone as the main assistant. Re-runnable.
 *
 * Why this exists: create-emergency-assistant.js was written before we
 * had ElevenLabs wired up, so the original emergency assistant is still
 * on OpenAI alloy. This script catches it up.
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
const ASSISTANT_ID = process.env.VAPI_EMERGENCY_ASSISTANT_ID;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const ELEVENLABS_CREDENTIAL_ID = process.env.ELEVENLABS_CREDENTIAL_ID;

if (!VAPI_API_KEY) { console.error("✗ Missing VAPI_API_KEY"); process.exit(1); }
if (!ASSISTANT_ID) { console.error("✗ Missing VAPI_EMERGENCY_ASSISTANT_ID"); process.exit(1); }
if (!ELEVENLABS_VOICE_ID) { console.error("✗ Missing ELEVENLABS_VOICE_ID"); process.exit(1); }
if (!ELEVENLABS_CREDENTIAL_ID) { console.error("✗ Missing ELEVENLABS_CREDENTIAL_ID"); process.exit(1); }

const https = require("https");

const body = JSON.stringify({
  name: "HandyLine Emergency Caller - Alex",
  firstMessage: "Hey Alex, this is HandyLine with an urgent one.",
  voice: {
    provider: "11labs",
    voiceId: ELEVENLABS_VOICE_ID,
    model: "eleven_turbo_v2_5",
    stability: 0.5,
    similarityBoost: 0.75,
    useSpeakerBoost: true,
  },
  credentialIds: [ELEVENLABS_CREDENTIAL_ID],
});

const req = https.request(
  {
    hostname: "api.vapi.ai",
    path: `/assistant/${ASSISTANT_ID}`,
    method: "PATCH",
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
        console.log(`✓ Emergency assistant updated`);
        console.log(`  ID: ${a.id}`);
        console.log(`  Name: ${a.name}`);
        console.log(`  Voice: ${a.voice?.provider}/${a.voice?.voiceId}/${a.voice?.model}`);
        console.log(`  CredentialIds: ${(a.credentialIds || []).join(", ") || "(none)"}`);
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
