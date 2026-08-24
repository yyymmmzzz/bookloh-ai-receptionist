#!/usr/bin/env node
/**
 * seed-my-demo-data.js
 *
 * Seeds the work_orders table with H-Master Security Services (Bintulu)
 * sample data. H-Master is HandyLine AI's first MY client — a security /
 * alarm / CCTV / autogate company.
 *
 * All records are marked data_source = 'demo' and country = 'MY' so they
 * can be filtered on the /my dashboard view.
 *
 * Coverage: 10 realistic security records spanning accepted / urgent /
 * unsure / rejected, Bintulu-area postcodes (97000-97099), Sarawakian
 * names (Malay / Chinese / Iban / Melanau mix).
 *
 * Run:    node scripts/seed-my-demo-data.js
 * Clear:  see scripts/clear-my-demo-data.js (DELETE WHERE country=MY AND data_source=demo)
 */

const fs = require("fs");
const path = require("path");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const SUPABASE_URL = ENV.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_KEY = ENV.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();

// Bintulu + Sarawak north postcodes (in service area)
const BINTULU_POSTCODES = [
  "97000", "97007", "97008", "97009", "97010", "97011", "97012", "97013",
  "97014", "97015", "97100", "97150", "97200", "97210",
];

// Out of service area
const OUT_OF_AREA_POSTCODES = {
  kuching: ["93000", "93100", "93200", "93300", "93400", "93500"],  // Sarawak south
  miri:    ["98000", "98007", "98008", "98009", "98100", "98200"],  // Sarawak north (Miri)
  kl:      ["50000", "50100", "50200"],                            // Peninsular (out of scope)
};

// Bintulu streets (real areas in Bintulu)
const BINTULU_STREETS = [
  "Jalan Sultan Iskandar", "Jalan Abang Galau", "Jalan Tun Hussein Onn",
  "Jalan Bendahara", "Jalan Kidurong", "Jalan Tg. Batu", "Jalan Sibiew",
  "Jalan Stampin", "Jalan Tun Razak", "Jalan Jepak", "Jalan Tatau-Sebauh",
  "Jalan Sultan Ismail", "Jalan Masjid", "Jalan Brooke", "Jalan Kambar Bujang",
  "Jalan Persiaran Pelita 1", "Light Industrial Estate",
];

// Sarawakian names (Malay / Chinese / Iban / Melanau mix)
const CUSTOMER_NAMES = [
  "Mohd Razali bin Ahmad", "Siti Hajar binti Mohd", "Tan Chong Boon",
  "Ling Siew Hua", "Jong Chiew Ming", "Ricky anak Sumping", "Mary anak Jimbun",
  "Dayang Nurul Ain", "Wong Kok Ming", "Lim Ah Choo", "Hafiz bin Ismail",
  "Salasiah binti Yusof", "Joseph Chang", "Chew Mei Yng", "Anak Micheal Bintang",
  "Fauziah binti Abdul", "David Yong", "Haslina binti Hamid", "Peter Ling",
  "Rosnah binti Ahmad",
];

// Malaysian phone format: +60 11/12/13/14/15/16/17/18/19 XXXXXXX (mobile)
// Sarawak mobile common prefixes: 013, 014, 016, 017, 019
function randomPhone() {
  const mobilePrefix = ["11","12","13","14","15","16","17","18","19"][Math.floor(Math.random() * 9)];
  const rest = String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 8);
  return `+60${mobilePrefix}${rest}`;
}

function randomAddress(postcode) {
  const num = Math.floor(1 + Math.random() * 200);
  const street = BINTULU_STREETS[Math.floor(Math.random() * BINTULU_STREETS.length)];
  return `${num}, ${street}, ${postcode} Bintulu, Sarawak`;
}

// H-Master price ranges (RM) — matches boss.price_list
const PRICE_RANGES = {
  security:        [200, 1500],
  alarm:           [200, 1500],
  cctv:            [500, 3000],
  autogate:        [500, 2500],
  access_control:  [300, 1500],
  door_lock:       [300, 2000],
  general:         [150, 800],
};
const TRIP_FEE = 89; // RM89 diagnostic/trip fee in Bintulu

const STATUS_MAP = {
  accepted: "pending",
  urgent: "urgent",
  unsure: "callback",
  rejected: "rejected",
};

const PREFERRED_TIMES = [
  "Tomorrow morning (9am-12pm)",
  "Tomorrow afternoon (2-5pm)",
  "Today afternoon if possible",
  "This Saturday morning",
  "Friday after 5pm",
  "Monday morning",
  "ASAP — I'm at the shop now",
];

