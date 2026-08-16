"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase";
import { decisionLabel, decisionColor, statusLabel, statusColor, relativeTime, formatDateTime } from "@/lib/utils";
import type { WorkOrder } from "@/lib/types";

export default function DashboardPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "urgent" | "pending" | "callback">("all");

  useEffect(() => {
    const supabase = getBrowserClient();

    // Initial fetch
    supabase
      .from("work_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) {
          console.error("[dashboard] Failed to load work orders:", error);
        } else {
          setOrders((data || []) as WorkOrder[]);
        }
        setLoading(false);
      });

    // Subscribe to realtime updates — use a unique channel name per mount
    // to avoid the "postgres_changes after subscribe()" error in React strict mode
    const channelName = `work_orders_${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_orders" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setOrders((prev) => [payload.new as WorkOrder, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setOrders((prev) =>
              prev.map((o) => (o.id === (payload.new as WorkOrder).id ? (payload.new as WorkOrder) : o)),
            );
          } else if (payload.eventType === "DELETE") {
            setOrders((prev) => prev.filter((o) => o.id !== (payload.old as WorkOrder).id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = orders.filter((o) => {
    if (filter === "all") return o.status !== "completed" && o.status !== "cancelled";
    if (filter === "urgent") return o.ai_decision === "urgent" || o.status === "urgent";
    if (filter === "pending") return o.status === "pending";
    if (filter === "callback") return o.status === "callback" || o.ai_decision === "unsure";
    return true;
  });

  const stats = {
    total: orders.length,
    urgent: orders.filter((o) => o.ai_decision === "urgent" || o.status === "urgent").length,
    pending: orders.filter((o) => o.status === "pending").length,
    callback: orders.filter((o) => o.status === "callback" || o.ai_decision === "unsure").length,
  };

  // Detect demo data so we can show a banner
  const hasDemoData = orders.some((o) => o.vapi_call_id?.startsWith("seed-") || o.vapi_call_id?.startsWith("sim-"));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {hasDemoData && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-3">
          <div className="text-amber-600 text-lg">⚠️</div>
          <div className="flex-1 text-sm text-amber-900">
            <strong>Demo data.</strong> These work orders were seeded for testing. Once you connect Vapi, real calls will appear here.
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
          <p className="text-sm text-gray-500 mt-1">
            Live feed of calls handled by the AI receptionist
          </p>
        </div>
        <div className="text-xs text-gray-400">
          {orders.length > 0 && `${orders.length} total`}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total calls" value={stats.total} />
        <StatCard label="Urgent" value={stats.urgent} accent="red" />
        <StatCard label="Pending" value={stats.pending} accent="blue" />
        <StatCard label="Callback" value={stats.callback} accent="amber" />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-4">
        {(["all", "urgent", "pending", "callback"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md border ${
              filter === f
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-2">
          {filtered.map((order) => (
            <WorkOrderRow key={order.id} order={order} />
          ))}
        </div>
      )}
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

function WorkOrderRow({ order }: { order: WorkOrder }) {
  return (
    <Link
      href={`/orders/${order.id}`}
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
            {order.pricing_breakdown ? (
              <span
                className="text-xs text-gray-700 font-medium"
                title={
                  order.pricing_breakdown.fuel_surcharge > 0
                    ? `Includes $${order.pricing_breakdown.trip_fee} trip + $${order.pricing_breakdown.fuel_surcharge} fuel surcharge (${order.pricing_breakdown.distance_miles} mi from base)`
                    : `Includes $${order.pricing_breakdown.trip_fee} trip fee`
                }
              >
                ${order.pricing_breakdown.total_low}–${order.pricing_breakdown.total_high}
                {order.pricing_breakdown.fuel_surcharge > 0 && (
                  <span className="ml-1 text-amber-600">⛽</span>
                )}
              </span>
            ) : order.quote_low && order.quote_high ? (
              <span className="text-xs text-gray-700 font-medium">
                ${order.quote_low}–${order.quote_high}
              </span>
            ) : null}
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
    </Link>
  );
}

function EmptyState({ filter }: { filter: string }) {
  return (
    <div className="bg-white rounded-lg border border-dashed border-gray-300 p-12 text-center">
      <div className="text-4xl mb-3">📞</div>
      <h3 className="text-sm font-semibold text-gray-900">No work orders yet</h3>
      <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
        {filter === "all"
          ? "When a customer calls your Vapi number, the AI will create a work order here. Make a test call to get started."
          : `No work orders matching "${filter}".`}
      </p>
    </div>
  );
}
