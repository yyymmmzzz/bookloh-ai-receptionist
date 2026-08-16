"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase";
import type { Boss } from "@/lib/types";

export default function ConfigPage() {
  const [boss, setBoss] = useState<Boss | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getBrowserClient()
      .from("bosses")
      .select("*")
      .limit(1)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("[config] load failed:", error);
        } else {
          setBoss(data as Boss);
        }
        setLoading(false);
      });
  }, []);

  async function save() {
    if (!boss) return;
    setSaving(true);
    setSaved(false);
    try {
      const { error } = await getBrowserClient()
        .from("bosses")
        .update({
          company_name: boss.company_name,
          owner_name: boss.owner_name,
          phone: boss.phone,
          service_base_zip: boss.service_base_zip,
          service_radius_miles: boss.service_radius_miles,
          service_trades: boss.service_trades,
          diagnostic_fee: boss.diagnostic_fee,
          routing_mode: boss.routing_mode,
          routing_ring_seconds: boss.routing_ring_seconds,
          whitelist_numbers: boss.whitelist_numbers,
          price_list: boss.price_list,
        })
        .eq("id", boss.id);
      if (error) throw error;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(`Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 text-gray-400">Loading...</div>;
  }

  if (!boss) {
    return <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 text-gray-400">No boss configured. Run the SQL seed.</div>;
  }

  const allTrades = ["plumbing", "electrical", "hvac", "handyman", "roofing", "general"];

  function toggleTrade(t: string) {
    if (!boss) return;
    setBoss({
      ...boss,
      service_trades: boss.service_trades.includes(t)
        ? boss.service_trades.filter((x) => x !== t)
        : [...boss.service_trades, t],
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <p className="text-sm text-gray-500 mt-1">
        Configure your business. Changes apply immediately.
      </p>

      <div className="mt-6 space-y-4">
        {/* Company */}
        <Card title="Company">
          <Row label="Company name">
            <input
              type="text"
              value={boss.company_name}
              onChange={(e) => setBoss({ ...boss, company_name: e.target.value })}
              className="input"
            />
          </Row>
          <Row label="Your name">
            <input
              type="text"
              value={boss.owner_name}
              onChange={(e) => setBoss({ ...boss, owner_name: e.target.value })}
              className="input"
            />
          </Row>
          <Row label="Callback phone (your cell)">
            <input
              type="tel"
              value={boss.phone}
              onChange={(e) => setBoss({ ...boss, phone: e.target.value })}
              className="input"
            />
          </Row>
        </Card>

        {/* Service area */}
        <Card title="Service area">
          <Row label="Base zip code">
            <input
              type="text"
              value={boss.service_base_zip}
              onChange={(e) => setBoss({ ...boss, service_base_zip: e.target.value })}
              className="input max-w-[120px]"
              maxLength={5}
            />
          </Row>
          <Row label="Radius (miles)">
            <input
              type="number"
              value={boss.service_radius_miles}
              onChange={(e) => setBoss({ ...boss, service_radius_miles: parseInt(e.target.value) || 0 })}
              className="input max-w-[120px]"
            />
          </Row>
          <Row label="Trades you accept">
            <div className="flex flex-wrap gap-2">
              {allTrades.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTrade(t)}
                  className={`px-3 py-1 text-sm rounded-full border ${
                    boss.service_trades.includes(t)
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </Card>

        {/* Pricing */}
        <Card title="Pricing">
          <Row label="Diagnostic / trip fee ($)">
            <input
              type="number"
              value={boss.diagnostic_fee}
              onChange={(e) => setBoss({ ...boss, diagnostic_fee: parseFloat(e.target.value) || 0 })}
              className="input max-w-[120px]"
            />
          </Row>
          <Row label="Reference price ranges ($ low – high)">
            <div className="space-y-2">
              {allTrades.filter((t) => boss.service_trades.includes(t)).map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 w-24 capitalize">{t}</span>
                  <input
                    type="number"
                    placeholder="low"
                    value={boss.price_list[t]?.low ?? ""}
                    onChange={(e) =>
                      setBoss({
                        ...boss,
                        price_list: {
                          ...boss.price_list,
                          [t]: { low: parseInt(e.target.value) || 0, high: boss.price_list[t]?.high || 0 },
                        },
                      })
                    }
                    className="input max-w-[100px]"
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="number"
                    placeholder="high"
                    value={boss.price_list[t]?.high ?? ""}
                    onChange={(e) =>
                      setBoss({
                        ...boss,
                        price_list: {
                          ...boss.price_list,
                          [t]: { low: boss.price_list[t]?.low || 0, high: parseInt(e.target.value) || 0 },
                        },
                      })
                    }
                    className="input max-w-[100px]"
                  />
                </div>
              ))}
            </div>
          </Row>
        </Card>

        {/* Routing */}
        <Card title="Call routing">
          <Row label="When should AI answer?">
            <select
              value={boss.routing_mode}
              onChange={(e) => setBoss({ ...boss, routing_mode: e.target.value as Boss["routing_mode"] })}
              className="input max-w-[260px]"
            >
              <option value="after_hours">After business hours only</option>
              <option value="always">Always (full-time AI)</option>
              <option value="busy">Only when line is busy</option>
            </select>
          </Row>
          <Row label="Ring seconds before forwarding to AI">
            <input
              type="number"
              value={boss.routing_ring_seconds}
              onChange={(e) => setBoss({ ...boss, routing_ring_seconds: parseInt(e.target.value) || 15 })}
              className="input max-w-[120px]"
              min={5}
              max={30}
            />
          </Row>
          <Row label="Whitelist numbers (ring you directly)">
            <textarea
              value={boss.whitelist_numbers.join("\n")}
              onChange={(e) =>
                setBoss({
                  ...boss,
                  whitelist_numbers: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="input min-h-[80px] font-mono text-sm"
              placeholder="+17135551111 (one per line)"
            />
          </Row>
        </Card>

        <div className="flex items-center gap-3 sticky bottom-0 bg-gray-50 py-4 -mx-4 px-4">
          <button
            onClick={save}
            disabled={saving}
            className="px-6 py-2 bg-orange-500 text-white text-sm font-semibold rounded-md hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          {saved && <span className="text-sm text-green-600">✓ Saved</span>}
        </div>
      </div>

      <style jsx>{`
        :global(.input) {
          @apply w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent;
        }
      `}</style>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}
