#!/usr/bin/env node
/**
 * seed-my-demo-data.js
 *
 * Seeds the work_orders table with Malaysia sample data for the
 * Bookloh Malaysia Office demo. Used to populate the MY dashboard
 * so the team can show what a multi-region deployment looks like.
 *
 * All records are marked data_source = 'demo' and country = 'MY'
 * so they can be filtered on the /my dashboard view.
 *
 * Coverage: 10 realistic MY records spanning accepted / urgent / unsure / rejected,
 * Klang Valley + Penang + JB postcodes, with Manglish-flavored summaries.
 *
 * Run:    node scripts/seed-my-demo-data.js
 * Clear:  node scripts/clear-my-demo-data.js (TBD) or use supabase REST DELETE
 */

const fs = require("fs");
const path = require("path");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const SUPABASE_URL = ENV.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_KEY = ENV.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();

// Malaysian Klang Valley + Penang + JB + KK postcodes (in service area)
const IN_AREA_POSTCODES = {
  KL: ["50000", "50100", "50200", "50250", "50300", "50400", "50450", "50500", "50600", "50700"],
  PJ: ["47300", "47301", "47400", "47410", "47500", "47600", "47800", "47810"],
  ShahAlam: ["40000", "40100", "40150", "40200", "40300", "40400", "40450", "40460", "40500"],
  Penang: ["10000", "10100", "10200", "10300", "10400", "10450", "10500", "10600", "11000", "11050", "11100"],
  JB: ["80000", "80100", "80150", "80200", "80250", "80300", "80400", "80500", "80600"],
};

// Out of service area (60xxx = Perak, 50xxx but at boundary)
const OUT_OF_AREA_POSTCODES = ["30000", "30200", "30400", "31400"]; // Ipoh/Perak
const OUT_OF_AREA_STATE = "Perak (Ipoh area)";

// KL/PJ streets
const KL_STREETS = [
  "Jalan Sultan Ismail", "Jalan Bukit Bintang", "Jalan Ampang", "Jalan Tun Razak",
  "Jalan Imbi", "Jalan Pudu", "Jalan Kuchai Lama", "Jalan Gombak",
  "Jalan Cheras", "Jalan Petaling", "Jalan Raja Laut", "Jalan Hang Tuah",
];
const PJ_STREETS = [
  "Jalan SS21/1", "Jalan SS2/24", "Jalan SS3/29", "Jalan SS4c/5",
  "Jalan SS6/12", "Jalan SS7/26", "Jalan SS12/2", "Jalan SS22/41",
  "Jalan 14/29", "Jalan 17/56", "Jalan University", "Jalan Gasing",
];
const SHAH_ALAM_STREETS = [
  "Jalan Plumbum 7/100", "Jalan Platinum 7/77", "Jalan Perak 13/16",
  "Jalan Keluli 7/108", "Jalan Tembaga 7/57", "Jalan Timah 7/50",
  "Jalan Bestari 1/2", "Jalan Setia Indah U13/12",
];
const PENANG_STREETS = [
  "Jalan Macalister", "Jalan Penang", "Jalan Burma", "Jalan Kelawai",
  "Jalan Bagan Jermal", "Jalan Tanjung Bungah", "Lebuh Chulia", "Lebuh Light",
  "Jalan Gottlieb", "Jalan Anson",
];
const JB_STREETS = [
  "Jalan Wong Ah Fook", "Jalan Dhoby", "Jalan Trus", "Jalan Tun Abdul Razak",
  "Jalan Molek 1/9", "Jalan Austin Heights 8/1",
];

// Realistic Malaysian names (Malay / Chinese / Indian mix)
const CUSTOMER_NAMES = [
  "Ahmad Razali", "Siti Nurhaliza", "Tan Wei Ming", "Lim Chong Wei", "Vimala Devi",
  "Rajesh Kumar", "Nurul Ain", "Chen Mei Ling", "Khairul Anuar", "Priya Menon",
  "Wong Kar Ying", "Daniel Raj", "Farah Nadia", "Hafiz Rahman", "Sarah Lee",
  "Mohd Faizal", "Kavitha Ramasamy", "Jason Lim", "Aminah Yusof", "Kenneth Goh",
];

// Malaysian phone format: +60xx-XXXXXXXX (mobile) or +60x-XXXXXXXX (landline)
// Common mobile prefixes: 11/12/13/14/15/16/17/18/19 (Maxis/Celcom/Digi)
// Common landline: 3 (KL), 4 (Shah Alam), 5 (Penang), 7 (JB), 8 (KK)
function randomPhone(area) {
  let mobile = "";
  if (["KL", "PJ", "ShahAlam"].includes(area)) {
    mobile = "1" + String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 8);
  } else if (area === "Penang") {
    mobile = "1" + String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 8);
  } else if (area === "JB") {
    mobile = "1" + String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 8);
  }
  return `+60${mobile}`;
}

function randomAddress(streets, postcode, city) {
  const num = Math.floor(1 + Math.random() * 200);
  const street = streets[Math.floor(Math.random() * streets.length)];
  return `${num}, ${street}, ${postcode} ${city}`;
}

