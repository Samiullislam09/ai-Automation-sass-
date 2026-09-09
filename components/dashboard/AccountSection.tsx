"use client";
import { useEffect, useState, type ElementType } from "react";
import Link from "next/link";
import { Mail, CalendarDays, Globe, Briefcase, CheckCircle2, Link2, ListChecks, Sparkles } from "lucide-react";
import { PLANS } from "@/lib/store";

/** /dashboard/account, top half. Every field here is fetched fresh from app/api/account/route.ts
 *  on mount (never a cached/localStorage copy, never a placeholder): email, workspace name, real
 *  website, business type, plan, today's per-agent usage against agent-server's own cap table,
 *  connected integrations, awaiting approvals. Built because the only account info anywhere in
 *  the product was a two-line sidebar chip (name + plan) that could disagree with the database
 *  (owner report 2026-09-09: "user ka jayda se jayda details ... 100% accurate ... har bar check
 *  karke real data aaye"). Redesigned 2026-09-09 (owner: "ye UI pasand nahi aya, user friendly
 *  best UI UX") away from a grid of tiny all-caps boxed labels into one profile header plus
 *  clean icon-led rows — the same shape a real SaaS account page uses. BillingSection (rendered
 *  below this, by app/dashboard/account/page.tsx) still owns the plan-change/checkout flow. */

type AccountData = {
  ok: boolean;
  email: string | null;
  memberSince: string | null;
  role: string | null;
  workspace: string | null;
  website: string | null;
  businessType: string | null;
  tenantCreatedAt: string | null;
  onboarded: boolean;
  plan: string | null;
  connected: number;
  awaiting: number;
};

type UsageItem = { agent: string; label: string; used: number; cap: number | null };

const dateFmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;

export default function AccountSection() {
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = still loading, [] = loaded and genuinely empty. Kept separate from `data` — see
  // app/api/account/usage/route.ts's header for why this is its own call.
  const [usage, setUsage] = useState<UsageItem[] | null>(null);

  const load = () => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.ok) { setData(d); setError(null); } else setError(d?.error ?? "Could not load your account."); })
      .catch((e) => setError(e?.message ?? "Could not load your account."));
    setUsage(null);
    fetch("/api/account/usage", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setUsage(d?.ok ? d.usage : []))
      .catch(() => setUsage([]));
  };
  useEffect(load, []);

  const plan = data?.plan ? PLANS[data.plan] : null;
  const initial = (data?.workspace || data?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="space-y-4" style={{ maxWidth: 820 }}>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Account</h1>
        <button className="lx-ghost lx-10" onClick={load}>Refresh</button>
      </div>

      {error && <div className="lx-card2 p-4 lx-11" style={{ color: "#f87171" }}>{error}</div>}
      {!data && !error && <div className="lx-card2 p-4 lx-11 lx-mut">Loading your account…</div>}

      {data && (
        <>
          {/* profile header — the one thing every account page leads with: who you are, and
              your plan, at a glance. Everything below is detail on this. */}
          <div className="lx-card2 flex flex-wrap items-center gap-4 p-4">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
              style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444 60%,#7c3aed)" }}
            >
              {initial}
            </span>
            <div className="min-w-0 flex-1 basis-52">
              <div className="lx-12 font-bold truncate">{data.workspace || data.email}</div>
              <div className="lx-11 truncate" style={{ color: "#9a9ab2" }}>{data.email}</div>
            </div>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 lx-11 font-bold text-white"
              style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed 55%,#8b5cf6)", boxShadow: "0 4px 16px rgba(124,58,237,.35)" }}
            >
              <Sparkles size={13} /> {plan?.name ?? data.plan ?? "Unknown"} plan
            </span>
          </div>

          {/* plan + usage sits right under the profile header — the two things you open this
              page to check first (owner: "heysamiul wagera ke niche ye tab do"). */}
          <div className="lx-card2 p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="lx-11 font-semibold">Your plan</div>
              <Link href="#plans" className="lx-ghost lx-10">Change plan</Link>
            </div>
            {plan && <div className="lx-11" style={{ color: "#9a9ab2" }}>{plan.tagline}</div>}
            {data.plan === null && <div className="lx-11 mt-0.5" style={{ color: "#9a9ab2" }}>Not stored yet — an admin needs to run migration 009.</div>}

            {(usage === null || usage.length > 0) && (
              <div className="mt-3.5 space-y-3 border-t pt-3.5" style={{ borderColor: "var(--lx-border)" }}>
                <div className="lx-10" style={{ color: "#9a9ab2" }}>Today's usage</div>
                {usage === null
                  ? <div className="lx-11" style={{ color: "#9a9ab2" }}>Loading…</div>
                  : usage.map((u) => <UsageRow key={u.agent} label={u.label} used={u.used} cap={u.cap} />)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="lx-card2 p-4">
              <div className="lx-11 font-semibold mb-2.5">Your business</div>
              <div className="space-y-2.5">
                <InfoRow icon={Globe} label="Website" value={data.website ?? "Not connected"} />
                <InfoRow icon={Briefcase} label="Business type" value={data.businessType ?? "Not identified yet"} />
                <InfoRow icon={CheckCircle2} label="Onboarding" value={data.onboarded ? "Complete" : "Not finished"} good={data.onboarded} />
                <InfoRow icon={CalendarDays} label="Workspace created" value={dateFmt(data.tenantCreatedAt) ?? "—"} />
              </div>
            </div>

            <div className="lx-card2 p-4">
              <div className="lx-11 font-semibold mb-2.5">This account</div>
              <div className="space-y-2.5">
                <InfoRow icon={Mail} label="Signed in as" value={data.email ?? "—"} />
                <InfoRow icon={CalendarDays} label="Member since" value={dateFmt(data.memberSince) ?? "—"} />
                <InfoRow icon={Link2} label="Connected integrations" value={String(data.connected)} />
                <InfoRow icon={ListChecks} label="Awaiting your approval" value={String(data.awaiting)} warn={data.awaiting > 0} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon, label, value, warn, good,
}: {
  icon: ElementType; label: string; value: string; warn?: boolean; good?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} style={{ color: "#7a7a94", flexShrink: 0 }} />
      <span className="lx-11 flex-1 min-w-0" style={{ color: "#9a9ab2" }}>{label}</span>
      <span
        className="lx-11 font-semibold truncate text-right"
        style={{ color: warn ? "#f59e0b" : good ? "#4ade80" : undefined, maxWidth: "55%" }}
      >
        {value}
      </span>
    </div>
  );
}

function UsageRow({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const full = cap != null && used >= cap;
  return (
    <div>
      <div className="flex items-center justify-between lx-11">
        <span>{label}</span>
        <span className="font-semibold" style={{ color: full ? "#f87171" : undefined }}>
          {cap != null ? `${used} / ${cap}` : used}
        </span>
      </div>
      {cap != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: "var(--lx-border)" }}>
          <i className="block h-full rounded-full" style={{ background: full ? "#f87171" : "linear-gradient(90deg,#2563eb,#22d3ee)", width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