// Security issue templates (H-Master scenarios)
const ISSUE_TEMPLATES = {
  alarm: {
    accepted: "House alarm keep beeping every 30 minutes, false trigger maybe sensor",
    urgent: "Alarm triggered at warehouse, no one inside, my staff already went home",
    unsure: "Old alarm panel, sometimes arm/disarm not working, battery already changed last year",
    rejected: null,
  },
  cctv: {
    accepted: "CCTV 2 cameras no signal, DVR showing 'no video', but 4 other cameras OK",
    urgent: "CCTV whole system down at my shop, no recording since last night, very worried",
    unsure: "CCTV night vision blurry for 2 weeks, daytime recording OK but night cannot see",
    rejected: null,
  },
  autogate: {
    accepted: "Auto gate motor sound strange, slow to open, sometimes stuck halfway",
    urgent: "Auto gate stuck open since 6pm, no remote working, security risk overnight",
    unsure: "Auto gate remote need reprogram, lost one, want add new remote",
    rejected: null,
  },
  access_control: {
    accepted: "Office door card reader not detecting most cards, only 2-3 cards still work",
    urgent: "Main door access control completely down, staff cannot enter building, it's Monday morning",
    unsure: "Want to add 5 new cards, also ask if can have mobile app access",
    rejected: null,
  },
  door_lock: {
    accepted: "Samsung door lock battery low warning, but still can open with fingerprint",
    urgent: "Door lock completely dead, cannot open from outside, family member locked outside",
    unsure: "Want to change from key to Samsung digital lock, need recommendation and price",
    rejected: null,
  },
  security: {
    accepted: "Want to install new CCTV system at new shop, 4 cameras, 1 DVR, full setup",
    urgent: null,
    unsure: "Want to upgrade old alarm system to WiFi/LAN monitoring, can H-Master advise?",
    rejected: null,
  },
  general: {
    accepted: "PA system at my sundry shop speaker crackling, need check",
    urgent: "False alarm at factory every night 2am, neighbours complained, must fix this week",
    unsure: "Want to bundle security audit with quote for new system",
    rejected: "Customer wants car alarm installation - not in our scope",
  },
};

function buildSummary({ state, trade, customer, postcode, totalLow, totalHigh }) {
  const symbol = "RM";
  if (state === "accepted") {
    return `${customer.name.split(" ")[0]} - ${ISSUE_TEMPLATES[trade].accepted.split(",")[0]}, ${postcode}, total ${symbol}${totalLow}-${symbol}${totalHigh} (incl ${symbol}${TRIP_FEE} trip)`;
  }
  if (state === "urgent") {
    return `${customer.name}: ${ISSUE_TEMPLATES[trade].urgent}, ${postcode} - H-Master callback IMMEDIATELY`;
  }
  if (state === "unsure") {
    return `${customer.name}: ${ISSUE_TEMPLATES[trade].unsure}, ${postcode} - needs H-Master follow-up`;
  }
  if (state === "rejected") {
    if (trade === "general") {
      return "Customer wanted car alarm - not in H-Master scope, declined";
    }
    return `Customer in ${postcode} - outside H-Master Bintulu service area`;
  }
  return "";
}