// Price ranges (RM) — matches the boss's price_list for MY
const PRICE_RANGES = {
  plumbing: [80, 350],
  electrical: [100, 300],
  handyman: [80, 250],
  general: [100, 300],
};
const TRIP_FEE = 89; // RM89 trip fee in Malaysia
const FREE_DISTANCE = 15;
const SURCHARGE_PER_MILE = 2; // RM per mile (no fuel surcharge in MY for v1, but include for far cases)

const STATUS_MAP = {
  accepted: "pending",  // booked, waiting for boss confirmation
  urgent: "urgent",
  unsure: "callback",
  rejected: "rejected",
};

const PREFERRED_TIMES = [
  "Tomorrow morning (9am-12pm)",
  "Tomorrow afternoon (2-5pm)",
  "Today afternoon if possible",
  "This Saturday morning",
  "Friday evening after 6pm",
  "Wednesday afternoon",
  "Monday morning",
];

// Manglish-flavored issue descriptions
const ISSUE_TEMPLATES = {
  plumbing: {
    accepted: "Kitchen sink paip bocor, water dripping bawah sinki",
    urgent: "Paip utama burst bilik air atas, water everywhere, dah shut off main valve",
    unsure: "Sinki slow drain 2 days already, maybe got clog deep inside",
    rejected: null,
  },
  electrical: {
    accepted: "Soket dapur tak boleh on, GFCI keep tripping",
    urgent: "Suis main sparking, smell like burnt wire, very dangerous",
    unsure: "Lampu luar flicker every night, cannot tell wayang or wiring problem",
    rejected: null,
  },
  handyman: {
    accepted: "Pagar depan 3 panel leaning, kena replace post after strong wind",
    urgent: null,
    unsure: "Dinding garaj ada water stain, not sure if still leaking or already dry",
    rejected: null,
  },
  general: {
    accepted: "Cat rumah 3 bilik, nak estimate before book",
    urgent: "Pokok besar jatuh atas pagar after storm, blocking car masuk",
    unsure: "Pressure wash driveway and car porch, total about 500 sq ft",
    rejected: "Customer nak landscaping (potong rumput) - not in our trade list",
  },
};

function buildSummary({ state, trade, customer, distanceMiles, fuelSurcharge, totalLow, totalHigh, postcode }) {
  const symbol = "RM";
  if (state === "accepted") {
    const surcharge = fuelSurcharge > 0 ? ` + ${symbol}${fuelSurcharge} fuel surcharge (${distanceMiles} mi from base)` : "";
    return `${customer.name.split(" ")[0]} - ${ISSUE_TEMPLATES[trade].accepted.split(",")[0]}, ${postcode}, total ${symbol}${totalLow}-${symbol}${totalHigh} (incl ${symbol}${TRIP_FEE} trip${surcharge})`;
  }
  if (state === "urgent") {
    return `${customer.name}: ${ISSUE_TEMPLATES[trade].urgent}, ${postcode} - Aiman callback IMMEDIATELY`;
  }
  if (state === "unsure") {
    return `${customer.name}: ${ISSUE_TEMPLATES[trade].unsure}, ${postcode} - needs Aiman follow-up`;
  }
  if (state === "rejected") {
    return trade === "general"
      ? "Customer wanted landscaping - not in our trade list, declined"
      : `Customer in ${OUT_OF_AREA_STATE} - outside Klang Valley service area`;
  }
  return "";
}

function buildCase({ state, trade, area, postcode, daysAgo, customer, far = false }) {
  const [low, high] = PRICE_RANGES[trade];
  let totalLow, totalHigh, distanceMiles, fuelSurcharge = 0, totalTripFee = TRIP_FEE;

  if (far) {
    distanceMiles = 25 + Math.floor(Math.random() * 15);
    const extra = distanceMiles - FREE_DISTANCE;
    fuelSurcharge = Math.round(extra * SURCHARGE_PER_MILE);
    totalTripFee = TRIP_FEE + fuelSurcharge;
  } else {
    distanceMiles = 3 + Math.floor(Math.random() * 12);
  }
  totalLow = low + totalTripFee;
  totalHigh = high + totalTripFee;

  const issueDetails = ISSUE_TEMPLATES[trade][state];
  const summary = buildSummary({ state, trade, customer, distanceMiles, fuelSurcharge, totalLow, totalHigh, postcode });

  return {
    boss_id: null, // filled at insert time
    customer_name: customer.name,
    customer_phone: customer.phone,
    customer_address: customer.address,
    customer_zipcode: postcode,
    issue_type: state === "rejected" ? "general" : trade,
    issue_details: issueDetails,
    preferred_time: (state === "accepted" || state === "urgent") ? PREFERRED_TIMES[Math.floor(Math.random() * PREFERRED_TIMES.length)] : null,
    ai_decision: state,
    ai_decision_reason: state === "rejected" ? (far ? "Out of service area (Perak)" : "Not in trade list") : null,
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
    created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - Math.random() * 24 * 60 * 60 * 1000).toISOString(),
    data_source: "demo",
    country: "MY",
    vapi_call_id: null,
  };
}

