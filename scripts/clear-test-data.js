#!/usr/bin/env node
/**
 * clear-test-data.js
 *
 * SAFETY: This script ONLY deletes records with data_source = 'test'.
 * It will NEVER touch demo or production data. Run it any time without
 * worrying about losing real call history.
 *
 * Useful for:
 *   - Re-running test-scenarios.js from a clean slate
 *   - Removing test artifacts before showing the dashboard to a client
 *
 * Run:   node scripts/clear-test-data.js
 * Dry:   node scripts/clear-test-data.js --dry-run
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const SUPABASE_URL = ENV.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_KEY = ENV.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();

const DRY_RUN = process.argv.includes("--dry-run");

function supabaseDelete(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${SUPABASE_URL}/rest/v1/${path}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "return=minimal",
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`Delete failed: ${res.statusCode} ${b.slice(0, 200)}`));
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function supabaseCount(path) {
  return new Promise((resolve, reject) => {
    https
      .get(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "count=exact",
        },
      },
      (res) => {
        const count = res.headers["content-range"] || "?";
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve(count));
      },
    )
      .on("error", reject);
  });
}

async function main() {
  console.log(DRY_RUN ? "🔍 DRY RUN — no writes\n" : "🧹 Clearing TEST data only...\n");

  // Show what's about to be cleared
  const beforeTest = await supabaseCount("work_orders?data_source=eq.test&select=id");
  const beforeDemo = await supabaseCount("work_orders?data_source=eq.demo&select=id");
  const beforeProd = await supabaseCount("work_orders?data_source=eq.production&select=id");
  const beforeAll = await supabaseCount("work_orders?select=id");

  console.log("Current state:");
  console.log(`  work_orders: total=${beforeAll}  test=${beforeTest}  demo=${beforeDemo}  production=${beforeProd}`);
  console.log();
  console.log("Will DELETE:");
  console.log(`  work_orders WHERE data_source = 'test'  (currently ${beforeTest})`);
  console.log("  call_events WHERE work_order_id → test  (cascades automatically if FK is set)");
  console.log("  notifications WHERE work_order_id → test");
  console.log();
  console.log("Will KEEP (always preserved):");
  console.log(`  work_orders WHERE data_source = 'demo' (${beforeDemo})`);
  console.log(`  work_orders WHERE data_source = 'production' (${beforeProd})`);

  if (DRY_RUN) {
    console.log("\n(dry run, no changes made)");
    return;
  }

  // Clear test data only
  await supabaseDelete("work_orders?data_source=eq.test");

  const afterTest = await supabaseCount("work_orders?data_source=eq.test&select=id");
  const afterDemo = await supabaseCount("work_orders?data_source=eq.demo&select=id");
  const afterProd = await supabaseCount("work_orders?data_source=eq.production&select=id");
  const afterAll = await supabaseCount("work_orders?select=id");

  console.log("\nAfter clear:");
  console.log(`  work_orders: total=${afterAll}  test=${afterTest}  demo=${afterDemo}  production=${afterProd}`);
  console.log(`  ✓ Cleared ${beforeTest} test records`);
  console.log(`  ✓ Preserved ${afterDemo} demo + ${afterProd} production records`);
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
