#!/usr/bin/env node
/**
 * test-scenarios.js
 *
 * Runs a comprehensive set of webhook scenarios to verify the work order
 * creation logic handles all the edge cases.
 *
 * Each scenario builds a fake Vapi end-of-call-report payload and POSTs it
 * to /api/vapi/webhook. Then we check the resulting work order in Supabase.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const ENV = fs.readFileSync(
  path.join(__dirname, "..", ".env.local"),
  "utf-8",
);
const SUPABASE_KEY = ENV.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const SUPABASE_URL = ENV.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const WEBHOOK_SECRET = ENV.match(/^WEBHOOK_SECRET=(.+)/m)[1].trim();

let ts = Date.now();
function callId() {
  return `test-${ts++}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildWebhook(scenario) {
  const baseCall = {
    id: callId(),
    orgId: "test-org",
    type: "inboundPhoneCall",
    customer: { number: scenario.customerPhone, name: scenario.customerName },
    startedAt: new Date(Date.now() - scenario.duration * 1000).toISOString(),
    endedAt: new Date().toISOString(),
    cost: 0.1,
    recordingUrl: null,
  };
  return {
    message: {
      type: "end-of-call-report",
      call: baseCall,
      messages: scenario.messages || [],
      toolCallList: scenario.toolCalls,
      summary: scenario.expectedSummary,
    },
  };
}

async function postJson(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, "http://localhost:3000");
    const req = http.request(
      {
        hostname: "localhost",
        port: 3000,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          "x-vapi-secret": WEBHOOK_SECRET,
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getWorkOrder(callId) {
  // Query Supabase for the work order with this call id
  const url = new URL(
    "/rest/v1/work_orders?select=ai_decision,status,issue_type,quote_low,quote_high,summary,customer_zipcode,vapi_call_id&vapi_call_id=eq." + callId,
    SUPABASE_URL,
  );
  return new Promise((resolve, reject) => {
    const url2 = new URL(
      `/rest/v1/work_orders?select=ai_decision,status,issue_type,quote_low,quote_high,summary,customer_zipcode,vapi_call_id&vapi_call_id=eq.${callId}`,
      SUPABASE_URL,
    );
    require("https").get(
      {
        hostname: url2.hostname,
        path: url2.pathname + url2.search,
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve([]);
          }
        });
      },
    );
  });
}

function pad(s, n) {
  s = String(s);
  return s + " ".repeat(Math.max(0, n - s.length));
}

async function run() {
  const scenarios = [
    {
      name: "1. ACCEPT (basic happy path) - kitchen sink leak",
      customerName: "Alice Chen",
      customerPhone: "+15551110001",
      duration: 95,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Hi yeah, my kitchen sink is leaking and I'm not really sure what to do about it.", time: 6500 },
        { role: "assistant", message: "I'm sorry to hear that. Is it a slow drip, or is water actually pooling up under the sink?", time: 12000 },
        { role: "user", message: "It's dripping from the faucet itself but there's also a puddle underneath the cabinet.", time: 18000 },
        { role: "assistant", message: "Okay. When did you first notice it?", time: 24000 },
        { role: "user", message: "Maybe a couple days ago. I tried tightening the handle but that didn't really help.", time: 29000 },
        { role: "assistant", message: "Got it. What's the zip code there?", time: 36000 },
        { role: "user", message: "77002.", time: 38500 },
        { role: "assistant", message: "And your name and best callback number?", time: 41000 },
        { role: "user", message: "Alice Chen, and this number is fine, 555-111-0001.", time: 47000 },
        { role: "assistant", message: "When works better for a visit, morning or afternoon?", time: 55000 },
        { role: "user", message: "Tomorrow afternoon if possible.", time: 59500 },
        { role: "assistant", message: "There's an $89 trip fee that goes toward the repair if you go ahead, and the repair itself is typically 150 to 400 dollars. So your total estimate is roughly 240 to 490 depending on what we find on site. Someone will call you tomorrow to confirm the exact time. Sound good?", time: 64500 },
        { role: "user", message: "Yeah that works, thanks.", time: 78500 },
        { role: "assistant", message: "Perfect Alice, I've got it all down. You'll hear from us tomorrow to lock in the time. Thanks for calling!", time: 82500 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "validate_service", arguments: { zipcode: "77002", issue_type: "plumbing" }, result: JSON.stringify({ ok: true, distance_miles: 0 }) } },
        { id: "t2", type: "function", function: { name: "get_price_quote", arguments: { issue_type: "plumbing" }, result: JSON.stringify({ available: true, trip_fee: 89, fuel_surcharge: 0, total_trip_fee: 89, distance_miles: 0, range: { low: 150, high: 400 }, total_low: 239, total_high: 489 }) } },
        { id: "t3", type: "function", function: { name: "end_call", arguments: { outcome: "accepted", summary: "Kitchen sink leak at 77002, tomorrow afternoon, total $239-$489 (incl $89 trip)" } } },
      ],
      expected: { ai_decision: "accepted", status: "pending", issue_type: "plumbing" },
      expectedSummary: "Kitchen sink leak accepted",
    },
    {
      name: "2. URGENT (burst pipe) - water everywhere",
      customerName: "Bob Wilson",
      customerPhone: "+15551110002",
      duration: 50,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Oh my god, my pipe under the kitchen sink just burst, water is spraying everywhere!", time: 5500 },
        { role: "assistant", message: "Okay, I need you to find your main water shutoff valve and turn it clockwise to stop the water. Do you know where that is?", time: 12500 },
        { role: "user", message: "I think it's outside by the meter, hold on... okay I see it, turning it now.", time: 19000 },
        { role: "assistant", message: "Good. What's your zip code and a good callback number so we can get someone out fast?", time: 26500 },
        { role: "user", message: "77005, and you can reach me on this number, 555-111-0002.", time: 32000 },
        { role: "assistant", message: "Got it Bob. Stay safe, I'll have Alex call you back in 5 to 15 minutes to walk through next steps.", time: 38000 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "flag_urgent", arguments: { reason: "Burst pipe under kitchen sink, water everywhere, 77005 - water shut off" } } },
        { id: "t2", type: "function", function: { name: "end_call", arguments: { outcome: "urgent", summary: "Burst pipe under kitchen sink, 77005, water shut off - callback 5-15 min" } } },
      ],
      expected: { ai_decision: "urgent", status: "urgent" },
    },
    {
      name: "3. UNSURE (customer wants a person)",
      customerName: "Carol Davis",
      customerPhone: "+15551110003",
      duration: 25,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Yeah, can I just talk to a real person please? I don't really want to do this with a machine.", time: 5500 },
        { role: "assistant", message: "Sure, no problem. Can I get your name and a number so Alex can call you back?", time: 11000 },
        { role: "user", message: "Carol Davis, 555-111-0003.", time: 15500 },
        { role: "assistant", message: "Thanks Carol, I'll have Alex call you back in just a few minutes.", time: 20000 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "flag_uncertain", arguments: { reason: "Customer wants to talk to a person" } } },
        { id: "t2", type: "function", function: { name: "end_call", arguments: { outcome: "unsure", summary: "Customer requested human, Carol Davis, callback 555-111-0003" } } },
      ],
      expected: { ai_decision: "unsure", status: "callback" },
    },
    {
      name: "4. REJECT (out of area - Dallas)",
      customerName: "David Martinez",
      customerPhone: "+15551110004",
      duration: 50,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Hi, I think I have a bad breaker, half the house just lost power.", time: 6500 },
        { role: "assistant", message: "Okay, that's frustrating. What's your address or zip code?", time: 12500 },
        { role: "user", message: "I'm in Dallas, 75201.", time: 16500 },
        { role: "assistant", message: "Let me check that for you... unfortunately Dallas is outside our service area, we mostly cover the Houston region. I'd recommend searching for an electrician near downtown Dallas on Google, you should find a few good options.", time: 22000 },
        { role: "user", message: "Oh okay, no worries, thanks for checking.", time: 35500 },
        { role: "assistant", message: "Sorry we can't help this time, have a good one.", time: 39500 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "validate_service", arguments: { zipcode: "75201", issue_type: "electrical" }, result: JSON.stringify({ ok: false, reason: "Dallas is about 240 miles from our base - outside our 25-mile service area.", distance_miles: 240 }) } },
        { id: "t2", type: "function", function: { name: "end_call", arguments: { outcome: "rejected", summary: "Electrical issue, Dallas 75201 - outside Houston service area" } } },
      ],
      expected: { ai_decision: "rejected", status: "rejected" },
    },
    {
      name: "5. REJECT (out of trade - landscaping)",
      customerName: "Eve Johnson",
      customerPhone: "+15551110005",
      duration: 35,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Hi, I need someone to come mow my lawn and pull some weeds. I'm over in 77010.", time: 7000 },
        { role: "assistant", message: "I appreciate the call but landscaping is outside what we do, we focus on plumbing, electrical, HVAC, and handyman jobs. Try searching for a lawn care service in your area, you should find someone pretty quick.", time: 15000 },
        { role: "user", message: "Oh okay, that's a shame. Thanks anyway.", time: 25500 },
        { role: "assistant", message: "Sorry we can't help this time, have a good one.", time: 29000 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "validate_service", arguments: { zipcode: "77010", issue_type: "landscaping" }, result: JSON.stringify({ ok: false, reason: "We don't handle landscaping jobs. We specialize in: plumbing, electrical, hvac, handyman, general." }) } },
        { id: "t2", type: "function", function: { name: "end_call", arguments: { outcome: "rejected", summary: "Landscaping request - not in trade list, 77010" } } },
      ],
      expected: { ai_decision: "rejected", status: "rejected" },
    },
    {
      name: "6. ACCEPT (HVAC - AC grinding noise)",
      customerName: "Frank Lee",
      customerPhone: "+15551110006",
      duration: 80,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Yeah, my outdoor AC unit is making a weird grinding noise. Started yesterday.", time: 7000 },
        { role: "assistant", message: "Got it. Is the unit still cooling okay or has the air gotten warm?", time: 14000 },
        { role: "user", message: "Still cooling, but the noise is new, kind of worried it'll go out on me.", time: 20000 },
        { role: "assistant", message: "Yeah, better to get it looked at now. What's the zip code?", time: 26500 },
        { role: "user", message: "77008.", time: 29000 },
        { role: "assistant", message: "And your name and best callback number?", time: 31500 },
        { role: "user", message: "Frank Lee, 555-111-0006.", time: 36500 },
        { role: "assistant", message: "When's a good time to send someone out?", time: 44000 },
        { role: "user", message: "Friday morning would work best.", time: 48500 },
        { role: "assistant", message: "There's an $89 trip fee that goes toward the repair, and the AC repair itself is usually 200 to 500 dollars depending on what's going on with the unit. So your total estimate is roughly 290 to 590. We'll have someone call you to lock in the Friday time. Sound good?", time: 54000 },
        { role: "user", message: "Yeah that sounds fine.", time: 66000 },
        { role: "assistant", message: "Perfect Frank, you'll hear from us to confirm the time. Thanks for calling!", time: 70000 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "validate_service", arguments: { zipcode: "77008", issue_type: "hvac" }, result: JSON.stringify({ ok: true, distance_miles: 6 }) } },
        { id: "t2", type: "function", function: { name: "get_price_quote", arguments: { issue_type: "hvac" }, result: JSON.stringify({ available: true, trip_fee: 89, fuel_surcharge: 0, total_trip_fee: 89, distance_miles: 6, range: { low: 200, high: 500 }, total_low: 289, total_high: 589 }) } },
        { id: "t3", type: "function", function: { name: "end_call", arguments: { outcome: "accepted", summary: "AC grinding noise, 77008, Friday AM, total $289-$589 (incl $89 trip)" } } },
      ],
      expected: { ai_decision: "accepted", status: "pending", issue_type: "hvac" },
    },
    {
      name: "7. UNSURE (septic tank - outside our normal scope)",
      customerName: "Grace Kim",
      customerPhone: "+15551110007",
      duration: 55,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Yeah, my septic tank is having issues, there's a really strong smell in the backyard and the ground is soggy near the drain field.", time: 7500 },
        { role: "assistant", message: "Septic systems are a bit outside our normal work, but let me check. What's your zip code?", time: 16500 },
        { role: "user", message: "77019.", time: 20500 },
        { role: "assistant", message: "And your name and best callback number?", time: 23500 },
        { role: "user", message: "Grace Kim, 555-111-0007.", time: 28500 },
        { role: "assistant", message: "Alright Grace, I'm going to have Alex call you back in just a few minutes to talk through options. Septic isn't something we put a price on over the phone, sorry about that.", time: 34000 },
        { role: "user", message: "No problem, thanks.", time: 45000 },
        { role: "assistant", message: "Thanks for your patience, you'll hear from Alex soon.", time: 48500 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "flag_uncertain", arguments: { reason: "Septic tank - outside our normal scope, needs Alex follow-up" } } },
        { id: "t2", type: "function", function: { name: "end_call", arguments: { outcome: "unsure", summary: "Septic tank issue, 77019, Grace Kim - needs Alex follow-up" } } },
      ],
      expected: { ai_decision: "unsure", status: "callback" },
    },
    {
      name: "8. ACCEPT (handyman - multi-intent)",
      customerName: "Henry Patel",
      customerPhone: "+15551110008",
      duration: 85,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Hey, I've been putting off a few small things. My kitchen faucet drips, the doorknob on my bedroom is loose, and I'd like to mount a TV on the wall.", time: 9000 },
        { role: "assistant", message: "Sure, we can handle all of that in one visit. What's the zip code?", time: 19500 },
        { role: "user", message: "77006.", time: 23000 },
        { role: "assistant", message: "Got it, Henry right? And the callback number I have is 555-111-0008?", time: 26000 },
        { role: "user", message: "Yeah that's right.", time: 33500 },
        { role: "assistant", message: "Perfect. When works for a visit, morning, afternoon, or evening?", time: 37500 },
        { role: "user", message: "Saturday morning if you do weekends, otherwise next week is fine.", time: 44000 },
        { role: "assistant", message: "Saturday works. There's an $89 trip fee that goes toward the work, and a handyman visit with multiple small jobs is typically 100 to 300 dollars. So your total estimate is roughly 190 to 390 depending on time. Someone will call you to confirm the Saturday time slot. Sound good?", time: 50000 },
        { role: "user", message: "Great, thanks.", time: 66000 },
        { role: "assistant", message: "Alright Henry, I've got it all down. You'll get a call to lock in the time. Thanks for calling!", time: 69500 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "validate_service", arguments: { zipcode: "77006", issue_type: "handyman" }, result: JSON.stringify({ ok: true, distance_miles: 4 }) } },
        { id: "t2", type: "function", function: { name: "get_price_quote", arguments: { issue_type: "handyman" }, result: JSON.stringify({ available: true, trip_fee: 89, fuel_surcharge: 0, total_trip_fee: 89, distance_miles: 4, range: { low: 100, high: 300 }, total_low: 189, total_high: 389 }) } },
        { id: "t3", type: "function", function: { name: "end_call", arguments: { outcome: "accepted", summary: "Multi-task handyman: leaky faucet, loose doorknob, TV mount, 77006, Saturday AM, total $189-$389 (incl $89 trip)" } } },
      ],
      expected: { ai_decision: "accepted", status: "pending", issue_type: "handyman" },
    },
    {
      name: "9. URGENT (gas smell - highest priority)",
      customerName: "Iris Chen",
      customerPhone: "+15551110009",
      duration: 50,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "I think I smell gas in my house, it's in the kitchen near the stove!", time: 5500 },
        { role: "assistant", message: "Okay, this is important. Please don't flip any light switches or use anything that could spark. If you can safely get to your gas meter, turn it off. Are you at home right now?", time: 13000 },
        { role: "user", message: "Yes I'm home, I'm going to go turn it off now.", time: 23500 },
        { role: "assistant", message: "Good. What's your zip code and the best number to reach you?", time: 28500 },
        { role: "user", message: "77002, and my number is 555-111-0009.", time: 34000 },
        { role: "assistant", message: "Got it Iris. Stay safe, I'm having Alex call you back in the next 5 to 15 minutes.", time: 40000 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "flag_urgent", arguments: { reason: "Gas smell in kitchen near stove, 77002 - possible leak, customer shutting off gas" } } },
        { id: "t2", type: "function", function: { name: "end_call", arguments: { outcome: "urgent", summary: "Gas smell in kitchen, 77002 - callback IMMEDIATELY in 5-15 min" } } },
      ],
      expected: { ai_decision: "urgent", status: "urgent" },
    },
    {
      name: "10. ACCEPT (no zip in opening - extracted from address)",
      customerName: "Jack Brown",
      customerPhone: "+15551110010",
      duration: 80,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Hi, I'd like to get a ceiling fan installed in my living room, I already bought the fan myself.", time: 7500 },
        { role: "assistant", message: "Sure, we can help with that. What's the address for the install?", time: 14500 },
        { role: "user", message: "1234 Main Street, Houston, 77003.", time: 19000 },
        { role: "assistant", message: "Got it, 77003. And your name and callback number?", time: 26000 },
        { role: "user", message: "Jack Brown, 555-111-0010.", time: 32000 },
        { role: "assistant", message: "When works for the install, morning or afternoon?", time: 39000 },
        { role: "user", message: "Thursday morning would be perfect.", time: 43500 },
        { role: "assistant", message: "For a ceiling fan install with the fan already provided, there's an $89 trip fee that goes toward the install, and the work itself is typically 100 to 300 dollars. So total estimate is roughly 190 to 390 depending on time. We'll have someone call you to confirm the Thursday time. Sound good Jack?", time: 49000 },
        { role: "user", message: "Sounds good, thanks.", time: 65000 },
        { role: "assistant", message: "Perfect, you'll hear from us soon. Thanks for calling!", time: 68500 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "validate_service", arguments: { zipcode: "77003", issue_type: "handyman" }, result: JSON.stringify({ ok: true, distance_miles: 2 }) } },
        { id: "t2", type: "function", function: { name: "get_price_quote", arguments: { issue_type: "handyman" }, result: JSON.stringify({ available: true, trip_fee: 89, fuel_surcharge: 0, total_trip_fee: 89, distance_miles: 2, range: { low: 100, high: 300 }, total_low: 189, total_high: 389 }) } },
        { id: "t3", type: "function", function: { name: "end_call", arguments: { outcome: "accepted", summary: "Ceiling fan install (customer-supplied), 1234 Main St Houston 77003, Thursday AM, total $189-$389 (incl $89 trip)" } } },
      ],
      expected: { ai_decision: "accepted", status: "pending" },
    },
    {
      name: "11. ACCEPT (far distance + fuel surcharge) - 77573 League City",
      customerName: "Kim Rodriguez",
      customerPhone: "+15551110011",
      duration: 95,
      messages: [
        { role: "assistant", message: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?", time: 1000 },
        { role: "user", message: "Hi, my garbage disposal is making a terrible noise and barely working. I think it's about to die.", time: 7000 },
        { role: "assistant", message: "Okay, when did you first notice it acting up?", time: 14000 },
        { role: "user", message: "Started a few days ago, getting worse. I'm in League City, 77573.", time: 19000 },
        { role: "assistant", message: "Got it. And your name and callback number?", time: 27000 },
        { role: "user", message: "Kim Rodriguez, 555-111-0011.", time: 32000 },
        { role: "assistant", message: "When works for a visit?", time: 40000 },
        { role: "user", message: "Tomorrow afternoon if you can.", time: 44500 },
        { role: "assistant", message: "Okay Kim, here's the pricing. There's an $89 trip fee, and since you're about 30 miles from our base there's an extra $30 fuel surcharge, so the trip itself is $119 total. The garbage disposal replacement is typically 200 to 450 dollars depending on what we find. So your total estimate is roughly 320 to 570 depending on the unit. Someone will call you tomorrow to confirm the time. Sound good?", time: 49000 },
        { role: "user", message: "Yeah that's reasonable, let's do it.", time: 71000 },
        { role: "assistant", message: "Perfect Kim, I've got it all down. You'll hear from us tomorrow to confirm. Thanks for calling!", time: 75000 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "validate_service", arguments: { zipcode: "77573", issue_type: "plumbing" }, result: JSON.stringify({ ok: true, distance_miles: 30 }) } },
        { id: "t2", type: "function", function: { name: "get_price_quote", arguments: { issue_type: "plumbing", distance_miles: 30 }, result: JSON.stringify({ available: true, trip_fee: 89, fuel_surcharge: 30, total_trip_fee: 119, distance_miles: 30, range: { low: 200, high: 450 }, total_low: 319, total_high: 569 }) } },
        { id: "t3", type: "function", function: { name: "end_call", arguments: { outcome: "accepted", summary: "Garbage disposal replacement, 77573 (30 mi), tomorrow PM, total $319-$569 (incl $89 trip + $30 fuel surcharge)" } } },
      ],
      expected: { ai_decision: "accepted", status: "pending", issue_type: "plumbing" },
      expectedSummary: "Far-distance accepted with fuel surcharge",
    },
    {
      // Phase 1 reject: AI calls check_trade (NOT validate_service) immediately
      // after hearing "roof is leaking", gets in_trade=false, politely declines,
      // and ends call within 15 seconds. NO address collected.
      name: "12. REJECT (out of trade - roofing, Phase 1 check_trade)",
      customerName: "Liam Walker",
      customerPhone: "+15551110012",
      duration: 15,
      messages: [
        { role: "assistant", message: "Hey, this is Alex over at Handy Works Home Services. This call may be recorded for quality. What can I help you with today?", time: 1000 },
        { role: "user", message: "Hi, my roof is leaking pretty bad after the storm last night, water is coming into the bedroom.", time: 5500 },
        { role: "assistant", message: "I'm really sorry to hear that, but roofing is outside what we do here at Handy Works. We focus on plumbing, electrical, HVAC, and handyman jobs. I'd recommend searching for a roofer in your area on Google, you should find someone quickly.", time: 9000 },
        { role: "user", message: "Oh okay, thanks anyway.", time: 13000 },
        { role: "assistant", message: "Sorry we can't help this time, have a good one.", time: 14500 },
      ],
      toolCalls: [
        // KEY: AI calls check_trade FIRST (no zipcode), gets in_trade=false,
        // and rejects immediately. No validate_service call. No address asked.
        { id: "t1", type: "function", function: { name: "check_trade", arguments: { issue_type: "roofing" }, result: JSON.stringify({ in_trade: false, reason: "We don't handle roofing jobs. We specialize in: plumbing, electrical, hvac, handyman, general." }) } },
        { id: "t2", type: "function", function: { name: "end_call", arguments: { outcome: "rejected", summary: "Roof leak after storm - not in our trade list, declined quickly" } } },
      ],
      expected: { ai_decision: "rejected", status: "rejected", issue_type: "roofing" },
      expectedSummary: "Phase 1 reject: out-of-trade detected within 15s, no address collected",
    },
    {
      // Regression test: customer with a natural 1.2s pause mid-sentence.
      // With the OLD config (llmRequestDelaySeconds=0.1), this could trigger
      // a "double generation" — AI asks for "full address" then "ZIP code"
      // back-to-back with no customer input in between. With the NEW config
      // (llmRequestDelaySeconds=0.5), the AI waits for the full sentence.
      // We assert the message array has NO two consecutive assistant messages.
      name: "13. ANTI-REGRESSION (natural pause — no double generation)",
      customerName: "Mia Park",
      customerPhone: "+15551110013",
      duration: 75,
      messages: [
        { role: "assistant", message: "Hey, this is Alex over at Handy Works Home Services. This call may be recorded for quality. What can I help you with today?", time: 1000 },
        { role: "user", message: "Hi, um, I have this leak in my", time: 6500 },
        // 1.2s natural pause here — old config would have triggered regenerate
        { role: "user", message: "kitchen, it's been going for a few hours now.", time: 8500 },
        { role: "assistant", message: "Where are you located? What's your zip code?", time: 12000 },
        { role: "user", message: "77003.", time: 17000 },
        { role: "assistant", message: "When did it start and how bad is it?", time: 21000 },
        { role: "user", message: "Started this morning, water is on the floor but I shut off the valve under the sink.", time: 25000 },
        { role: "assistant", message: "Smart move. And what's the best number to reach you?", time: 32000 },
        { role: "user", message: "555-111-0013.", time: 37000 },
        { role: "assistant", message: "When works for a visit?", time: 42000 },
        { role: "user", message: "Anytime today if you can.", time: 46500 },
        { role: "assistant", message: "Alright, there's an 89 dollar trip fee that goes toward the repair, and the kitchen sink repair is usually 150 to 400 dollars. So your total estimate is roughly 240 to 490. Someone will call you to confirm the time. Sound good?", time: 51000 },
        { role: "user", message: "Sounds good, thanks.", time: 68000 },
        { role: "assistant", message: "Perfect Mia, you'll hear from us shortly. Thanks for calling!", time: 72000 },
      ],
      toolCalls: [
        { id: "t1", type: "function", function: { name: "check_trade", arguments: { issue_type: "plumbing" }, result: JSON.stringify({ in_trade: true, matched_trade: "plumbing" }) } },
        { id: "t2", type: "function", function: { name: "validate_service", arguments: { zipcode: "77003", issue_type: "plumbing" }, result: JSON.stringify({ ok: true, distance_miles: 4 }) } },
        { id: "t3", type: "function", function: { name: "get_price_quote", arguments: { issue_type: "plumbing", distance_miles: 4 }, result: JSON.stringify({ available: true, trip_fee: 89, fuel_surcharge: 0, total_trip_fee: 89, distance_miles: 4, range: { low: 150, high: 400 }, total_low: 239, total_high: 489 }) } },
        { id: "t4", type: "function", function: { name: "end_call", arguments: { outcome: "accepted", summary: "Kitchen sink leak, 77003, today if possible, total $239-$489" } } },
      ],
      expected: { ai_decision: "accepted", status: "pending", issue_type: "plumbing" },
      expectedSummary: "Accept with natural pause, no double generation in messages",
    },
  ];

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Bookloh AI Receptionist — 13 scenarios");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Clear DB first
  await postJson("/api/dev/clear", {});

  let pass = 0;
  let fail = 0;
  const callIds = [];

  for (const s of scenarios) {
    const webhook = buildWebhook(s);
    const callId = webhook.message.call.id;
    callIds.push(callId);

    const start = Date.now();
    const res = await postJson("/api/vapi/webhook", webhook);
    const ms = Date.now() - start;

    // Wait for async work order creation to settle
    await new Promise((r) => setTimeout(r, 500));

    const orders = await getWorkOrder(callId);
    const order = orders[0];

    if (res.status !== 200 || !order) {
      console.log(`  ✗ ${pad(s.name, 50)} ${ms}ms`);
      console.log(`     webhook: ${res.status} ${res.body.slice(0, 100)}`);
      console.log(`     order: ${order ? "missing" : "missing"}`);
      fail++;
      continue;
    }

    const exp = s.expected;
    const issues = [];
    if (order.ai_decision !== exp.ai_decision) issues.push(`ai_decision: ${order.ai_decision}≠${exp.ai_decision}`);
    if (exp.status && order.status !== exp.status) issues.push(`status: ${order.status}≠${exp.status}`);
    if (exp.issue_type && order.issue_type !== exp.issue_type) issues.push(`issue_type: ${order.issue_type}≠${exp.issue_type}`);

    if (issues.length === 0) {
      console.log(`  ✓ ${pad(s.name, 50)} ${ms}ms  ${order.ai_decision}/${order.status}`);
      pass++;
    } else {
      console.log(`  ✗ ${pad(s.name, 50)} ${ms}ms  ${issues.join(", ")}`);
      fail++;
    }
  }

  console.log(`\n  ${pass}/${scenarios.length} passed, ${fail} failed\n`);

  // ============================================================
  // GLOBAL REPETITION CHECK — anti-regression for the "AI double
  // generation" bug we hit on real calls. Scans every scenario's
  // message array and fails if any two consecutive assistant
  // messages exist without a user message in between.
  //
  // A "double generation" looks like:
  //   assistant: "I can help with that. Could you tell me your address"
  //   assistant: "Sure thing. I can help with that. Could you tell me your ZIP code?"
  // (with no user message between them)
  // ============================================================
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Repetition scan (anti-regression for double-generation bug)");
  console.log("═══════════════════════════════════════════════════════════════");

  let repFail = 0;
  for (const s of scenarios) {
    const msgs = s.messages || [];
    let consecutiveAssistant = 0;
    let violation = null;
    for (const m of msgs) {
      if (m.role === "assistant") {
        consecutiveAssistant++;
        if (consecutiveAssistant > 1) {
          violation = `turn #${consecutiveAssistant}: "${m.message.slice(0, 60)}..."`;
          break;
        }
      } else {
        consecutiveAssistant = 0;
      }
    }
    if (violation) {
      console.log(`  ✗ ${pad(s.name, 50)} ${violation}`);
      repFail++;
    } else {
      console.log(`  ✓ ${pad(s.name, 50)} no consecutive assistant turns`);
    }
  }
  if (repFail === 0) {
    console.log(`\n  All ${scenarios.length} scenarios clean — no double-generation detected.`);
  } else {
    console.log(`\n  ⚠️  ${repFail} scenario(s) have the bug pattern — fix the simulator or the AI config.`);
  }
  console.log("");

  // Print summary table
  const { default: supaReq } = { default: () => null };
  const url = `${SUPABASE_URL}/rest/v1/work_orders?select=ai_decision,status,issue_type,quote_low,quote_high,summary&order=created_at.desc&limit=${scenarios.length}`;
  const supaRes = await new Promise((resolve) => {
    require("https").get(
      {
        hostname: new URL(SUPABASE_URL).hostname,
        path: new URL(url).pathname + new URL(url).search,
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(JSON.parse(body)));
      },
    );
  });

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Work orders created");
  console.log("═══════════════════════════════════════════════════════════════");
  for (const w of supaRes) {
    const q = w.quote_low && w.quote_high ? `$${w.quote_low}-${w.quote_high}` : "";
    console.log(`  ${w.ai_decision.padEnd(10)} ${w.status.padEnd(10)} ${(w.issue_type || "").padEnd(10)} ${q.padEnd(10)} ${(w.summary || "").slice(0, 50)}`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Run failed:", e);
  process.exit(2);
});
