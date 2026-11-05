"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, MessageSquare, Plus, Search, Trash2, X } from "lucide-react";
import { displayChatTitle } from "@/lib/chat-title";

type Conv = { id: string; title: string | null; updated_at: string };

const DAY = 864e5;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Today / Yesterday / Previous 7 days / Previous 30 days / Older: the way a person remembers
 *  when they talked. Order inside a group is newest first. */
export function groupConversations<T extends { updated_at: string }>(list: T[], now = new Date()): { label: string; items: T[] }[] {
  const today = startOfDay(now);
  const buckets: { label: string; min: number; items: T[] }[] = [
    { label: "Today", min: today, items: [] },
    { label: "Yesterday", min: today - DAY, items: [] },
    { label: "Previous 7 days", min: today - 7 * DAY, items: [] },
    { label: "Previous 30 days", min: today - 30 * DAY, items: [] },
    { label: "Older", min: -Infinity, items: [] },
  ];
  for (const c of [...list].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))) {
    const t = +new Date(c.updated_at);
    buckets.find((b) => t >= b.min)!.items.push(c);
  }
  return buckets.filter((b) => b.items.length).map(({ label, items }) => ({ label, items }));
}

function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const age = startOfDay(now) - startOfDay(d);
  if (age <= 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (age < 7 * DAY) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export default function ChatHistory({
  convs, activeId, onOpen, onDelete, onNew, onClose,
}: {
  convs: Conv[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Escape closes; a click anywhere outside closes (the backdrop below).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { if (expanded) searchRef.current?.focus(); }, [expanded]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? convs.filter((c) => displayChatTitle(c.title).toLowerCase().includes(needle)) : convs;
    return groupConversations(list);
  }, [convs, q]);

  const panel = (
    <div className={`chh ${expanded ? "chh-big" : "chh-pop"}`} role="dialog" aria-label="Chat history" onClick={(e) => e.stopPropagation()}>
      <div className="chh-head">
        <span className="chh-title">Chat history</span>
        <div className="chh-head-actions">
          <button className="chh-icon" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Make smaller" : "Show larger"} title={expanded ? "Make smaller" : "Show larger"}>
            <Maximize2 size={14} />
          </button>
          <button className="chh-icon" onClick={onClose} aria-label="Close history"><X size={15} /></button>
        </div>
      </div>

      <div className="chh-tools">
        <label className="chh-search">
          <Search size={14} />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search"><X size={12} /></button>}
        </label>
        <button className="chh-new" onClick={onNew}><Plus size={14} /> New chat</button>
      </div>

      <div className="chh-list">
        {groups.length === 0 && (
          <p className="chh-empty">{q ? "No chat matches that." : "No past chats yet. Your conversations will appear here."}</p>
        )}
        {groups.map((g) => (
          <section key={g.label}>
            <h4 className="chh-group">{g.label}</h4>
            {g.items.map((c) => {
              const active = c.id === activeId;
              const confirming = confirmId === c.id;
              return (
                <div key={c.id} className={`chh-row ${active ? "on" : ""}`}>
                  {confirming ? (
                    <div className="chh-confirm">
                      <span>Delete this chat?</span>
                      <button className="chh-del" onClick={() => { setConfirmId(null); onDelete(c.id); }}>Delete</button>
                      <button className="chh-cancel" onClick={() => setConfirmId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button className="chh-open" onClick={() => onOpen(c.id)} title={displayChatTitle(c.title)}>
                        <MessageSquare size={14} className="chh-ico" />
                        <span className="chh-name">{displayChatTitle(c.title)}</span>
                        <span className="chh-when">{whenLabel(c.updated_at)}</span>
                      </button>
                      <button className="chh-x" onClick={() => setConfirmId(c.id)} aria-label="Delete chat" title="Delete chat"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );

  // The backdrop and the large sheet go to <body>: the assistant panel can be a transformed
  // drawer, and a fixed element inside a transformed parent is positioned against the parent,
  // not the screen. The small popover stays inline so it inherits the app's theme variables.
  const backdrop = <div className={`chh-backdrop ${expanded ? "chh-backdrop-big" : ""}`} onClick={onClose} />;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {createPortal(backdrop, document.body)}
      {expanded ? createPortal(<div className="chh-center" onClick={onClose}>{panel}</div>, document.body) : panel}
    </>
  );
}

const CSS = `
.chh-backdrop{position:fixed;inset:0;z-index:60;background:transparent}
.chh-backdrop-big{background:rgba(10,12,24,.5);backdrop-filter:blur(2px);z-index:70}
.chh-center{position:fixed;inset:0;z-index:71;display:flex;align-items:center;justify-content:center;padding:16px}
.chh{display:flex;flex-direction:column;min-height:0}
.chh-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:61;width:320px;max-height:min(460px,70vh);border-radius:14px;
  background:var(--lx-panel);border:1px solid var(--lx-border);box-shadow:0 18px 50px rgba(0,0,0,.45);color:var(--lx-text)}
/* the large view is a white sheet, easy to read and scan whatever the app theme is */
.chh-big{width:min(760px,94vw);height:min(80vh,720px);border-radius:16px;background:#fff;color:#1b2440;
  border:1px solid #e5e7eb;box-shadow:0 30px 80px rgba(10,12,24,.35)}
.chh-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px}
.chh-title{font-size:14px;font-weight:700}
.chh-big .chh-title{font-size:17px}
.chh-head-actions{display:flex;gap:4px}
.chh-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:none;background:transparent;color:inherit;opacity:.7;cursor:pointer}
.chh-icon:hover{opacity:1;background:rgba(127,127,160,.14)}
.chh-tools{display:flex;gap:8px;padding:0 12px 10px}
.chh-search{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border-radius:9px;
  background:rgba(127,127,160,.1);border:1px solid transparent;color:inherit}
.chh-search:focus-within{border-color:rgba(139,92,246,.6)}
.chh-search input{flex:1;min-width:0;background:none;border:none;outline:none;color:inherit;font-size:13px}
.chh-search button{display:inline-flex;border:none;background:none;color:inherit;opacity:.6;cursor:pointer}
.chh-new{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:9px;border:none;cursor:pointer;
  font-size:12.5px;font-weight:600;color:#fff;background:linear-gradient(135deg,#4f46e5,#7c3aed);white-space:nowrap}
.chh-list{flex:1;min-height:0;overflow-y:auto;padding:0 8px 10px}
.chh-group{margin:10px 6px 4px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;opacity:.55}
.chh-row{position:relative;display:flex;align-items:center;gap:2px;border-radius:10px}
.chh-row:hover{background:rgba(127,127,160,.12)}
.chh-row.on{background:rgba(124,58,237,.14)}
.chh-big .chh-row:hover{background:#f3f4f8}
.chh-big .chh-row.on{background:#eee9ff}
.chh-open{flex:1;min-width:0;display:flex;align-items:center;gap:9px;padding:9px 8px;border:none;background:none;color:inherit;text-align:left;cursor:pointer}
.chh-ico{flex-shrink:0;opacity:.55}
.chh-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}
.chh-big .chh-name{font-size:14px}
.chh-when{flex-shrink:0;font-size:11px;opacity:.55}
.chh-x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border:none;background:none;border-radius:8px;
  color:inherit;opacity:0;cursor:pointer}
.chh-row:hover .chh-x,.chh-x:focus-visible{opacity:.65}
.chh-x:hover{opacity:1;color:#e0435f;background:rgba(224,67,95,.1)}
@media (hover:none){.chh-x{opacity:.55}}
.chh-confirm{flex:1;display:flex;align-items:center;gap:8px;padding:8px;font-size:12.5px}
.chh-confirm span{flex:1}
.chh-del,.chh-cancel{height:30px;padding:0 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid transparent}
.chh-del{color:#fff;background:#e0435f}
.chh-cancel{color:inherit;background:rgba(127,127,160,.14)}
.chh-empty{margin:18px 10px;font-size:12.5px;opacity:.65;text-align:center}
/* phone: either view is a full-screen sheet */
@media (max-width:639px){
  .chh-pop{position:fixed;inset:0;width:auto;max-height:none;border-radius:0;z-index:72;background:var(--lx-panel)}
  .chh-backdrop{z-index:71}
  .chh-center{padding:0}
  .chh-big{width:100vw;height:100dvh;border-radius:0}
  .chh-head{padding-top:max(12px,env(safe-area-inset-top))}
}
`;
