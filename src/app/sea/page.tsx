/**
 * /sea — Southeast Asia test dashboard
 *
 * Same component as the US dashboard (/), but defaults to filtering
 * records by country in ('SG', 'MY', 'ID'). Use this URL when demoing
 * SEA market support to investors without mixing in US records.
 *
 * Implementation note: this is a thin wrapper that forces
 * ?country=SEA so we don't duplicate the dashboard component.
 */
"use client";

import { useSearchParams } from "next/navigation";
import DashboardPage from "@/app/page";
import { Suspense } from "react";

function DashboardWithCountry() {
  const params = useSearchParams();
  // Forward ?country=SEA to the main dashboard
  const merged = new URLSearchParams(params.toString());
  merged.set("country", "SEA");
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", `/sea?${merged.toString()}`);
  }
  return <DashboardPage />;
}

export default function SeaDashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardWithCountry />
    </Suspense>
  );
}
