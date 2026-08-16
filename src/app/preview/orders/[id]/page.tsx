"use client";

import { decisionLabel, decisionColor, statusLabel, statusColor, formatDateTime, cn } from "@/lib/utils";
import type { WorkOrder } from "@/lib/types";
import { useParams } from "next/navigation";

// Inline copy of the preview data so we can look up the order by id
// without importing the page (which would cause Next.js to try to render
// the dashboard layout inside a detail page).

// Use a fixed base timestamp for deterministic SSR/client output (avoids hydration mismatch).
const NOW = new Date("2026-08-15T14:30:00Z").getTime();
const min = 60 * 1000;

const PREVIEW_ORDERS: Record<string, WorkOrder> = {
  "preview-urgent-1": {
    id: "preview-urgent-1", boss_id: "preview", customer_id: null,
    customer_name: "John Miller", customer_phone: "+17135551234",
    customer_address: "1234 Main St, Houston, TX", customer_zipcode: "77002",
    issue_type: "hvac",
    issue_details: "AC completely stopped working. It's 100°F outside and my kids are home. Started blowing room-temp air around 2pm today.",
    preferred_time: "ASAP — kids are home",
    ai_decision: "urgent",
    ai_decision_reason: "Customer reports AC failure during 100°F heat wave, kids at home",
    quote_low: 200, quote_high: 500,
    summary: "🚨 AC down in 100°F heat — John needs help NOW. 1234 Main St, 77002. Kids at home.",
    vapi_call_id: "seed-preview-1", recording_url: null,
    transcript: [
      { role: "assistant", text: "Hi, thanks for calling Handy Works Home Services. This call may be recorded for quality. How can I help you today?" },
      { role: "user", text: "My AC just stopped working. It's 100 degrees outside and I have two kids at home." },
      { role: "assistant", text: "I understand, that's urgent. Let me have someone call you back in 5 to 15 minutes. Can I get your address and a callback number?" },
      { role: "user", text: "1234 Main Street, 77002. And the number you're calling from is my cell." },
      { role: "assistant", text: "Got it. I'm flagging this as urgent. Stay safe — Alex will call you back within 15 minutes." },
    ],
    status: "urgent", confirmed_at: null, callback_initiated_at: null,
    created_at: new Date(NOW - 3 * min).toISOString(),
    updated_at: new Date(NOW - 3 * min).toISOString(),
  },
  "preview-accept-1": {
    id: "preview-accept-1", boss_id: "preview", customer_id: null,
    customer_name: "Sarah Johnson", customer_phone: "+17135555678",
    customer_address: "5678 Oak Ave, Houston, TX", customer_zipcode: "77006",
    issue_type: "plumbing",
    issue_details: "Kitchen sink drain very slow. Started about 2 days ago. Tried plunger, didn't help much.",
    preferred_time: "Friday afternoon (anytime after 1pm)",
    ai_decision: "accepted",
    ai_decision_reason: "In service area, in trade list, in price list",
    quote_low: 150, quote_high: 400,
    summary: "Kitchen drain slow at 5678 Oak Ave, 77006. Sarah available Friday afternoon. Quote: $150–$400 + $89 diagnostic.",
    vapi_call_id: "seed-preview-2", recording_url: null,
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
    status: "pending", confirmed_at: null, callback_initiated_at: null,
    created_at: new Date(NOW - 12 * min).toISOString(),
    updated_at: new Date(NOW - 12 * min).toISOString(),
  },
  "preview-unsure-1": {
    id: "preview-unsure-1", boss_id: "preview", customer_id: null,
    customer_name: "Mike Rodriguez", customer_phone: "+17135559012",
    customer_address: "9012 Pine St, Houston, TX", customer_zipcode: "77008",
    issue_type: "handyman",
    issue_details: "Need help assembling a large IKEA Pax wardrobe and mounting a 65\" TV on drywall. Have all the parts and mount kit.",
    preferred_time: "Saturday morning if possible",
    ai_decision: "unsure",
    ai_decision_reason: "Job is bigger than typical handyman scope — needs quote review",
    quote_low: null, quote_high: null,
    summary: "Furniture assembly + TV mount at 9012 Pine St, 77008. Mike available Saturday morning. Need to scope.",
    vapi_call_id: "seed-preview-3", recording_url: null, transcript: null,
    status: "callback", confirmed_at: null, callback_initiated_at: null,
    created_at: new Date(NOW - 28 * min).toISOString(),
    updated_at: new Date(NOW - 28 * min).toISOString(),
  },
  "preview-rejected-1": {
    id: "preview-rejected-1", boss_id: "preview", customer_id: null,
    customer_name: "Lisa Chen", customer_phone: "+12145554444",
    customer_address: "4321 Elm St, Dallas, TX", customer_zipcode: "75201",
    issue_type: "electrical",
    issue_details: "Living room outlet stopped working. Tried the GFCI reset, no luck.",
    preferred_time: "Anytime this week",
    ai_decision: "rejected",
    ai_decision_reason: "Out of service area (240 miles from base zip 77002)",
    quote_low: null, quote_high: null,
    summary: "Outlet not working in Dallas (75201) — 240 miles away, outside our 25-mile service area. Referred to local search.",
    vapi_call_id: "seed-preview-4", recording_url: null, transcript: null,
    status: "rejected", confirmed_at: null, callback_initiated_at: null,
    created_at: new Date(NOW - 65 * min).toISOString(),
    updated_at: new Date(NOW - 65 * min).toISOString(),
  },
  "preview-confirmed-1": {
    id: "preview-confirmed-1", boss_id: "preview", customer_id: null,
    customer_name: "Carlos Mendez", customer_phone: "+17135557777",
    customer_address: "7777 Bayou Dr, Houston, TX", customer_zipcode: "77019",
    issue_type: "electrical",
    issue_details: "GFCI outlet in master bathroom keeps tripping. Reset works for a few hours then trips again.",
    preferred_time: "Today if possible",
    ai_decision: "accepted",
    ai_decision_reason: "Standard electrical issue, in area, in trade list",
    quote_low: 120, quote_high: 350,
    summary: "GFCI outlet tripping at 7777 Bayou Dr, 77019. Carlos available today. Quote: $120–$350 + $89 diagnostic.",
    vapi_call_id: "seed-preview-5", recording_url: null, transcript: null,
    status: "confirmed",
    confirmed_at: new Date(NOW - 30 * min).toISOString(),
    callback_initiated_at: null,
    created_at: new Date(NOW - 120 * min).toISOString(),
    updated_at: new Date(NOW - 30 * min).toISOString(),
  },
  "preview-unsure-2": {
    id: "preview-unsure-2", boss_id: "preview", customer_id: null,
    customer_name: "Patricia Williams", customer_phone: "+17135553344",
    customer_address: "3344 Westheimer Rd, Houston, TX", customer_zipcode: "77027",
    issue_type: "general",
    issue_details: "Garage door opener making grinding noise, intermittently doesn't open.",
    preferred_time: "Tuesday or Wednesday",
    ai_decision: "unsure",
    ai_decision_reason: "Customer specifically asked to talk to a person",
    quote_low: null, quote_high: null,
    summary: "Garage door opener grinding at 3344 Westheimer, 77027. Patricia asked for the owner. Available Tue/Wed.",
    vapi_call_id: "seed-preview-6", recording_url: null, transcript: null,
    status: "callback", confirmed_at: null, callback_initiated_at: null,
    created_at: new Date(NOW - 185 * min).toISOString(),
    updated_at: new Date(NOW - 185 * min).toISOString(),
  },
  "preview-completed-1": {
    id: "preview-completed-1", boss_id: "preview", customer_id: null,
    customer_name: "David Park", customer_phone: "+17135552211",
    customer_address: "2211 Heights Blvd, Houston, TX", customer_zipcode: "77008",
    issue_type: "handyman",
    issue_details: "Need to replace 3 ceiling fan light fixtures and patch a few nail holes in the drywall.",
    preferred_time: "Yesterday",
    ai_decision: "accepted",
    ai_decision_reason: "Standard handyman job",
    quote_low: 100, quote_high: 300,
    summary: "Fan fixture replacement + drywall patch at 2211 Heights Blvd, 77008. David, yesterday. Completed 2h later.",
    vapi_call_id: "seed-preview-7", recording_url: null, transcript: null,
    status: "completed",
    confirmed_at: new Date(NOW - 300 * min).toISOString(),
    callback_initiated_at: null,
    created_at: new Date(NOW - 320 * min).toISOString(),
    updated_at: new Date(NOW - 60 * min).toISOString(),
  },
  "preview-rejected-2": {
    id: "preview-rejected-2", boss_id: "preview", customer_id: null,
    customer_name: "Robert Kim", customer_phone: "+17135558899",
    customer_address: "8899 Memorial Dr, Houston, TX", customer_zipcode: "77024",
    issue_type: "general",
    issue_details: "Need a full kitchen remodel — new cabinets, countertops, flooring, paint.",
    preferred_time: "Looking to start next month",
    ai_decision: "rejected",
    ai_decision_reason: "Out of scope — full kitchen remodel beyond handyman service",
    quote_low: null, quote_high: null,
    summary: "Full kitchen remodel request — beyond handyman scope. Referred to a general contractor.",
    vapi_call_id: "seed-preview-8", recording_url: null, transcript: null,
    status: "rejected", confirmed_at: null, callback_initiated_at: null,
    created_at: new Date(NOW - 60 * 26 * min).toISOString(),
    updated_at: new Date(NOW - 60 * 26 * min).toISOString(),
  },
};

