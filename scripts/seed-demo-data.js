#!/usr/bin/env node
/**
 * seed-demo-data.js
 *
 * Seeds the work_orders table with realistic sample data for the Handy Works
 * demo. Used to populate the dashboard so clients see what the system looks
 * like with a full database (not just empty).
 *
 * All records are marked data_source = 'demo' so they can be filtered out
 * from real production data and from automated test scenarios.
 *
 * Distribution:
 *   - 5 trades × 4 decision states × 3-5 cases per cell
 *   - Houston zips for accepted (in area)
 *   - League City zip for the "far distance + fuel surcharge" variant
 *   - Dallas zip for the "out of area" rejected scenario
 *
 * Run: node scripts/seed-demo-data.js
 * Clear:  node scripts/clear-demo-data.js
 */

const fs = require("fs");
const path = require("path");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const SUPABASE_URL = ENV.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_KEY = ENV.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();

// Houston zips (in service area)
const HOUSTON_ZIPS = [
  "77002", "77003", "77005", "77006", "77008", "77010", "77019", "77025", "77030", "77036", "77055", "77057", "77063", "77077", "77084", "77096",
];

// League City / far zips (in area but triggers fuel surcharge)
const FAR_ZIPS = ["77573", "77511", "77539", "77565", "77590"];

// Out of area zips
const OUT_OF_AREA_ZIPS = ["75201", "75202", "75001", "78701"];

const HOUSTON_STREETS = [
  "1234 Main St", "5678 Westheimer Rd", "9012 Richmond Ave", "3456 Kirby Dr",
  "7890 Memorial Dr", "2345 Heights Blvd", "6789 Montrose Blvd", "4567 Bellaire Blvd",
  "8901 Bissonnet St", "2345 Fondren Rd", "6789 Gessner Rd", "1234 Dairy Ashford Rd",
  "5678 Antoine Dr", "9012 Bingle Rd", "3456 Campbell Rd", "7890 I-45 N",
];

// Realistic diverse Houston names
const CUSTOMER_NAMES = [
  "Maria Rodriguez", "James Walker", "Aisha Patel", "Carlos Mendoza", "Jennifer Chen",
  "Marcus Johnson", "Sofia Garcia", "David Kim", "Priya Singh", "Robert Williams",
  "Linda Nguyen", "Michael Brown", "Ana Lopez", "Thomas Lee", "Yuki Tanaka",
  "Hassan Ahmed", "Sarah Davis", "Diego Hernandez", "Mei Wong", "Brandon Carter",
  "Tatiana Petrov", "Olumide Adebayo", "Fatima Al-Sayed", "Wei Zhang", "Aaliyah Johnson",
  "Ricardo Silva", "Chloe Martin", "Jamal Robinson", "Isabella Russo", "Ethan Park",
  "Zara Khan", "Lucas Oliveira", "Amara Okonkwo", "Hiroshi Yamamoto", "Beatriz Costa",
  "Daniel O'Brien", "Anya Volkov", "Carlos Ramirez", "Maya Patel", "Jonas Berg",
];

// Houston area codes
const PHONE_PREFIXES = ["713", "281", "832", "346"];

function randomPhone() {
  const prefix = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
  const mid = String(Math.floor(100 + Math.random() * 900));
  const end = String(Math.floor(1000 + Math.random() * 9000));
  return `+1${prefix}${mid}${end}`;
}

function randomName() {
  return CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
}

function randomAddress(zip) {
  const num = Math.floor(100 + Math.random() * 9000);
  const street = HOUSTON_STREETS[Math.floor(Math.random() * HOUSTON_STREETS.length)];
  return `${num} ${street.split(" ").slice(1).join(" ")}, Houston, TX ${zip}`;
}

function randomCreatedAt(daysAgo) {
  // Random time within the last `daysAgo` days
  const now = Date.now();
  const past = now - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past)).toISOString();
}

