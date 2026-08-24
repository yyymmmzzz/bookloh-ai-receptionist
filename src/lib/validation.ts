import type { Boss, IssueType, ValidateServiceResult, GetPriceQuoteResult, CheckTradeResult } from "./types";

/**
 * Quick check: is the issue type in the boss's trade list?
 * Used in Phase 1 of the conversation flow — call this IMMEDIATELY after
 * the customer says what's wrong, BEFORE asking for address.
 *
 * If out of trade, the AI should politely reject and end the call.
 * No zip code needed for this check.
 */
export function checkTrade(
  boss: Boss,
  issueType: IssueType,
): CheckTradeResult {
  const inTrade = boss.service_trades.includes(issueType);
  if (inTrade) {
    return {
      in_trade: true,
      matched_trade: issueType,
    };
  }
  return {
    in_trade: false,
    reason: `We don't handle ${issueType} jobs. We specialize in: ${boss.service_trades.join(", ")}.`,
  };
}

/**
 * Validate that a customer's postal/zip code is within the boss's service area
 * AND that the issue type is in the boss's trade list.
 *
 * Country-aware (multi-region):
 * - US: 5-digit zipcode, Google Maps distance (if configured) + zip-prefix fallback
 * - SG: 6-digit postal code, prefix match (01-20, 22-28)
 * - MY: 5-digit postcode, prefix match against boss.service_postal_prefixes
 * - ID: 5-digit postcode, prefix match against boss.service_postal_prefixes
 *
 * Used in Phase 2 of the conversation flow — only called after check_trade
 * has confirmed the issue is in the boss's trade list.
 */
export async function validateService(
  boss: Boss,
  postalInput: string,
  issueType: IssueType,
): Promise<ValidateServiceResult> {
  // Trade check first (cheap) — in Phase 2 flow this is usually already confirmed
  // by check_trade, but we keep the safety check here in case AI calls directly.
  if (!boss.service_trades.includes(issueType)) {
    return {
      ok: false,
      reason: `We don't handle ${issueType} jobs. We specialize in: ${boss.service_trades.join(", ")}.`,
    };
  }

  const country = boss.country || "US";

  // Route by country
  if (country === "US") {
    return validateUSService(boss, postalInput, issueType);
  } else if (country === "SG") {
    return validateSGService(boss, postalInput);
  } else if (country === "MY") {
    return validateMYService(boss, postalInput);
  } else if (country === "ID") {
    return validateIDService(boss, postalInput);
  }
  // Unknown country — fall through to US-style check
  return validateUSService(boss, postalInput, issueType);
}

// =====================================================
// US (5-digit zipcode)
// =====================================================
async function validateUSService(
  boss: Boss,
  zipcode: string,
  issueType: IssueType,
): Promise<ValidateServiceResult> {
  if (!/^\d{5}$/.test(zipcode)) {
    return { ok: false, reason: "Invalid zip code format. Please provide a 5-digit US zip code." };
  }

  // Distance check via Google Maps
  const distance = await getDistanceMiles(boss.service_base_zip, zipcode);

  if (distance !== null) {
    if (distance > boss.service_radius_miles) {
      return {
        ok: false,
        reason: `That's about ${Math.round(distance)} miles from our base — outside our ${boss.service_radius_miles}-mile service area. We'd recommend searching for a ${issueType} contractor closer to you.`,
        distance_miles: distance,
      };
    }
    return { ok: true, distance_miles: distance };
  }

  // Google Maps failed — fall back to zip prefix check
  const inServiceArea = isInServiceZipPrefixes(zipcode, boss.service_zip_prefixes);
  if (!inServiceArea) {
    console.warn(`[validation] Google Maps failed; zip ${zipcode} not in service prefixes. Rejecting.`);
    return {
      ok: false,
      reason: `Zip code ${zipcode} is outside our service area. We serve the ${describeServiceArea(boss.service_zip_prefixes)} area.`,
      distance_miles: -1,
    };
  }
  console.warn(`[validation] Google Maps failed; used zip-prefix fallback (${zipcode} matched).`);
  return { ok: true, distance_miles: -1 };
}

// =====================================================
// Singapore (6-digit postal code)
// Districts 01-20 (CBD to East Coast) + 22-28 (central-east). Out: 50+ (Jurong/Tuas).
// =====================================================
function validateSGService(boss: Boss, postal: string): ValidateServiceResult {
  if (!/^\d{6}$/.test(postal)) {
    return { ok: false, reason: "Invalid Singapore postal code. Please provide a 6-digit postal code (e.g. 238859)." };
  }

  // First 2 digits = district
  const district = postal.slice(0, 2);
  const allowedDistricts = boss.service_postal_prefixes && boss.service_postal_prefixes.length > 0
    ? boss.service_postal_prefixes
    : ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","22","23","24","25","26","27","28"];

  if (!allowedDistricts.includes(district)) {
    return {
      ok: false,
      reason: `Sorry, postal district ${district} is outside our service area. We cover Singapore districts ${allowedDistricts.join(", ")}.`,
      distance_miles: -1,
    };
  }
  return { ok: true, distance_miles: -1 };
}

