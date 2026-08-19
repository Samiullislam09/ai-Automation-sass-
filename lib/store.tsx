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

export const TOKEN_COST: Record<string, number> = { article: 10, story: 4, social: 1 };
export const PLANS: Record<string, { name: string; price: number; tokens: number; tagline: string }> = {
  free:    { name: "Free",    price: 0,  tokens: 10,  tagline: "1 article/month — try the full experience" },
  starter: { name: "Starter", price: 5,  tokens: 120, tagline: "~10 articles + stories & posts every month" },
  growth:  { name: "Growth",  price: 15, tokens: 400, tagline: "Serious volume + priority writing model" },
};
export const AGENTS = [
  { id: "boss",   name: "Boss AI",     role: "Orchestrator",     ico: "🧠", c: "#17a98c" },
  { id: "kw",     name: "Mr. Keyword", role: "Keyword Research", ico: "🔎", c: "#6ea8ff" },
  { id: "writer", name: "Mr. Writer",  role: "Article Writer",   ico: "✍️", c: "#b48bff" },
  { id: "story",  name: "Mr. Story",   role: "Stories & Images", ico: "🎨", c: "#ff8fb3" },
  { id: "social", name: "Miss Social", role: "Social Media",     ico: "📣", c: "#ffb95e" },
  { id: "seo",    name: "Mr. SEO",     role: "SEO & Site Care",  ico: "📈", c: "#7ee787" },
];
const TOPICS = [
  "How to Get More Local Customers in 2026",
  "10 Mistakes Small Businesses Make Online",
  "The Complete Beginner's Guide to SEO",
  "Why Your Website Isn't Bringing Sales (And How to Fix It)",
];

export type AgentState = { st: "w" | "i" | "o"; task: string };
export type ContentItem = { id: number; type: string; title: string; status: string; time: string; tokens: number };
export type Report = { id: number; key: string; dateISO: string; unread: boolean; lines: { t: string; s: string }[] };
export type Mem = { k: string; v: string };
export type Activity = { t: string; from?: string; to?: string; msg: string };

type State = {
  user: { name: string; email: string } | null;
  onboarded: boolean; plan: string; tokens: number; tokensMax: number;
  memory: Mem[]; content: ContentItem[]; reports: Report[]; activity: Activity[];
  agents: Record<string, AgentState>; busy: boolean;
};
const initial: State = {
  user: null, onboarded: false, plan: "free", tokens: 10, tokensMax: 10,
  memory: [], content: [], reports: [], activity: [],
  agents: Object.fromEntries(AGENTS.map(a => [a.id, { st: "i", task: "Idle" }])) as any,
  busy: false,
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
    try { const raw = localStorage.getItem("gt-state"); if (raw) setS({ ...initial, ...JSON.parse(raw) }); } catch {}
    loaded.current = true;
  }, []);
  useEffect(() => { if (loaded.current) try { localStorage.setItem("gt-state", JSON.stringify(s)); } catch {} }, [s]);

  // real identity — TODO(backend Step 4): onboarded/memory/content still local demo state until DB-wired
  useEffect(() => {
    const supabase = createClient();
    const toUser = (u: { email?: string | null } | null | undefined) =>
      u?.email ? { name: u.email.split("@")[0].replace(/^\w/, (c: string) => c.toUpperCase()), email: u.email } : null;

    supabase.auth.getUser().then(({ data }) => setS(prev => ({ ...prev, user: toUser(data.user) })));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setS(prev => ({ ...prev, user: toUser(session?.user) }));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const toast = (msg: string) => { const id = Date.now(); setToasts(t => [...t, { id, msg }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200); };
  const patch = (p: Partial<State> | ((prev: State) => Partial<State>)) => setS(prev => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) }));

  const act = (msg: string, from?: string, to?: string) =>
    patch(prev => ({ activity: [{ t: nowT(), from, to, msg }, ...prev.activity].slice(0, 40) }));

  const setAgent = (id: string, st: AgentState["st"], task: string) =>
    patch(prev => ({ agents: { ...prev.agents, [id]: { st, task } } }));

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
    patch(prev => ({ busy: true, tokens: Math.max(0, prev.tokens - cost) }));
    const stages: [number, () => void][] = type === "article" ? [
      [500,  () => { setAgent("kw", "w", "Validating keyword…"); act(`"Validate <b>${title}</b> and pull related queries, please."`, "Boss AI", "Mr. Keyword"); onStage?.(0); }],
      [2100, () => { setAgent("kw", "i", "Idle"); setAgent("seo", "w", "Analyzing top 10…"); act(`"Topic is strong — 8 related queries found."`, "Mr. Keyword", "Boss AI"); onStage?.(1); }],
      [3700, () => { setAgent("seo", "i", "Idle"); act(`"Blueprint ready — 3 titles, 9 sections, target 1,850 words."`, "Boss AI"); onStage?.(2); }],
      [5300, () => { setAgent("writer", "w", "Writing section 4 of 9…"); act(`"Blueprint attached. Begin."`, "Boss AI", "Mr. Writer"); onStage?.(3); }],
      [6900, () => { setAgent("writer", "i", "Idle"); setAgent("boss", "w", "Quality gate…"); act(`"Draft complete — 1,920 words. Over to you."`, "Mr. Writer", "Boss AI"); onStage?.(4); }],
      [8300, () => { setAgent("boss", "i", "Monitoring team"); act(`"Quality gate passed ✓ — <b>${title}</b> is in your approval queue."`, "Boss AI"); finish(); }],
    ] : [
      [400,  () => { const ag = type === "story" ? "story" : "social"; setAgent(ag, "w", type === "story" ? "Designing frames…" : "Writing copy…"); act(`"New ${type} for <b>${title}</b> — please begin."`, "Boss AI", ag === "story" ? "Mr. Story" : "Miss Social"); }],
      [3000, () => { const ag = type === "story" ? "story" : "social"; setAgent(ag, "i", "Idle"); act(`"Done — sending for your review."`, ag === "story" ? "Mr. Story" : "Miss Social", "Boss AI"); finish(); }],
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
    act(`"It's live. Prepare distribution."`, "Boss AI", "Miss Social");
    setTimeout(() => report(`Published after your approval: "${c.title}"`), 0);
    toast("Published! Your team is distributing it.");
    return { content: prev.content.map(x => x.id === id ? { ...x, status: "published" } : x) };
  });
  const reject = (id: number) => patch(prev => {
    const c = prev.content.find(x => x.id === id); if (!c) return {};
    act(`"Understood. We'll adjust and learn from this."`, "Boss AI");
    setTimeout(() => report(`Rejected by you (team will adjust): "${c.title}"`), 0);
    return { content: prev.content.map(x => x.id === id ? { ...x, status: "rejected" } : x) };
  });
  const applyPlan = (plan: string) => { // TODO(backend): Paddle/LemonSqueezy webhook drives this
    patch({ plan, tokensMax: PLANS[plan].tokens, tokens: PLANS[plan].tokens });
    act(`"We're on the <b>${PLANS[plan].name}</b> plan now — capacity increased. Let's grow. 🚀"`, "Boss AI");
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

  const api = { s, patch, toast, act, setAgent, report, generate, approve, reject, applyPlan, signOut };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toastwrap">{toasts.map(t => <div key={t.id} className="toast">✓ {t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}