function buildCase({ state, trade, postcode, daysAgo, customer }) {
  const [low, high] = PRICE_RANGES[trade] || PRICE_RANGES.general;
  const totalLow = low + TRIP_FEE;
  const totalHigh = high + TRIP_FEE;

  const issueDetails = ISSUE_TEMPLATES[trade][state];
  const summary = buildSummary({ state, trade, customer, postcode, totalLow, totalHigh });

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
    ai_decision_reason: state === "rejected" ? (postcode.startsWith("93") || postcode.startsWith("98") ? "Outside Bintulu service area" : "Not in trade list (car alarm)") : null,
    quote_low: state === "accepted" ? totalLow : null,
    quote_high: state === "accepted" ? totalHigh : null,
    pricing_breakdown: state === "accepted" ? {
      trip_fee: TRIP_FEE,
      fuel_surcharge: 0,
      total_trip_fee: TRIP_FEE,
      range_low: low,
      range_high: high,
      total_low: totalLow,
      total_high: totalHigh,
      distance_miles: null,
      free_distance_miles: 999,
      surcharge_per_mile: 0,
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

  function nextCustomer() {
    const name = CUSTOMER_NAMES[nameIdx % CUSTOMER_NAMES.length];
    nameIdx++;
    return { name, phone: randomPhone() };
  }

  // 6 ACCEPTED — Bintulu + nearby Sarawak north
  const acceptedScenarios = [
    { trade: "alarm",          state: "accepted", area: "Bintulu town" },
    { trade: "cctv",           state: "accepted", area: "Light Industrial Estate" },
    { trade: "autogate",       state: "accepted", area: "Tanjung Batu" },
    { trade: "access_control", state: "accepted", area: "Kidurong" },
    { trade: "door_lock",      state: "accepted", area: "Sibiew" },
    { trade: "security",       state: "accepted", area: "Bintulu town" },  // new CCTV install
  ];
  acceptedScenarios.forEach(({ trade, area }) => {
    const customer = nextCustomer();
    const postcode = BINTULU_POSTCODES[Math.floor(Math.random() * BINTULU_POSTCODES.length)];
    customer.address = randomAddress(postcode);
    cases.push(buildCase({ state: "accepted", trade, postcode, daysAgo: Math.floor(Math.random() * 25), customer }));
  });

  // 1 URGENT — autogate stuck open overnight
  {
    const customer = nextCustomer();
    const postcode = BINTULU_POSTCODES[0];
    customer.address = randomAddress(postcode);
    cases.push(buildCase({ state: "urgent", trade: "autogate", postcode, daysAgo: 0, customer }));
  }

  // 1 URGENT — alarm triggered, no one home
  {
    const customer = nextCustomer();
    const postcode = BINTULU_POSTCODES[2];
    customer.address = randomAddress(postcode);
    cases.push(buildCase({ state: "urgent", trade: "alarm", postcode, daysAgo: 1, customer }));
  }

  // 1 UNSURE — security audit
  {
    const customer = nextCustomer();
    const postcode = BINTULU_POSTCODES[4];
    customer.address = randomAddress(postcode);
    cases.push(buildCase({ state: "unsure", trade: "security", postcode, daysAgo: 5, customer }));
  }

  // 1 REJECTED — out of trade (car alarm)
  {
    const customer = nextCustomer();
    const postcode = BINTULU_POSTCODES[1];
    customer.address = randomAddress(postcode);
    cases.push(buildCase({ state: "rejected", trade: "general", postcode, daysAgo: 8, customer }));
  }

  // 1 REJECTED — out of service area (Kuching 93xxx)
  {
    const customer = nextCustomer();
    const postcode = OUT_OF_AREA_POSTCODES.kuching[0];
    customer.address = `${Math.floor(1 + Math.random() * 200)} Jalan Padungan, ${postcode} Kuching, Sarawak`;
    cases.push(buildCase({ state: "rejected", trade: "alarm", postcode, daysAgo: 4, customer }));
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
              reject(new Error("No MY boss found in database. Run migration 011 first."));
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

async function clearOldDemo() {
  // Clear existing MY demo records (the old plumbing/electrical Klang Valley data)
  const url = `${SUPABASE_URL}/rest/v1/work_orders?country=eq.MY&data_source=eq.demo`;
  return new Promise((resolve, reject) => {
    const req = require("https").request(
      {
        hostname: new URL(url).hostname,
        path: new URL(url).pathname + new URL(url).search,
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
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`  → Cleared old MY demo records`);
            resolve(true);
          } else {
            reject(new Error(`Clear failed: ${res.statusCode} ${b}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
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
            console.log(`  → Inserted ${records.length} H-Master demo records`);
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
    console.log("→ Looking up H-Master boss...");
    const bossId = await getBossId();
    console.log(`  Found boss: ${bossId}`);

    console.log("→ Clearing old MY demo records (Klang Valley plumbing/electrical)...");
    await clearOldDemo();

    console.log("→ Generating H-Master demo dataset...");
    const cases = generateDataset();
    console.log(`  Generated ${cases.length} cases`);

    console.log("→ Inserting into work_orders...");
    await insertCases(bossId, cases);

    console.log("\n✓ Done. View at: https://demo-navy-chi-47.vercel.app/my");
    console.log("  Records: 6 accepted + 2 urgent + 1 unsure + 2 rejected (out-of-trade + out-of-area)");
    console.log("  Scenarios: alarm / cctv / autogate / access_control / door_lock / security");
    console.log("  Postcodes: 97xxx (Bintulu + Sarawak north)");
  } catch (e) {
    console.error("✗", e.message);
    process.exit(1);
  }
}

main();