// =====================================================
// Malaysia — H-Master Bintulu
// 97xxx = Bintulu + Sarawak north (PRIMARY service area)
// 93xxx = Kuching / Sri Aman, 98xxx = Miri / Limbang (Sarawak but distant)
// 50/47/40/10/20 = Peninsular Malaysia (out of scope, refer to nearest dealer)
// =====================================================
function validateMYService(boss: Boss, postal: string): ValidateServiceResult {
  if (!/^\d{5}$/.test(postal)) {
    return { ok: false, reason: "Invalid Malaysia postcode. Please provide a 5-digit postcode (e.g. 97000 for Bintulu)." };
  }
  const prefix = postal.slice(0, 2);
  const allowed = boss.service_postal_prefixes && boss.service_postal_prefixes.length > 0
    ? boss.service_postal_prefixes
    : ["97"];

  if (!allowed.includes(prefix)) {
    return {
      ok: false,
      reason: `Postcode area ${prefix}xxx is outside H-Master's primary Bintulu service area. We are based at 97000 Bintulu, Sarawak. We may still be able to help — my boss will WhatsApp you to discuss.`,
      distance_miles: -1,
    };
  }
  return { ok: true, distance_miles: -1 };
}

// =====================================================
// Indonesia (5-digit kode pos, 10xxx=Jakarta, 40xxx=Bandung, 60xxx=Surabaya)
// =====================================================
function validateIDService(boss: Boss, postal: string): ValidateServiceResult {
  if (!/^\d{5}$/.test(postal)) {
    return { ok: false, reason: "Invalid Indonesia kode pos. Please provide a 5-digit kode pos (e.g. 10110 for Jakarta Pusat)." };
  }
  const prefix = postal.slice(0, 2);
  const allowed = boss.service_postal_prefixes && boss.service_postal_prefixes.length > 0
    ? boss.service_postal_prefixes
    : ["10","11","12","40","60"];

  if (!allowed.includes(prefix)) {
    return {
      ok: false,
      reason: `Maaf, kode pos area ${prefix}xxx di luar area layanan kami. Kami melayani Jakarta, Bandung, dan Surabaya.`,
      distance_miles: -1,
    };
  }
  return { ok: true, distance_miles: -1 };
}

// =====================================================
// Helpers
// =====================================================

/**
 * Check if a zip code starts with any of the boss's service prefixes.
 * Default Houston-area prefixes cover 770-775.
 */
function isInServiceZipPrefixes(
  zipcode: string,
  prefixes: string[] | undefined,
): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((p) => zipcode.startsWith(p));
}

function describeServiceArea(prefixes: string[] | undefined): string {
  if (!prefixes || prefixes.length === 0) return "local";
  if (prefixes.length === 1) return `${prefixes[0]}xxx`;
  return `${prefixes[0]}-${prefixes[prefixes.length - 1]}`;
}

/**
 * Compute the fuel surcharge for a given distance.
 * For SEA countries (no Google Maps distance), always returns 0.
 * For US, if distance is null/undefined, returns 0.
 * Miles within `free_distance_miles` are free; anything beyond is charged.
 */
export function computeFuelSurcharge(
  boss: Boss,
  distanceMiles: number | null | undefined,
): number {
  if (distanceMiles == null) return 0;
  // Only US has fuel surcharge logic; SEA is small enough to skip.
  if (boss.country && boss.country !== "US") return 0;
  const extra = Math.max(0, distanceMiles - boss.free_distance_miles);
  return Math.round(extra * boss.distance_surcharge_per_mile);
}

/**
 * Get the price quote for an issue type based on the boss's price list.
 * Returns `available: false` if the issue type is not in the price list —
 * the AI should then trigger the "uncertain" branch and offer a callback.
 *
 * If `distanceMiles` is provided, also computes the fuel surcharge and total
 * (US only — SEA countries skip the surcharge).
 */
export function getPriceQuote(
  boss: Boss,
  issueType: IssueType,
  distanceMiles?: number | null,
): GetPriceQuoteResult {
  const band = boss.price_list[issueType];
  const tripFee = boss.diagnostic_fee;
  const fuelSurcharge = computeFuelSurcharge(boss, distanceMiles);
  const totalTripFee = tripFee + fuelSurcharge;
  const symbol = boss.currency_symbol || "$";

  if (!band) {
    return {
      available: false,
      trip_fee: tripFee,
      fuel_surcharge: fuelSurcharge,
      total_trip_fee: totalTripFee,
      distance_miles: distanceMiles ?? null,
      currency_symbol: symbol,
    };
  }

  return {
    available: true,
    trip_fee: tripFee,
    fuel_surcharge: fuelSurcharge,
    total_trip_fee: totalTripFee,
    distance_miles: distanceMiles ?? null,
    range: { low: band.low, high: band.high },
    total_low: band.low + totalTripFee,
    total_high: band.high + totalTripFee,
    currency_symbol: symbol,
  };
}

/**
 * Get driving distance in miles between two US zip codes using Google Maps
 * Distance Matrix API. Returns null if Google Maps is not configured or
 * the lookup fails.
 */
async function getDistanceMiles(originZip: string, destinationZip: string): Promise<number | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", originZip);
    url.searchParams.set("destinations", destinationZip);
    url.searchParams.set("units", "imperial");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;

    const data = await res.json();
    const element = data?.rows?.[0]?.elements?.[0];
    const meters = element?.distance?.value;
    if (typeof meters !== "number") return null;

    return meters / 1609.344;
  } catch (err) {
    console.error("[validation] Google Maps Distance Matrix failed:", err);
    return null;
  }
}
