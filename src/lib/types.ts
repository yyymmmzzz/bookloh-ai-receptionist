// Core TypeScript types for the demo

export type IssueType = "plumbing" | "electrical" | "hvac" | "handyman" | "roofing" | "general";

export type AIDecision = "accepted" | "urgent" | "unsure" | "rejected";

export type WorkOrderStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "callback"
  | "urgent"
  | "completed"
  | "cancelled";

export interface Boss {
  id: string;
  company_name: string;
  owner_name: string;
  phone: string;
  service_base_address: string | null;
  service_base_zip: string;
  service_radius_miles: number;
  service_trades: string[];
  diagnostic_fee: number;
  // Pricing for distance-based surcharge
  free_distance_miles: number;       // miles within base before surcharge kicks in
  distance_surcharge_per_mile: number; // $ per mile beyond free_distance_miles
  business_hours: BusinessHours;
  timezone: string;
  price_list: PriceList;
  service_zip_prefixes: string[];
  vapi_assistant_id: string | null;
  twilio_phone_number: string | null;
  faq: Record<string, string>;
  routing_mode: "after_hours" | "always" | "busy";
  routing_ring_seconds: number;
  whitelist_numbers: string[];
}

export interface PricingBreakdown {
  trip_fee: number;
  fuel_surcharge: number;        // $0 if within free distance
  total_trip_fee: number;        // trip_fee + fuel_surcharge
  range_low: number;
  range_high: number;
  total_low: number;             // range_low + total_trip_fee
  total_high: number;            // range_high + total_trip_fee
  distance_miles: number | null; // null when we couldn't compute distance
  free_distance_miles: number;
  surcharge_per_mile: number;
}

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface BusinessHours {
  [day: string]: { start: string; end: string } | null;
}

export interface PriceList {
  [trade: string]: { low: number; high: number };
}

export interface Customer {
  id: string;
  boss_id: string;
  phone: string;
  name: string | null;
  address: string | null;
  zipcode: string | null;
  notes: string | null;
  total_jobs: number;
  created_at: string;
  updated_at: string;
}

export interface WorkOrder {
  id: string;
  boss_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_address: string | null;
  customer_zipcode: string | null;
  issue_type: IssueType | null;
  issue_details: string | null;
  preferred_time: string | null;
  ai_decision: AIDecision;
  ai_decision_reason: string | null;
  quote_low: number | null;
  quote_high: number | null;
  pricing_breakdown?: PricingBreakdown | null;
  summary: string | null;
  vapi_call_id: string | null;
  recording_url: string | null;
  transcript: TranscriptEntry[] | null;
  status: WorkOrderStatus;
  confirmed_at: string | null;
  callback_initiated_at: string | null;
  // Emergency outbound call tracking
  outbound_attempts?: number;
  last_outbound_at?: string | null;
  outbound_call_id?: string | null;
  boss_decision?: "callback_initiated" | "queued" | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  text: string;
  ts?: number;
}

// =====================================================
// Vapi Webhook payload types (subset we care about)
// See: https://docs.vapi.ai/server-url
// =====================================================

export interface VapiWebhookPayload {
  message: {
    type:
      | "status-update"
      | "transcript"
      | "tool-calls"
      | "end-of-call-report"
      | "conversation-update"
      | "function-call"
      | "speech-update"
      | "hang"
      | "transfer-destination-request";

    // Status update fields
    status?: "queued" | "ringing" | "in-progress" | "forwarding" | "ended" | "failed" | "busy" | "no-answer";

    // Call info
    call?: {
      id: string;
      orgId: string;
      assistantId?: string;
      type?: "inboundPhoneCall" | "outboundPhoneCall" | "webCall";
      phoneNumberId?: string;
      customer?: { number: string; name?: string };
      startedAt?: string;
      endedAt?: string;
      endedReason?: string;
      cost?: number;
      recordingUrl?: string;
      transcript?: string;
    };

    // Transcript fields
    transcript?: string;
    role?: "user" | "assistant" | "system";

    // Tool calls (Vapi sends both; toolCallList is the "completed" list with results)
    toolCalls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
      };
    }>;
    toolCallList?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
      };
    }>;

    // End of call report
    summary?: string;
    transcript_combined?: string;
    messages?: Array<{
      role: "user" | "assistant" | "system" | "tool";
      message?: string;
      content?: string;
      time?: number;
      toolCalls?: Array<{
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
      }>;
    }>;
    analysis?: {
      summary?: string;
      successEvaluation?: string;
      structuredData?: Record<string, unknown>;
    };
  };
}

// =====================================================
// Function call tool result types
// =====================================================

export interface ValidateServiceArgs {
  zipcode: string;
  issue_type: IssueType;
}

export interface ValidateServiceResult {
  ok: boolean;
  reason?: string;
  distance_miles?: number;
}

export interface GetPriceQuoteArgs {
  issue_type: IssueType;
}

export interface GetPriceQuoteResult {
  available: boolean;
  trip_fee: number;
  fuel_surcharge: number;
  total_trip_fee: number;
  distance_miles: number | null;
  range?: { low: number; high: number };
  total_low?: number;
  total_high?: number;
}
