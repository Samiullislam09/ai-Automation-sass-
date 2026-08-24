"use client";
/**
 * lib/store.tsx — App state + demo engine.
 * PRODUCTION WIRING (see docs/AI_LOGIC.md + Build Guide):
 *  - Persistence: replace localStorage with Supabase (RLS) tables.
 *  - Pipeline: replace simulate() timers with agent-server jobs (BullMQ) + Socket.io events.
 *  - Chat: /api/chat already streams; swap canned brain for NVIDIA NIM (Lightning) call.
 *  - Payments: replace applyPlan() with Paddle/LemonSqueezy checkout + webhooks.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AGENTS } from "@/lib/agents-data";

export const TOKEN_COST: Record<string, number> = { article: 10, story: 4, social: 1 };
export const PLANS: Record<string, { name: string; price: number; tokens: number; tagline: string }> = {
  free:    { name: "Free",    price: 0,  tokens: 10,  tagline: "1 article/month — try the full experience" },
  starter: { name: "Starter", price: 5,  tokens: 120, tagline: "~10 articles + stories & posts every month" },
  growth:  { name: "Growth",  price: 15, tokens: 400, tagline: "Serious volume + priority writing model" },
};
// "live" agents have real backend wiring (agent-server queue jobs, see agent-server/src/agents/).
// The rest are visual roster slots for now (roadmap placeholders) — shown in the office same as
// the reference "AI Command Center" layout, but their status stays "idle"/decorative until a real
// agent is built for them. Not faked as working; see Office.tsx's room tag for how this is signaled.
// Lives in lib/agents-data.ts (a plain, non-"use client" module) so server-only code
// (lib/dashboard-data.ts) can import the same array without crashing — see that file's comment.
export { AGENTS };
const TOPICS = [
  "How to Get More Local Customers in 2026",
  "10 Mistakes Small Businesses Make Online",
  "The Complete Beginner's Guide to SEO",
  "Why Your Website Isn't Bringing Sales (And How to Fix It)",
];

// w = working, i = idle, o = off/not built yet, e = last real job failed (jobs_log 'error').
export type AgentState = { st: "w" | "i" | "o" | "e"; task: string };
export type ContentItem = { id: number; type: string; title: string; status: string; time: string; tokens: number };
export type Report = { id: number; key: string; dateISO: string; unread: boolean; lines: { t: string; s: string }[] };
export type Mem = { k: string; v: string };
export type Activity = { t: string; from?: string; to?: string; msg: string };

type State = {
  user: { name: string; email: string } | null;
  onboarded: boolean; plan: string; tokens: number; tokensMax: number;
  memory: Mem[]; content: ContentItem[]; reports: Report[]; activity: Activity[];
  agents: Record<string, AgentState>; busy: boolean;
  // Live server truth, filled by components/LiveAgents.tsx (one poll shared by the whole
  // /app shell) so the office, the stat row and the chat all read the same thing.
  stats: Record<string, number> | null;
  recentJobs: { id: string; agentId?: string; task: string; status: string; at: string; summary: string; items: string[] }[];
  /** "this agent just finished/failed X" — the office shows it over that room for a moment. */
  flash: { id: string; text: string; tone?: "done" | "error" } | null;
  /** The full-screen "it's done" takeover (components/Celebration.tsx). Holds the real
   *  jobs_log row that just landed — summary and items as the agent returned them. */
  celebration: { id: string; agentId: string; status: string; summary: string; items: string[] } | null;
  /** The site crawl while it runs. It has no room in the office and takes ~10 minutes, so
   *  without this there is nowhere to see that anything is happening at all. */
  crawl: { phase: string; done: number; total: number; current: string | null; label: string | null; startedAt: string } | null;
  /** Finished-job announcements for the chat. Mr Lxwa confirms the work in the conversation
   *  itself — a toast that has already faded is not an answer to "did it happen?". */
  chatNotices: { id: string; text: string; tone: "done" | "error" }[];
  liveError: string | null;
  focusAgent: string | null; // which office room the camera should zoom to (Office.tsx reads this)
  onboardedChecked: boolean; // true once we've actually asked Supabase — see AppLayout's guard
};
const initial: State = {
  user: null, onboarded: false, plan: "free", tokens: 10, tokensMax: 10,
  memory: [], content: [], reports: [], activity: [],
  agents: Object.fromEntries(AGENTS.map(a => [a.id, a.live ? { st: "i", task: "Idle" } : { st: "o", task: "Coming soon" }])) as any,
  busy: false, focusAgent: null, onboardedChecked: false,
  stats: null, recentJobs: [], flash: null, celebration: null, crawl: null, chatNotices: [], liveError: null,
};

