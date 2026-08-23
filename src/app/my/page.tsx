/**
 * /my — Malaysia dashboard
 *
 * Same component as the US dashboard (/), but defaults to filtering
 * records by country = 'MY'. Use this URL when demoing MY market support
 * to investors without mixing in US or SG records.
 */
"use client";

import { useSearchParams } from "next/navigation";
import DashboardPage from "@/app/page";
import { Suspense } from "react";

function DashboardWithCountry() {
  const params = useSearchParams();
  const merged = new URLSearchParams(params.toString());
  merged.set("country", "MY");
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", `/my?${merged.toString()}`);
  }
  return <DashboardPage />;
}

export default function MyDashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardWithCountry />
    </Suspense>
  );
}