// Price ranges by trade (low, high) — matches what's in the boss's price_list
const PRICE_RANGES = {
  plumbing: [150, 400],
  electrical: [150, 400],
  hvac: [200, 500],
  handyman: [100, 300],
  general: [100, 300],
};

const TRIP_FEE = 89;
const FREE_DISTANCE = 15;
const SURCHARGE_PER_MILE = 2;

function buildCase({ state, trade, zip, daysAgo, customer, far = false }) {
  const [low, high] = PRICE_RANGES[trade];
  let totalLow, totalHigh, distanceMiles, fuelSurcharge = 0, totalTripFee = TRIP_FEE;

  if (far) {
    distanceMiles = 25 + Math.floor(Math.random() * 15); // 25-40 mi
    const extra = distanceMiles - FREE_DISTANCE;
    fuelSurcharge = Math.round(extra * SURCHARGE_PER_MILE);
    totalTripFee = TRIP_FEE + fuelSurcharge;
  } else {
    distanceMiles = 3 + Math.floor(Math.random() * 10);
  }
  totalLow = low + totalTripFee;
  totalHigh = high + totalTripFee;

  const issueDetails = ISSUE_TEMPLATES[trade][state];
  const summary = buildSummary({ state, trade, customer, distanceMiles, fuelSurcharge, totalLow, totalHigh });

  return {
    boss_id: null, // filled in at insert time
    customer_name: customer.name,
    customer_phone: customer.phone,
    customer_address: customer.address,
    customer_zipcode: zip,
    issue_type: state === "rejected" ? "general" : trade,
    issue_details: issueDetails,
    preferred_time: state === "accepted" || state === "urgent" ? PREFERRED_TIMES[Math.floor(Math.random() * PREFERRED_TIMES.length)] : null,
    ai_decision: state,
    ai_decision_reason: state === "rejected" ? (far ? "Out of service area" : "Not in trade list") : null,
    quote_low: state === "accepted" ? totalLow : null,
    quote_high: state === "accepted" ? totalHigh : null,
    pricing_breakdown: state === "accepted" ? {
      trip_fee: TRIP_FEE,
      fuel_surcharge: fuelSurcharge,
      total_trip_fee: totalTripFee,
      range_low: low,
      range_high: high,
      total_low: totalLow,
      total_high: totalHigh,
      distance_miles: distanceMiles,
      free_distance_miles: FREE_DISTANCE,
      surcharge_per_mile: SURCHARGE_PER_MILE,
    } : null,
    summary,
    status: STATUS_MAP[state],
    created_at: randomCreatedAt(daysAgo),
    data_source: "demo",
    vapi_call_id: null, // demo data has no real call
  };
}

const STATUS_MAP = {
  accepted: "pending",  // booked, waiting for boss confirmation
  urgent: "urgent",
  unsure: "callback",
  rejected: "rejected",
};

const PREFERRED_TIMES = [
  "Tomorrow morning (8-11am)",
  "Tomorrow afternoon (1-4pm)",
  "Today afternoon if possible",
  "Friday morning",
  "Saturday morning",
  "This evening",
  "Wednesday afternoon",
];

const ISSUE_TEMPLATES = {
  plumbing: {
    accepted: "Kitchen sink leaking under the cabinet, water on the floor",
    urgent: "Burst pipe under bathroom sink, water everywhere, shut off main valve",
    unsure: "Slow drain in master bathroom for 2 days, might be deeper clog",
    rejected: null,
  },
  electrical: {
    accepted: "GFCI outlet in kitchen won't reset, breaker keeps tripping",
    urgent: "Half the house lost power, breaker won't reset, no burning smell",
    unsure: "Outdoor patio light flickers at night, can't tell if wiring or bulb",
    rejected: null,
  },
  hvac: {
    accepted: "AC unit making grinding noise, still cooling but worried it will fail",
    urgent: "AC stopped cooling entirely, house at 85°F with infant at home",
    unsure: "Furnace kicks on but takes a long time to heat, thermostat works",
    rejected: null,
  },
  handyman: {
    accepted: "Three fence panels leaning after windstorm, need post replacement",
    urgent: null, // handyman rarely urgent
    unsure: "Section of drywall in garage has water stain, not sure if still leaking",
    rejected: null,
  },
  general: {
    accepted: "Pressure washing driveway and back patio, ~800 sq ft total",
    urgent: "Tree fell on fence after storm, blocking driveway access",
    unsure: "Painting estimate for 3 rooms, would like quote before scheduling",
    rejected: "Customer asking about landscaping (lawn mowing)",
  },
};

