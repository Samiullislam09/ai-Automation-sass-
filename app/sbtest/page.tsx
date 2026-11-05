"use client";
import { useState } from "react";
import { StoreProvider } from "@/lib/store";
import SiteBrainSection from "@/components/dashboard/SiteBrainSection";

const payload = {
  ok: true, schemaReady: true, pagesCrawled: 24, hasWebsite: true, version: 3,
  builtAt: "2026-11-05T10:00:00Z", builtBy: "agent", builtFrom: { pages: 24 },
  history: [{ id: "a", version: 3, created_at: "2026-11-05T10:00:00Z", created_by: "agent", active: true }, { id: "b", version: 2, created_at: "2026-10-01T10:00:00Z", created_by: "user", active: false }],
  profile: { site_type: "blog", what_they_do: "We run guided trips across Kashmir with local drivers and hotels.", audience: "Families and couples planning a 5-7 day holiday" },
};
export default function T() {
  const [ok] = useState(() => {
    if (typeof window !== "undefined") {
      const f = window.fetch;
      window.fetch = ((u: any, i?: any) => String(u).includes("/api/site-brain/status") ? Promise.resolve(new Response(JSON.stringify({ ok: true, jobs: null }))) : String(u).includes("/api/site-brain") ? Promise.resolve(new Response(JSON.stringify(payload))) : f(u, i)) as any;
    }
    return true;
  });
  return ok ? (
    <div className="lx-root flex" style={{ height: "100dvh", padding: 12 }}>
      <StoreProvider><div style={{ flex: 1, minWidth: 0 }}><SiteBrainSection /></div></StoreProvider>
    </div>
  ) : null;
}
