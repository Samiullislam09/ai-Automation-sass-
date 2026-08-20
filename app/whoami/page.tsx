"use client";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

export default function WhoAmI() {
  const { s } = useStore();
  const m = Object.fromEntries(s.memory.map((x: any) => [x.k, x.v]));
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 22, position: "relative", zIndex: 1 }}>
      <div className="card" style={{ width: "100%", maxWidth: 560, padding: 32 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <div className="corb" /><b>Mr Lxwa</b><span className="xs mut">· Who am I? <Help k="whoami" /></span>
        </div>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Here&apos;s how I understand your business:</h2>
        <p className="sm" style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, lineHeight: 1.7 }}>
          You run <b>{m["Business type"] || "a business"}</b> at <b className="acc">{m["Website"] || "your website"}</b>, serving <b>{(m["Audience"] || "").toLowerCase()}</b>.
          Your content should sound <b>{(m["Brand tone"] || "").toLowerCase()}</b>, published at <b>{(m["Publishing pace"] || "").toLowerCase()}</b>. {m["Niche summary"]}.
          My team will write to grow your organic traffic and bring you leads — and you approve everything before it goes live.
        </p>
        <p className="xs mut" style={{ margin: "12px 0 16px" }}>Something wrong? Edit any detail in <b>Memory</b> anytime — all agents adjust instantly.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="btn btn-g" href="/app/memory">Edit memory</Link>
          <Link className="btn btn-p" style={{ flex: 1 }} href="/app">Perfect — open my dashboard →</Link>
        </div>
      </div>
    </div>
  );
}