const Ctx = createContext<any>(null);
export const useStore = () => useContext(Ctx);
const nowT = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State>(initial);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const loaded = useRef(false);

  // persistence — TODO(backend): replace with Supabase
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gt-state");
      // Live fields are server truth — never restore yesterday's copy of them from localStorage,
      // or the office shows an agent "working" on a job that finished hours ago.
      if (raw) setS({ ...initial, ...JSON.parse(raw), stats: null, recentJobs: [], flash: null, celebration: null, crawl: null, chatNotices: [], liveError: null });
    } catch {}
    loaded.current = true;
  }, []);
  useEffect(() => { if (loaded.current) try { localStorage.setItem("gt-state", JSON.stringify(s)); } catch {} }, [s]);

  // real identity — user + onboarded status come from Supabase (source of truth), not
  // just local browser state, so a new browser/session doesn't re-ask the wizard.
  // Memory/content are still local demo state — TODO(backend): wire once the real
  // content pipeline (agent-server, Step 9+) lands.
  useEffect(() => {
    const supabase = createClient();
    const toUser = (u: { email?: string | null } | null | undefined) =>
      u?.email ? { name: u.email.split("@")[0].replace(/^\w/, (c: string) => c.toUpperCase()), email: u.email } : null;

    const syncFromSession = async (u: { id: string; email?: string | null } | null | undefined) => {
      setS(prev => ({ ...prev, user: toUser(u) }));
      if (!u) { setS(prev => ({ ...prev, onboardedChecked: true })); return; }
      try {
        const { data, error } = await supabase
          .from("memberships")
          .select("tenants(onboarded)")
          // A user with two memberships made maybeSingle() error out, and the error was
          // ignored — which read as "not onboarded". limit(1) matches getCurrentTenantId().
          .limit(1)
          .maybeSingle();

        // "The query failed" is not "this account is new". The redirect lives on the server
        // now (app/app/layout.tsx), but this flag still drives UI, and inferring false from a
        // failed read is exactly the mistake that sent finished accounts back to the wizard.
        if (error) {
          console.error("[store] onboarded lookup failed:", error.message);
        } else {
          const onboarded = !!(data as any)?.tenants?.onboarded;
          setS(prev => ({ ...prev, onboarded, onboardedChecked: true }));
        }

        // The team's memory now lives in the DB (migration 010) instead of localStorage,
        // which signing out deletes — that's why logging out looked like it erased
        // everything the team had learned.
        fetch("/api/memory")
          .then((r) => r.json())
          .then((d) => { if (d?.ok && Array.isArray(d.facts)) setS(prev => ({ ...prev, memory: d.facts })); })
          .catch(() => {});

        // The plan is fetched separately, NOT added to the select above: `plan` only exists
        // after migration 009, and asking for a missing column fails the whole row read —
        // which would read as "not onboarded" and bounce a real user back into the wizard.
        // The DB is still the source of truth here, so a fresh browser doesn't show "Free"
        // to someone who is paying (and being rationed accordingly by agent-server).
        fetch("/api/plan")
          .then((r) => r.json())
          .then((d) => {
            if (d?.ok && d.plan && PLANS[d.plan]) {
              setS(prev => ({ ...prev, plan: d.plan, tokensMax: PLANS[d.plan].tokens }));
            }
          })
          .catch(() => {});
      } catch {
        // transient network hiccup — keep whatever local state already had rather than
        // wrongly bouncing an already-onboarded user back into the wizard. Also don't mark
        // "checked" here — AppLayout's guard waits for a real answer, not a failed one.
      }
    };

    supabase.auth.getUser().then(({ data }) => syncFromSession(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      syncFromSession(session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const toast = (msg: string) => { const id = Date.now(); setToasts(t => [...t, { id, msg }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200); };
  const patch = (p: Partial<State> | ((prev: State) => Partial<State>)) => setS(prev => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) }));

  const act = (msg: string, from?: string, to?: string) =>
    patch(prev => ({ activity: [{ t: nowT(), from, to, msg }, ...prev.activity].slice(0, 40) }));

  const setAgent = (id: string, st: AgentState["st"], task: string) =>
    patch(prev => ({ agents: { ...prev.agents, [id]: { st, task } } }));

  /** Tells the office camera (components/Office.tsx) to zoom to an agent's room —
   *  called from chat (kit.tsx BossChat) when the user asks about a specific agent,
   *  and from clicking a room directly. Auto-resets after holdMs unless re-triggered. */
  const focusTokenRef = useRef(0);
  const focusOn = (id: string | null, holdMs = 3400) => {
    const myToken = ++focusTokenRef.current;
    patch({ focusAgent: id });
    if (id && holdMs > 0) {
      setTimeout(() => { if (focusTokenRef.current === myToken) patch({ focusAgent: null }); }, holdMs);
    }
  };

  const report = (line: string) => patch(prev => {
    const key = new Date().toDateString();
    const reports = [...prev.reports];
    let r = reports.find(x => x.key === key);
    if (!r) { r = { id: Date.now(), key, dateISO: new Date().toISOString(), unread: true, lines: [] }; reports.unshift(r); }
    r.lines = [...r.lines, { t: nowT(), s: line }]; r.unread = true;
    return { reports };
  });

  /** Demo pipeline — TODO(backend): replace with agent-server jobs + Socket.io */
  const generate = (type: string, onStage?: (i: number) => void, onDone?: () => void) => {
    const cost = TOKEN_COST[type];
    const title = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    patch({ busy: true }); // unlimited/free for now — no token deduction
    const stages: [number, () => void][] = type === "article" ? [
      [500,  () => { setAgent("kw", "w", "Validating keyword…"); act(`"Validate <b>${title}</b> and pull related queries, please."`, "Mr Lxwa", "Mr. Keyword"); onStage?.(0); }],
      [2100, () => { setAgent("kw", "i", "Idle"); setAgent("seo", "w", "Analyzing top 10…"); act(`"Topic is strong — 8 related queries found."`, "Mr. Keyword", "Mr Lxwa"); onStage?.(1); }],
      [3700, () => { setAgent("seo", "i", "Idle"); act(`"Blueprint ready — 3 titles, 9 sections, target 1,850 words."`, "Mr Lxwa"); onStage?.(2); }],
      [5300, () => { setAgent("writer", "w", "Writing section 4 of 9…"); act(`"Blueprint attached. Begin."`, "Mr Lxwa", "Mr. Writer"); onStage?.(3); }],
      [6900, () => { setAgent("writer", "i", "Idle"); setAgent("boss", "w", "Quality gate…"); act(`"Draft complete — 1,920 words. Over to you."`, "Mr. Writer", "Mr Lxwa"); onStage?.(4); }],
      [8300, () => { setAgent("boss", "i", "Monitoring team"); act(`"Quality gate passed ✓ — <b>${title}</b> is in your approval queue."`, "Mr Lxwa"); finish(); }],
    ] : [
      [400,  () => { const ag = type === "story" ? "story" : "social"; setAgent(ag, "w", type === "story" ? "Designing frames…" : "Writing copy…"); act(`"New ${type} for <b>${title}</b> — please begin."`, "Mr Lxwa", ag === "story" ? "Mr. Story" : "Miss Social"); }],
      [3000, () => { const ag = type === "story" ? "story" : "social"; setAgent(ag, "i", "Idle"); act(`"Done — sending for your review."`, ag === "story" ? "Mr. Story" : "Miss Social", "Mr Lxwa"); finish(); }],
    ];
    function finish() {
      patch(prev => ({ busy: false, content: [{ id: Date.now(), type, title, status: "awaiting", time: nowT(), tokens: cost }, ...prev.content] }));
      report(`Produced a new ${type}: "${title}" (⚡${cost}) — awaiting approval`);
      toast("Ready for your approval: " + title.slice(0, 34) + "…");
      onDone?.();
    }
    stages.forEach(([ms, fn]) => setTimeout(fn, ms));
    return title;
  };

  const approve = (id: number) => patch(prev => {
    const c = prev.content.find(x => x.id === id); if (!c) return {};
    act(`"It's live. Prepare distribution."`, "Mr Lxwa", "Miss Social");
    setTimeout(() => report(`Published after your approval: "${c.title}"`), 0);
    toast("Published! Your team is distributing it.");
    return { content: prev.content.map(x => x.id === id ? { ...x, status: "published" } : x) };
  });
  const reject = (id: number) => patch(prev => {
    const c = prev.content.find(x => x.id === id); if (!c) return {};
    act(`"Understood. We'll adjust and learn from this."`, "Mr Lxwa");
    setTimeout(() => report(`Rejected by you (team will adjust): "${c.title}"`), 0);
    return { content: prev.content.map(x => x.id === id ? { ...x, status: "rejected" } : x) };
  });
  /** Single writer for the memory list: update the screen immediately, persist behind it,
   *  and put the old list back if the write fails — so what you see is never a fact that
   *  quietly failed to save. */
  const saveMemory = async (facts: Mem[]) => {
    let previous: Mem[] = [];
    setS(prev => { previous = prev.memory; return { ...prev, memory: facts }; });
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? "save failed");
      if (Array.isArray(data.facts)) setS(prev => ({ ...prev, memory: data.facts }));
    } catch (e: any) {
      console.error("[store] memory not saved:", e?.message);
      setS(prev => ({ ...prev, memory: previous }));
      toast("Memory save nahi hua — dobara try karo.");
    }
  };

  const applyPlan = (plan: string) => { // TODO(backend): Paddle/LemonSqueezy webhook drives this
    // The plan has to reach the DB, not just this browser: agent-server reads tenants.plan to
    // decide the tenant's daily allowance, so a plan that only lived in localStorage meant a
    // paying customer was rationed exactly like a free trial. Fire-and-forget — the UI below
    // is unchanged either way, and /api/plan reports its own failure.
    fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) })
      .then((r) => r.json())
      .then((d) => { if (!d?.ok) console.error("[store] plan not saved server-side:", d?.error); })
      .catch((e) => console.error("[store] plan not saved server-side:", e?.message));

    patch({ plan, tokensMax: PLANS[plan].tokens, tokens: PLANS[plan].tokens });
    act(`"We're on the <b>${PLANS[plan].name}</b> plan now — capacity increased. Let's grow. 🚀"`, "Mr Lxwa");
    report(`Plan changed to ${PLANS[plan].name} — token allowance now ${PLANS[plan].tokens}/month`);
    toast(PLANS[plan].name + " activated!");
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setS(initial);
    try { localStorage.removeItem("gt-state"); } catch {}
    location.href = "/login";
  };

  const api = { s, patch, toast, act, setAgent, focusOn, report, generate, approve, reject, applyPlan, saveMemory, signOut };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toastwrap">{toasts.map(t => <div key={t.id} className="toast">✓ {t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}