export default function PreviewOrderDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const order = PREVIEW_ORDERS[id];

  if (!order) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Not found</h1>
        <a href="/preview" className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-block">
          ← Back to preview
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8">
      <a href="/preview" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to preview
      </a>

      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        👀 <strong>Static preview.</strong> Buttons below are non-functional. Set up Supabase + Vapi to make this live.
      </div>

      <div className="mt-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded border ${decisionColor(order.ai_decision)}`}>
              {decisionLabel(order.ai_decision)}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs rounded ${statusColor(order.status)}`}>
              {statusLabel(order.status)}
            </span>
            {order.issue_type && (
              <span className="text-xs text-gray-500 capitalize">· {order.issue_type}</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {order.summary || "Work order"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{formatDateTime(order.created_at)}</p>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600">
            📞 Call back {order.customer_phone}
          </button>
          {order.status === "pending" && (
            <>
              <button className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700">
                ✓ Confirm job
              </button>
              <button className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-md border border-gray-300 hover:bg-gray-50">
                ✕ Can't take it
              </button>
            </>
          )}
          {order.status === "confirmed" && (
            <button className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:bg-emerald-700">
              ✓ Mark completed
            </button>
          )}
        </div>
      </div>

      <Section title="Customer">
        <Field label="Name" value={order.customer_name || "—"} />
        <Field label="Phone" value={order.customer_phone} />
        <Field label="Address" value={order.customer_address || "—"} />
        <Field label="Zip code" value={order.customer_zipcode || "—"} />
      </Section>

      <Section title="Job details">
        <Field label="Issue type" value={order.issue_type || "—"} />
        <Field label="Details" value={order.issue_details || "—"} multiline />
        <Field label="Preferred time" value={order.preferred_time || "—"} />
        {order.quote_low && order.quote_high && (
          <Field
            label="Quote (reference)"
            value={`$${order.quote_low}–$${order.quote_high} + $89 diagnostic (goes toward repair)`}
          />
        )}
        {order.ai_decision_reason && (
          <Field label="AI decision reason" value={order.ai_decision_reason} />
        )}
      </Section>

      {order.transcript && order.transcript.length > 0 && (
        <Section title="Call transcript">
          <div className="bg-gray-50 rounded-md p-3 space-y-2 max-h-96 overflow-y-auto">
            {order.transcript.map((t, i) => (
              <div key={i} className={cn("flex gap-2 text-sm", t.role === "assistant" ? "" : "flex-row-reverse")}>
                <div
                  className={cn(
                    "inline-block px-3 py-1.5 rounded-lg max-w-[80%]",
                    t.role === "assistant" ? "bg-white border border-gray-200" : "bg-orange-100 text-orange-900",
                  )}
                >
                  {t.text}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {order.vapi_call_id && (
        <div className="mt-6 text-xs text-gray-400 font-mono">Vapi call: {order.vapi_call_id}</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase">{label}</div>
      <div className={cn("text-sm text-gray-900 mt-0.5", multiline && "whitespace-pre-wrap")}>{value}</div>
    </div>
  );
}