function generateDataset() {
  const cases = [];
  let nameIdx = 0;

  function nextCustomer(area) {
    const name = CUSTOMER_NAMES[nameIdx % CUSTOMER_NAMES.length];
    nameIdx++;
    return { name, phone: randomPhone(area) };
  }

  // ACCEPTED — Klang Valley (2 plumbing, 1 electrical, 1 handyman, 1 general)
  [
    { trade: "plumbing", area: "KL", streets: KL_STREETS, city: "Kuala Lumpur" },
    { trade: "plumbing", area: "PJ", streets: PJ_STREETS, city: "Petaling Jaya" },
    { trade: "electrical", area: "KL", streets: KL_STREETS, city: "Kuala Lumpur" },
    { trade: "handyman", area: "PJ", streets: PJ_STREETS, city: "Petaling Jaya" },
    { trade: "general", area: "ShahAlam", streets: SHAH_ALAM_STREETS, city: "Shah Alam" },
  ].forEach(({ trade, area, streets, city }) => {
    const customer = nextCustomer(area);
    const postcode = IN_AREA_POSTCODES[area][Math.floor(Math.random() * IN_AREA_POSTCODES[area].length)];
    customer.address = randomAddress(streets, postcode, city);
    cases.push(buildCase({ state: "accepted", trade, area, postcode, daysAgo: Math.floor(Math.random() * 25), customer }));
  });

  // ACCEPTED — Penang (1 plumbing)
  {
    const customer = nextCustomer("Penang");
    const postcode = IN_AREA_POSTCODES.Penang[Math.floor(Math.random() * IN_AREA_POSTCODES.Penang.length)];
    customer.address = randomAddress(PENANG_STREETS, postcode, "Georgetown");
    cases.push(buildCase({ state: "accepted", trade: "plumbing", area: "Penang", postcode, daysAgo: 3, customer }));
  }

  // URGENT — 1 plumbing in KL
  {
    const customer = nextCustomer("KL");
    const postcode = IN_AREA_POSTCODES.KL[0];
    customer.address = randomAddress(KL_STREETS, postcode, "Kuala Lumpur");
    cases.push(buildCase({ state: "urgent", trade: "plumbing", area: "KL", postcode, daysAgo: 1, customer }));
  }

  // UNSURE — 1 electrical in PJ
  {
    const customer = nextCustomer("PJ");
    const postcode = IN_AREA_POSTCODES.PJ[2];
    customer.address = randomAddress(PJ_STREETS, postcode, "Petaling Jaya");
    cases.push(buildCase({ state: "unsure", trade: "electrical", area: "PJ", postcode, daysAgo: 5, customer }));
  }

  // REJECTED — 1 out of trade (general/landscaping)
  {
    const customer = nextCustomer("KL");
    const postcode = IN_AREA_POSTCODES.KL[1];
    customer.address = randomAddress(KL_STREETS, postcode, "Kuala Lumpur");
    cases.push(buildCase({ state: "rejected", trade: "general", area: "KL", postcode, daysAgo: 8, customer }));
  }

  // REJECTED — 1 out of area (Perak)
  {
    const customer = nextCustomer("Penang");
    const postcode = OUT_OF_AREA_POSTCODES[0];
    customer.address = `${Math.floor(1 + Math.random() * 200)} Jalan Sultan Azlan Shah, ${postcode} Ipoh, Perak`;
    cases.push(buildCase({ state: "rejected", trade: "electrical", area: "Penang", postcode, daysAgo: 4, customer, far: true }));
  }

  return cases;
}

async function getBossId() {
  const url = `${SUPABASE_URL}/rest/v1/bosses?select=id&country=eq.MY&limit=1`;
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
            if (!data || data.length === 0) {
              reject(new Error("No MY boss found in database. Run migration 010 first."));
              return;
            }
            resolve(data[0].id);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
  });
}

async function insertCases(bossId, cases) {
  const records = cases.map((c) => ({ ...c, boss_id: bossId }));
  const body = JSON.stringify(records);
  const url = new URL(`${SUPABASE_URL}/rest/v1/work_orders`);
  return new Promise((resolve, reject) => {
    const req = require("https").request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Prefer: "return=minimal",
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`✓ Inserted ${records.length} MY demo records`);
            resolve(records.length);
          } else {
            reject(new Error(`Insert failed: ${res.statusCode} ${b}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  try {
    console.log("→ Looking up MY boss...");
    const bossId = await getBossId();
    console.log(`  Found boss: ${bossId}`);

    console.log("→ Generating MY demo dataset...");
    const cases = generateDataset();
    console.log(`  Generated ${cases.length} cases`);

    console.log("→ Inserting into work_orders...");
    await insertCases(bossId, cases);

    console.log("\n✓ Done. View at: https://demo-navy-chi-47.vercel.app/my");
    console.log("  All records have country='MY' and data_source='demo'");
  } catch (e) {
    console.error("✗", e.message);
    process.exit(1);
  }
}

main();
