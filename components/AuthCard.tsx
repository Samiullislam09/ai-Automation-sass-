"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const { s, patch, toast } = useStore();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const go = () => {
    const e = email.trim() || "demo@business.com";
    // TODO(backend): Supabase Auth (email + Google OAuth) replaces this
    patch({ user: { name: e.split("@")[0].replace(/^\w/, (c: string) => c.toUpperCase()), email: e } });
    toast("Welcome!");
    router.push(s.onboarded ? "/app" : "/onboarding");
  };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, position: "relative", zIndex: 1 }}>
      <div className="card" style={{ width: "100%", maxWidth: 390, padding: 30, animation: "min .35s ease" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 800, color: "var(--ink)" }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,var(--ac),#2bb99a)", display: "grid", placeItems: "center", color: "#04120d", fontSize: 13 }}>⚡</span>GrowthTeam AI
        </Link>
        <h2 style={{ fontSize: 21, margin: "14px 0 4px" }}>{mode === "login" ? "Log in to your team" : "Hire your AI team"}</h2>
        <p className="sm mut">No credit card · free forever plan</p>
        <button onClick={go} style={{ width: "100%", background: "#fff", color: "#1a1a1a", fontWeight: 600, borderRadius: 11, padding: 11, display: "flex", gap: 10, alignItems: "center", justifyContent: "center", fontSize: 14, border: "none", cursor: "pointer", marginTop: 18 }}>
          <svg width="17" height="17" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.8C43.9 38 46.5 31.8 46.5 24.5z"/><path fill="#FBBC05" d="M10.4 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.4-5.8c-2 1.4-4.7 2.2-7.8 2.2-6.3 0-11.7-3.9-13.6-9.4l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
          Continue with Google
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--mut2)", fontSize: 11.5, margin: "16px 0" }}>
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />or with email<span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>
        <div className="field"><label>Email</label><input type="email" placeholder="you@business.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field"><label>Password</label><input type="password" placeholder="••••••••" /></div>
        <button className="btn btn-p" style={{ width: "100%", marginTop: 8 }} onClick={go}>{mode === "login" ? "Log in" : "Create free account"}</button>
        <p className="sm" style={{ textAlign: "center", marginTop: 16 }}>
          {mode === "login" ? <Link href="/signup">New here? Create a free account</Link> : <Link href="/login">Already have an account? Log in</Link>}
        </p>
      </div>
    </div>
  );
}
