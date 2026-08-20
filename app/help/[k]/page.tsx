"use client";
import { useParams, useRouter } from "next/navigation";
import { HELP } from "@/components/kit";

export default function HelpPage() {
  const { k } = useParams<{ k: string }>();
  const router = useRouter();
  const H = HELP[k as string] || { t: "Help", s: "", d: "Topic not found." };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 22, position: "relative", zIndex: 1 }}>
      <div className="card" style={{ width: "100%", maxWidth: 620, padding: 32 }}>
        <button className="btn btn-g btn-sm" onClick={() => router.back()}>← Back</button>
        <h2 style={{ margin: "16px 0 4px", fontSize: 22 }}>{H.t}</h2>
        <p className="sm acc" style={{ marginBottom: 14 }}>{H.s}</p>
        <p className="sm" style={{ lineHeight: 1.8, color: "#c6d1e8" }}>{H.d}</p>
        <div className="card" style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
          <div className="corb" /><div className="sm">Still confused? Ask <b>Mr Lxwa</b> in the chat — bottom-right of your dashboard.</div>
        </div>
      </div>
    </div>
  );
}