function buildSummary({ state, trade, customer, distanceMiles, fuelSurcharge, totalLow, totalHigh }) {
  if (state === "accepted") {
    const surcharge = fuelSurcharge > 0 ? ` + $${fuelSurcharge} fuel surcharge (${distanceMiles} mi from base)` : "";
    return `${customer.name.split(" ")[0]}'s ${ISSUE_TEMPLATES[trade].accepted.split(",")[0]}, ${customer.customer_zipcode || ""}, total $${totalLow}-$${totalHigh} (incl $${TRIP_FEE} trip${surcharge})`;
  }
  if (state === "urgent") {
    return `${ISSUE_TEMPLATES[trade].urgent}, ${customer.customer_zipcode || ""} - Alex callback IMMEDIATELY`;
  }
  if (state === "unsure") {
    return `${ISSUE_TEMPLATES[trade].unsure}, ${customer.customer_zipcode || ""} - needs Alex follow-up`;
  }
  if (state === "rejected") {
    return trade === "general"
      ? "Customer wanted landscaping - not in our trade list, declined quickly"
      : `Customer in ${customer.customer_zipcode || "Dallas"} - outside Houston service area`;
  }
  return "";
}

function generateDataset() {
  const cases = [];
  let nameIdx = 0;
  let phoneIdx = 0;

  function nextCustomer() {
    const name = CUSTOMER_NAMES[nameIdx % CUSTOMER_NAMES.length];
    nameIdx++;
    const phone = `+1${PHONE_PREFIXES[phoneIdx % PHONE_PREFIXES.length]}${String(1000000 + (phoneIdx * 1234567) % 9000000).slice(0, 7)}`;
    phoneIdx++;
    return { name, phone };
  }

  // ACCEPTED — Houston (5 per trade)
  ["plumbing", "electrical", "hvac", "handyman", "general"].forEach((trade) => {
    for (let i = 0; i < 5; i++) {
      const customer = nextCustomer();
      const zip = HOUSTON_ZIPS[Math.floor(Math.random() * HOUSTON_ZIPS.length)];
      customer.address = randomAddress(zip);
      customer.customer_zipcode = zip;
      cases.push(buildCase({ state: "accepted", trade, zip, daysAgo: Math.floor(Math.random() * 30), customer }));
    }
  });

  // ACCEPTED — far (fuel surcharge) — 2 plumbing + 2 handyman
  ["plumbing", "plumbing", "handyman", "handyman"].forEach((trade) => {
    const customer = nextCustomer();
    const zip = FAR_ZIPS[Math.floor(Math.random() * FAR_ZIPS.length)];
    customer.address = randomAddress(zip);
    customer.customer_zipcode = zip;
    cases.push(buildCase({ state: "accepted", trade, zip, daysAgo: Math.floor(Math.random() * 30), customer, far: true }));
  });

  // URGENT — 2 per trade where applicable
  ["plumbing", "plumbing", "plumbing", "electrical", "electrical", "hvac", "hvac"].forEach((trade) => {
    const customer = nextCustomer();
    const zip = HOUSTON_ZIPS[Math.floor(Math.random() * HOUSTON_ZIPS.length)];
    customer.address = randomAddress(zip);
    customer.customer_zipcode = zip;
    cases.push(buildCase({ state: "urgent", trade, zip, daysAgo: Math.floor(Math.random() * 21), customer }));
  });

  // UNSURE — 2 per trade where applicable
  ["plumbing", "plumbing", "electrical", "hvac", "handyman", "handyman", "general"].forEach((trade) => {
    const customer = nextCustomer();
    const zip = HOUSTON_ZIPS[Math.floor(Math.random() * HOUSTON_ZIPS.length)];
    customer.address = randomAddress(zip);
    customer.customer_zipcode = zip;
    cases.push(buildCase({ state: "unsure", trade, zip, daysAgo: Math.floor(Math.random() * 25), customer }));
  });

  // REJECTED — 3 out of trade (general/landscaping) + 3 out of area (Dallas)
  for (let i = 0; i < 3; i++) {
    const customer = nextCustomer();
    customer.address = randomAddress(HOUSTON_ZIPS[0]);
    customer.customer_zipcode = HOUSTON_ZIPS[0];
    cases.push(buildCase({ state: "rejected", trade: "general", zip: HOUSTON_ZIPS[0], daysAgo: Math.floor(Math.random() * 30), customer }));
  }
  for (let i = 0; i < 3; i++) {
    const customer = nextCustomer();
    const zip = OUT_OF_AREA_ZIPS[Math.floor(Math.random() * OUT_OF_AREA_ZIPS.length)];
    customer.address = `Some address in ${zip}`;
    customer.customer_zipcode = zip;
    cases.push(buildCase({ state: "rejected", trade: "electrical", zip, daysAgo: Math.floor(Math.random() * 30), customer, far: true }));
  }

  return cases;
}

