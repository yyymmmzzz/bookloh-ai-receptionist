"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase";
import { decisionLabel, decisionColor, statusLabel, statusColor, relativeTime, formatDateTime } from "@/lib/utils";
import type { WorkOrder } from "@/lib/types";

type DataSource = "demo" | "production" | "test";
type StatusFilter = "all" | "urgent" | "pending" | "callback";
type SourceFilter = "all" | DataSource;
type CountryFilter = "US" | "SEA" | "all";

const SOURCE_BADGE: Record<DataSource, { label: string; classes: string; emoji: string }> = {
  production: { label: "production", classes: "bg-green-50 text-green-700 border-green-200", emoji: "🟢" },
  test: { label: "test", classes: "bg-amber-50 text-amber-700 border-amber-200", emoji: "🟡" },
  demo: { label: "demo", classes: "bg-blue-50 text-blue-700 border-blue-200", emoji: "🟦" },
};

function DashboardPageInner() {
  const searchParams = useSearchParams();
  // Allow ?country=US|SEA|all to set initial filter (used by /sea route)
  const initialCountry: CountryFilter = (() => {
    const c = searchParams.get("country");
    return c === "SEA" || c === "all" ? c : "US";
  })();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>(initialCountry);

  useEffect(() => {
    const supabase = getBrowserClient();

    let query = supabase
      .from("work_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (countryFilter === "US") query = query.or("country.eq.US,country.is.null");
    else if (countryFilter === "SEA") query = query.in("country", ["SG", "MY", "ID"]);

    query.then(({ data, error }) => {
        if (error) {
          console.error("[dashboard] Failed to load work orders:", error);
        } else {
          setOrders((data || []) as WorkOrder[]);
        }
        setLoading(false);
      });

    // Subscribe to realtime updates — use a unique channel name per mount
    // to avoid the "postgres_changes after subscribe()" error in React strict mode
    const channelName = `work_orders_${countryFilter}_${Math.random().toString(36).slice(2, 10)}`;
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

  // Apply both filters (status + data source)
  const filtered = orders.filter((o) => {
    // Source filter
    if (sourceFilter !== "all") {
      if ((o.data_source || "production") !== sourceFilter) return false;
    }
    // Status filter (existing)
    if (filter === "all") return o.status !== "completed" && o.status !== "cancelled";
    if (filter === "urgent") return o.ai_decision === "urgent" || o.status === "urgent";
    if (filter === "pending") return o.status === "pending";
    if (filter === "callback") return o.status === "callback" || o.ai_decision === "unsure";
    return true;
  });

  // Stats (over ALL loaded data, not filtered — so users see real numbers)
  const stats = {
    total: orders.length,
    urgent: orders.filter((o) => o.ai_decision === "urgent" || o.status === "urgent").length,
    pending: orders.filter((o) => o.status === "pending").length,
    callback: orders.filter((o) => o.status === "callback" || o.ai_decision === "unsure").length,
  };

  // Source counts for the filter chips
  const sourceCounts = {
    all: orders.length,
    production: orders.filter((o) => (o.data_source || "production") === "production").length,
    demo: orders.filter((o) => o.data_source === "demo").length,
    test: orders.filter((o) => o.data_source === "test").length,
  };

  // Show the demo banner if any demo data is in the current view
  const showingDemo = sourceFilter === "all" || sourceFilter === "demo";
  const demoCount = sourceCounts.demo;
  const testCount = sourceCounts.test;
  const productionCount = sourceCounts.production;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {(showingDemo || testCount > 0) && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-3">
          <div className="text-amber-600 text-lg">ℹ️</div>
          <div className="flex-1 text-sm text-amber-900">
            <strong>数据来源说明:</strong>
            {sourceCounts.demo > 0 && <> <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border">🟦 demo ({demoCount})</span> 预填示例;</>}
            {sourceCounts.test > 0 && <> <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border">🟡 test ({testCount})</span> 回归测试;</>}
            {sourceCounts.production > 0 && <> <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border">🟢 production ({productionCount})</span> 真实通话。</>}
            <span className="block mt-1 text-xs">生产客户看演示时,可切到 <strong>仅 production</strong> 过滤。</span>
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

      {/* Country / Market filter — top-level tab to switch US vs SEA Test */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Market:</span>
        {(["US", "SEA", "all"] as CountryFilter[]).map((c) => {
          const active = countryFilter === c;
          return (
            <a
              key={c}
              href={c === "US" ? "/" : c === "SEA" ? "/sea" : "/?country=all"}
              className={`px-4 py-1.5 text-sm rounded-md border font-medium ${
                active
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {c === "US" ? "🇺🇸 US (Houston)" : c === "SEA" ? "🌏 SEA Test" : "🌍 All"}
            </a>
          );
        })}
      </div>

      {/* Data source filter */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Source:</span>
        {(["all", "production", "demo", "test"] as SourceFilter[]).map((s) => {
          const count = sourceCounts[s];
          const active = sourceFilter === s;
          const colorClass =
            s === "production"
              ? active ? "bg-green-600 text-white border-green-600" : "bg-white text-green-700 border-green-200 hover:bg-green-50"
              : s === "demo"
                ? active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-200 hover:bg-blue-50"
                : s === "test"
                  ? active ? "bg-amber-600 text-white border-amber-600" : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
                  : active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50";
          return (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 text-sm rounded-md border ${colorClass}`}
            >
              {s === "all" ? "All" : SOURCE_BADGE[s].label} <span className="ml-1 text-xs opacity-75">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Status:</span>
        {(["all", "urgent", "pending", "callback"] as StatusFilter[]).map((f) => (
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
        <EmptyState filter={filter} sourceFilter={sourceFilter} />
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
  const source = (order.data_source || "production") as DataSource;
  const badge = SOURCE_BADGE[source];
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
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded border ${badge.classes}`}
              title={`Data source: ${badge.label}`}
            >
              {badge.emoji} {badge.label}
            </span>
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

function EmptyState({ filter, sourceFilter }: { filter: string; sourceFilter: string }) {
  return (
    <div className="bg-white rounded-lg border border-dashed border-gray-300 p-12 text-center">
      <div className="text-4xl mb-3">📞</div>
      <h3 className="text-sm font-semibold text-gray-900">No work orders yet</h3>
      <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
        {sourceFilter !== "all" && `No ${sourceFilter} records matching `}
        {filter === "all" ? "this view." : `"${filter}".`}
        {sourceFilter === "production" && (
          <span className="block mt-2">Make a real call to +1 (724) 362-0422 to see production data here.</span>
        )}
        {sourceFilter === "all" && (
          <span className="block mt-2">When a customer calls your Vapi number, the AI will create a work order here.</span>
        )}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  // Wrap in Suspense because useSearchParams forces dynamic rendering
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}
