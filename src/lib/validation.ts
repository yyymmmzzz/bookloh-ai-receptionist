import type { Boss, IssueType, ValidateServiceResult, GetPriceQuoteResult } from "./types";

/**
 * Validate that a customer's zip code is within the boss's service area
 * AND that the issue type is in the boss's trade list.
 *
 * Strategy (in priority order):
 * 1. Google Maps Distance Matrix API — if configured and reachable, use exact driving distance
 * 2. Zip-prefix fallback — if Google Maps fails, use a 3-digit prefix match against
 *    the boss's service_zip_prefixes array (default: Houston 770-775)
 *
 * For a real product, replace with a proper geo lookup (Mapbox, HERE, etc.)
 */
export async function validateService(
  boss: Boss,
  zipcode: string,
  issueType: IssueType,
): Promise<ValidateServiceResult> {
  // Trade check first (cheap)
  if (!boss.service_trades.includes(issueType)) {
    return {
      ok: false,
      reason: `We don't handle ${issueType} jobs. We specialize in: ${boss.service_trades.join(", ")}.`,
    };
  }

  // Zipcode format check
  if (!/^\d{5}$/.test(zipcode)) {
    return { ok: false, reason: "Invalid zip code format. Please provide a 5-digit US zip code." };
  }

  // Distance check via Google Maps
  const distance = await getDistanceMiles(boss.service_base_zip, zipcode);

  if (distance !== null) {
    // Google Maps gave us an answer — trust it
    if (distance > boss.service_radius_miles) {
      return {
        ok: false,
        reason: `That's about ${Math.round(distance)} miles from our base — outside our ${boss.service_radius_miles}-mile service area. We'd recommend searching for a ${issueType} contractor closer to you.`,
        distance_miles: distance,
      };
    }
    return { ok: true, distance_miles: distance };
  }

  // Google Maps failed (not configured, unreachable, or rate limited)
  // Fall back to zip prefix check
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

/**
 * Check if a zip code starts with any of the boss's service prefixes.
 * Default Houston-area prefixes cover 770-775.
 */
function isInServiceZipPrefixes(
  zipcode: string,
  prefixes: string[] | undefined,
): boolean {
  if (!prefixes || prefixes.length === 0) return true; // No prefixes = accept all
  return prefixes.some((p) => zipcode.startsWith(p));
}

/**
 * Human-readable description of service area prefixes (for rejection messages).
 */
function describeServiceArea(prefixes: string[] | undefined): string {
  if (!prefixes || prefixes.length === 0) return "local";
  if (prefixes.length === 1) return `${prefixes[0]}xxx`;
  return `${prefixes[0]}-${prefixes[prefixes.length - 1]}`;
}

/**
 * Compute the fuel surcharge for a given distance.
 *  - If distance is null/undefined, returns 0
 *  - Miles within `free_distance_miles` are free
 *  - Anything beyond is charged at `distance_surcharge_per_mile`
 */
export function computeFuelSurcharge(
  boss: Boss,
  distanceMiles: number | null | undefined,
): number {
  if (distanceMiles == null) return 0;
  const extra = Math.max(0, distanceMiles - boss.free_distance_miles);
  // Round to nearest dollar — pricing should be predictable
  return Math.round(extra * boss.distance_surcharge_per_mile);
}

/**
 * Get the price quote for an issue type based on the boss's price list.
 * Returns `available: false` if the issue type is not in the price list —
 * the AI should then trigger the "uncertain" branch and offer a callback.
 *
 * If `distanceMiles` is provided, also computes the fuel surcharge and total.
 * The total range is the issue-type range + total trip fee.
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

  if (!band) {
    return {
      available: false,
      trip_fee: tripFee,
      fuel_surcharge: fuelSurcharge,
      total_trip_fee: totalTripFee,
      distance_miles: distanceMiles ?? null,
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

    // Convert meters to miles
    return meters / 1609.344;
  } catch (err) {
    console.error("[validation] Google Maps Distance Matrix failed:", err);
    return null;
  }
}
