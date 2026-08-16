"use client";

import { decisionLabel, decisionColor, statusLabel, statusColor, relativeTime, formatDateTime, cn } from "@/lib/utils";
import type { WorkOrder } from "@/lib/types";

/**
 * Static preview of the dashboard with hardcoded demo data.
 * No Supabase required — useful for showing stakeholders the UX before
 * backend setup, or for offline design review.
 *
 * The data here mirrors what the /api/dev/seed endpoint creates. If you
 * change one, change the other to keep them in sync.
 */

// Use a fixed base timestamp for deterministic SSR/client output (avoids hydration mismatch).
// All "minutesAgo" offsets are computed from this base.
const NOW = new Date("2026-08-15T14:30:00Z").getTime();
const min = 60 * 1000;

const DEMO_ORDERS: WorkOrder[] = [
  {
    id: "preview-urgent-1",
    boss_id: "preview",
    customer_id: null,
    customer_name: "John Miller",
    customer_phone: "+17135551234",
    customer_address: "1234 Main St, Houston, TX",
    customer_zipcode: "77002",
    issue_type: "hvac",
    issue_details: "AC completely stopped working. It's 100°F outside and my kids are home. Started blowing room-temp air around 2pm today.",
    preferred_time: "ASAP — kids are home",
    ai_decision: "urgent",
    ai_decision_reason: "Customer reports AC failure during 100°F heat wave, kids at home",
    quote_low: 200,
    quote_high: 500,
    summary: "🚨 AC down in 100°F heat — John needs help NOW. 1234 Main St, 77002. Kids at home.",
    vapi_call_id: "seed-preview-1",
    recording_url: null,
    transcript: [
      { role: "assistant", text: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?" },
      { role: "user", text: "My AC just stopped working. It's 100 degrees outside and I have two kids at home." },
      { role: "assistant", text: "I understand, that's urgent. Let me have someone call you back in 5 to 15 minutes. Can I get your address and a callback number?" },
      { role: "user", text: "1234 Main Street, 77002. And the number you're calling from is my cell." },
      { role: "assistant", text: "Got it. I'm flagging this as urgent. Stay safe — Alex will call you back within 15 minutes." },
    ],
    status: "urgent",
    confirmed_at: null,
    callback_initiated_at: null,
    created_at: new Date(NOW - 3 * min).toISOString(),
    updated_at: new Date(NOW - 3 * min).toISOString(),
  },
  {
    id: "preview-accept-1",
    boss_id: "preview",
    customer_id: null,
    customer_name: "Sarah Johnson",
    customer_phone: "+17135555678",
    customer_address: "5678 Oak Ave, Houston, TX",
    customer_zipcode: "77006",
    issue_type: "plumbing",
    issue_details: "Kitchen sink drain very slow. Started about 2 days ago. Tried plunger, didn't help much.",
    preferred_time: "Friday afternoon (anytime after 1pm)",
    ai_decision: "accepted",
    ai_decision_reason: "In service area, in trade list, in price list",
    quote_low: 150,
    quote_high: 400,
    summary: "Kitchen drain slow at 5678 Oak Ave, 77006. Sarah available Friday afternoon. Quote: $150–$400 + $89 diagnostic.",
    vapi_call_id: "seed-preview-2",
    recording_url: null,
    transcript: [
      { role: "assistant", text: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?" },
      { role: "user", text: "Hi, my kitchen sink is leaking under the cabinet." },
      { role: "assistant", text: "Sorry to hear that. What's your zip code?" },
      { role: "user", text: "77006" },
      { role: "assistant", text: "Got it. When did it start?" },
      { role: "user", text: "Last night, it's been dripping all night." },
      { role: "assistant", text: "And when are you available for a visit?" },
      { role: "user", text: "Friday afternoon works." },
      { role: "assistant", text: "Great. I can give you a reference range — our diagnostic fee is $89, which goes toward the repair. For kitchen sink leaks, typical cost is $150 to $400, but the final price depends on what we find on site. We can probably get someone out Friday afternoon — someone will call you to confirm the exact time. Can I get your name?" },
      { role: "user", text: "Sarah Johnson. The number you're calling from is fine." },
    ],
    status: "pending",
    confirmed_at: null,
    callback_initiated_at: null,
    created_at: new Date(NOW - 12 * min).toISOString(),
    updated_at: new Date(NOW - 12 * min).toISOString(),
  },
  {
    id: "preview-unsure-1",
    boss_id: "preview",
    customer_id: null,
    customer_name: "Mike Rodriguez",
    customer_phone: "+17135559012",
    customer_address: "9012 Pine St, Houston, TX",
    customer_zipcode: "77008",
    issue_type: "handyman",
    issue_details: "Need help assembling a large IKEA Pax wardrobe and mounting a 65\" TV on drywall. Have all the parts and mount kit.",
    preferred_time: "Saturday morning if possible",
    ai_decision: "unsure",
    ai_decision_reason: "Job is bigger than typical handyman scope — needs quote review",
    quote_low: null,
    quote_high: null,
    summary: "Furniture assembly + TV mount at 9012 Pine St, 77008. Mike available Saturday morning. Need to scope.",
    vapi_call_id: "seed-preview-3",
    recording_url: null,
    transcript: null,
    status: "callback",
    confirmed_at: null,
    callback_initiated_at: null,
    created_at: new Date(NOW - 28 * min).toISOString(),
    updated_at: new Date(NOW - 28 * min).toISOString(),
  },
  {
    id: "preview-rejected-1",
    boss_id: "preview",
    customer_id: null,
    customer_name: "Lisa Chen",
    customer_phone: "+12145554444",
    customer_address: "4321 Elm St, Dallas, TX",
    customer_zipcode: "75201",
    issue_type: "electrical",
    issue_details: "Living room outlet stopped working. Tried the GFCI reset, no luck.",
    preferred_time: "Anytime this week",
    ai_decision: "rejected",
    ai_decision_reason: "Out of service area (240 miles from base zip 77002)",
    quote_low: null,
    quote_high: null,
    summary: "Outlet not working in Dallas (75201) — 240 miles away, outside our 25-mile service area. Referred to local search.",
    vapi_call_id: "seed-preview-4",
    recording_url: null,
    transcript: null,
    status: "rejected",
    confirmed_at: null,
    callback_initiated_at: null,
    created_at: new Date(NOW - 65 * min).toISOString(),
    updated_at: new Date(NOW - 65 * min).toISOString(),
  },
  {
    id: "preview-confirmed-1",
    boss_id: "preview",
    customer_id: null,
    customer_name: "Carlos Mendez",
    customer_phone: "+17135557777",
    customer_address: "7777 Bayou Dr, Houston, TX",
    customer_zipcode: "77019",
    issue_type: "electrical",
    issue_details: "GFCI outlet in master bathroom keeps tripping. Reset works for a few hours then trips again.",
    preferred_time: "Today if possible",
    ai_decision: "accepted",
    ai_decision_reason: "Standard electrical issue, in area, in trade list",
    quote_low: 120,
    quote_high: 350,
    summary: "GFCI outlet tripping at 7777 Bayou Dr, 77019. Carlos available today. Quote: $120–$350 + $89 diagnostic.",
    vapi_call_id: "seed-preview-5",
    recording_url: null,
    transcript: null,
    status: "confirmed",
    confirmed_at: new Date(NOW - 30 * min).toISOString(),
    callback_initiated_at: null,
    created_at: new Date(NOW - 120 * min).toISOString(),
    updated_at: new Date(NOW - 30 * min).toISOString(),
  },
  {
    id: "preview-unsure-2",
    boss_id: "preview",
    customer_id: null,
    customer_name: "Patricia Williams",
    customer_phone: "+17135553344",
    customer_address: "3344 Westheimer Rd, Houston, TX",
    customer_zipcode: "77027",
    issue_type: "general",
    issue_details: "Garage door opener making grinding noise, intermittently doesn't open.",
    preferred_time: "Tuesday or Wednesday",
    ai_decision: "unsure",
    ai_decision_reason: "Customer specifically asked to talk to a person",
    quote_low: null,
    quote_high: null,
    summary: "Garage door opener grinding at 3344 Westheimer, 77027. Patricia asked for the owner. Available Tue/Wed.",
    vapi_call_id: "seed-preview-6",
    recording_url: null,
    transcript: null,
    status: "callback",
    confirmed_at: null,
    callback_initiated_at: null,
    created_at: new Date(NOW - 185 * min).toISOString(),
    updated_at: new Date(NOW - 185 * min).toISOString(),
  },
  {
    id: "preview-completed-1",
    boss_id: "preview",
    customer_id: null,
    customer_name: "David Park",
    customer_phone: "+17135552211",
    customer_address: "2211 Heights Blvd, Houston, TX",
    customer_zipcode: "77008",
    issue_type: "handyman",
    issue_details: "Need to replace 3 ceiling fan light fixtures and patch a few nail holes in the drywall.",
    preferred_time: "Yesterday",
    ai_decision: "accepted",
    ai_decision_reason: "Standard handyman job",
    quote_low: 100,
    quote_high: 300,
    summary: "Fan fixture replacement + drywall patch at 2211 Heights Blvd, 77008. David, yesterday. Completed 2h later.",
    vapi_call_id: "seed-preview-7",
    recording_url: null,
    transcript: null,
    status: "completed",
    confirmed_at: new Date(NOW - 300 * min).toISOString(),
    callback_initiated_at: null,
    created_at: new Date(NOW - 320 * min).toISOString(),
    updated_at: new Date(NOW - 60 * min).toISOString(),
  },
  {
    id: "preview-rejected-2",
    boss_id: "preview",
    customer_id: null,
    customer_name: "Robert Kim",
    customer_phone: "+17135558899",
    customer_address: "8899 Memorial Dr, Houston, TX",
    customer_zipcode: "77024",
    issue_type: "general",
    issue_details: "Need a full kitchen remodel — new cabinets, countertops, flooring, paint.",
    preferred_time: "Looking to start next month",
    ai_decision: "rejected",
    ai_decision_reason: "Out of scope — full kitchen remodel beyond handyman service",
    quote_low: null,
    quote_high: null,
    summary: "Full kitchen remodel request — beyond handyman scope. Referred to a general contractor.",
    vapi_call_id: "seed-preview-8",
    recording_url: null,
    transcript: null,
    status: "rejected",
    confirmed_at: null,
    callback_initiated_at: null,
    created_at: new Date(NOW - 60 * 26 * min).toISOString(),
    updated_at: new Date(NOW - 60 * 26 * min).toISOString(),
  },
];

export default function PreviewPage() {
  const stats = {
    total: DEMO_ORDERS.length,
    urgent: DEMO_ORDERS.filter((o) => o.ai_decision === "urgent" || o.status === "urgent").length,
    pending: DEMO_ORDERS.filter((o) => o.status === "pending").length,
    callback: DEMO_ORDERS.filter((o) => o.status === "callback" || o.ai_decision === "unsure").length,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Demo banner */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3">
        <div className="text-blue-600 text-lg">👀</div>
        <div className="flex-1 text-sm text-blue-900">
          <strong>Static preview.</strong> This page shows hardcoded demo data — no Supabase or Vapi needed. The real dashboard (/) updates live with actual calls.
          <div className="mt-1 text-xs text-blue-700">
            For the live version, set up Supabase and call <code className="bg-blue-100 px-1 rounded">POST /api/dev/seed</code>.
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Live feed of calls handled by the AI receptionist</p>
        </div>
        <div className="text-xs text-gray-400">{DEMO_ORDERS.length} total</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total calls" value={stats.total} />
        <StatCard label="Urgent" value={stats.urgent} accent="red" />
        <StatCard label="Pending" value={stats.pending} accent="blue" />
        <StatCard label="Callback" value={stats.callback} accent="amber" />
      </div>

      <div className="space-y-2">
        {DEMO_ORDERS.map((order) => (
          <PreviewRow key={order.id} order={order} />
        ))}
      </div>

      <div className="mt-8 text-center">
        <a
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800"
        >
          Go to live dashboard →
        </a>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: "red" | "blue" | "amber" }) {
  const accentClass =
    accent === "red"
      ? "border-l-red-500"
      : accent === "blue"
        ? "border-l-blue-500"
        : accent === "amber"
          ? "border-l-amber-500"
          : "border-l-gray-200";

  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${accentClass} px-4 py-3`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function PreviewRow({ order }: { order: WorkOrder }) {
  return (
    <a
      href={`/preview/orders/${order.id}`}
      className="block bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all p-4"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${decisionColor(order.ai_decision)}`}>
              {decisionLabel(order.ai_decision)}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded ${statusColor(order.status)}`}>
              {statusLabel(order.status)}
            </span>
            {order.issue_type && (
              <span className="text-xs text-gray-500 capitalize">{order.issue_type}</span>
            )}
            {order.quote_low && order.quote_high && (
              <span className="text-xs text-gray-700 font-medium">
                ${order.quote_low}–${order.quote_high}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-900 font-medium">
            {order.summary || "No summary"}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
            <span>{order.customer_name || "Unknown"} · {order.customer_phone}</span>
            {order.customer_address && (
              <span className="truncate">· {order.customer_address}</span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-gray-400 flex-shrink-0">
          <div>{relativeTime(order.created_at)}</div>
          <div className="mt-0.5">{formatDateTime(order.created_at)}</div>
        </div>
      </div>
    </a>
  );
}
