"use client";
import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Help } from "@/components/kit";

export default function Memory() {
  const { s, patch, toast, act } = useStore();
  const [edit, setEdit] = useState<number | null>(null);
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [nk, setNk] = useState(""); const [nv, setNv] = useState("");

  const save = (i: number) => {
    patch((prev: any) => ({ memory: prev.memory.map((m: any, j: number) => j === i ? { ...m, v: val } : m) }));
    act(`"Noted. All agents realigned."`, "Boss AI");
    toast("Memory updated — team adjusted."); setEdit(null);
  };
  const del = (i: number) => {
    act(`"Forgotten."`, "Boss AI");
    patch((prev: any) => ({ memory: prev.memory.filter((_: any, j: number) => j !== i) }));
    toast("Removed.");
  };
  const add = () => {
    if (!nk.trim() || !nv.trim()) return toast("Both fields needed");
    patch((prev: any) => ({ memory: [...prev.memory, { k: nk.trim(), v: nv.trim() }] }));
    act(`learned something new from you: <b>${nk.trim()}</b>.`, "Boss AI");
    toast("Team memory updated."); setAdding(false); setNk(""); setNv("");
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 21, margin: 0 }}>AI Memory <Help k="memory" /></h1>
        <div style={{ flex: 1 }} />
        <button className="btn btn-g btn-sm" onClick={() => setAdding(true)}>+ Add fact</button>
      </div>
      <p className="sm mut" style={{ marginBottom: 16 }}>Everything your team knows about your business. Click ✎ to edit — every agent adjusts instantly.</p>
      {s.memory.map((m: any, i: number) => (
        <div key={i} className="card" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "13px 15px", marginBottom: 9 }}>
          <span className="xs mut" style={{ textTransform: "uppercase", letterSpacing: 0.6, width: 110, flex: "none", paddingTop: 3, fontWeight: 700 }}>{m.k}</span>
          {edit === i
            ? <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && save(i)} style={{ flex: 1 }} />
            : <span style={{ flex: 1, fontSize: 13.5 }}>{m.v}</span>}
          {edit === i
            ? <button className="btn btn-p btn-sm" onClick={() => save(i)}>Save</button>
            : <><button style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }} onClick={() => { setEdit(i); setVal(m.v); }}>✎</button>
              <button style={{ background: "none", border: "none", color: "var(--mut)", cursor: "pointer" }} onClick={() => del(i)}>🗑</button></>}
        </div>
      ))}
      <div className="card" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <div className="corb" /><div className="sm"><b>Who am I?</b> — <Link href="/whoami">Read Boss AI&apos;s current understanding of your business →</Link></div>
      </div>
      {adding && (
        <div className="modalwrap" onClick={() => setAdding(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Add to memory</h3>
            <div className="field"><label>Label</label><input placeholder="e.g. Products, USP, Do not mention…" value={nk} onChange={e => setNk(e.target.value)} /></div>
            <div className="field"><label>Fact</label><textarea rows={3} placeholder="What should your team know?" value={nv} onChange={e => setNv(e.target.value)} /></div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn btn-g" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={add}>Save to memory</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