async function getBossId() {
  const url = `${SUPABASE_URL}/rest/v1/bosses?select=id&limit=1`;
  return new Promise((resolve, reject) => {
    require("https").get(
      {
        hostname: new URL(url).hostname,
        path: new URL(url).pathname + new URL(url).search,
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(b);
            resolve(data[0]?.id || null);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
  });
}

async function clearDemoData() {
  return new Promise((resolve, reject) => {
    require("https").request(
      {
        hostname: new URL(SUPABASE_URL).hostname,
        path: "/rest/v1/work_orders?data_source=eq.demo",
        method: "DELETE",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
          Prefer: "return=minimal",
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve(b));
      },
    ).on("error", reject).end();
  });
}

async function insertBatch(records) {
  // Supabase allows up to 1000 rows per POST, send all at once
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(records);
    require("https").request(
      {
        hostname: new URL(SUPABASE_URL).hostname,
        path: "/rest/v1/work_orders",
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Prefer: "return=minimal",
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(records.length);
          } else {
            reject(new Error(`Insert failed: ${res.statusCode} ${b.slice(0, 200)}`));
          }
        });
      },
    ).on("error", reject).end(data);
  });
}

async function main() {
  const cmd = process.argv[2] || "seed";
  const bossId = await getBossId();
  if (!bossId) {
    console.error("✗ No boss found in DB. Run the schema.sql seed first.");
    process.exit(1);
  }

  if (cmd === "clear") {
    console.log("Clearing demo data...");
    await clearDemoData();
    console.log("✓ Cleared.");
    return;
  }

  console.log(`Using boss: ${bossId}`);
  console.log("Clearing any existing demo data first...");
  await clearDemoData();

  const cases = generateDataset().map((c) => ({ ...c, boss_id: bossId }));
  console.log(`Seeding ${cases.length} demo work_orders...`);
  const inserted = await insertBatch(cases);

  console.log(`\n✓ Inserted ${inserted} demo records (data_source='demo')`);
  console.log("Distribution by state:");
  ["accepted", "urgent", "unsure", "rejected"].forEach((s) => {
    const count = cases.filter((c) => c.ai_decision === s).length;
    console.log(`  ${s.padEnd(10)}: ${count}`);
  });
  console.log("\nDashboard: https://demo-navy-chi-47.vercel.app (filter by data_source = 'demo')");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
