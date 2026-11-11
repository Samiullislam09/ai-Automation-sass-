"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { C } from "./shared";

/** A small dropdown that looks like the rest of the page (the browser's own <select> list is the
 *  system's blue-highlight menu and cannot be styled). Click to open, click an option, Esc or an outside
 *  click to close, Up/Down/Enter from the keyboard. */
export default function Select({ value, options, onChange, label, prefix, className = "", block = false, align = "left" }: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void;
  label: string; prefix?: string; className?: string; block?: boolean; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setHi(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); return; }
      setHi((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) { e.preventDefault(); pick(options[hi].value); }
  };

  return (
    <div ref={root} className={`relative ${block ? "w-full" : "shrink-0"} ${className}`} onKeyDown={onKey}>
      <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { setHi(Math.max(0, options.findIndex((o) => o.value === value))); setOpen((o) => !o); }}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg px-3 text-[13px] transition-colors duration-150 ease-out hover:bg-[#f9fafb]"
        style={{ background: C.panel, border: `1px solid ${open ? C.brand : C.line}`, color: C.ink }}>
        <span className="truncate">{prefix && <span style={{ color: C.sub }}>{prefix} </span>}<span className="font-medium">{cur?.label}</span></span>
        <ChevronDown size={16} className="shrink-0" style={{ color: C.sub }} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className={`absolute z-[97] mt-1 max-h-64 min-w-full overflow-y-auto rounded-lg border p-1 shadow-md ${align === "right" ? "right-0" : "left-0"}`} style={{ background: C.panel, borderColor: C.line }}>
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}
              className="flex h-8 cursor-pointer items-center justify-between gap-4 whitespace-nowrap rounded-md px-2.5 text-[13px]"
              style={{ background: i === hi ? C.graySoft : "transparent", color: C.ink }}>
              <span className={o.value === value ? "font-medium" : ""}>{o.label}</span>
              {o.value === value && <Check size={14} style={{ color: C.brand }} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
