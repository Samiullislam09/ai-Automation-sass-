"use client";
import React from "react";

/** Shared themed form controls for every /dashboard/* page — same look everywhere so a page
 *  never has to reinvent an input/select/switch (or drift from the others' styling). */

export const LxInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function LxInput({ className, style, ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={"lx-12 w-full rounded-lg px-3 py-2 " + (className ?? "")}
        style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)", ...style }}
      />
    );
  }
);

export const LxSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function LxSelect({ className, style, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        {...props}
        className={"lx-12 w-full rounded-lg px-3 py-2 " + (className ?? "")}
        style={{ background: "var(--lx-in)", border: "1px solid var(--lx-border)", color: "var(--lx-text)", ...style }}
      >
        {children}
      </select>
    );
  }
);

export function LxSwitch({
  on,
  onClick,
  disabled,
  label,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button type="button" className={"lx-switch" + (on ? " on" : "")} disabled={disabled} onClick={onClick} aria-label={label}>
      <i />
    </button>
  );
}

const PILL_TONE: Record<string, string> = {
  ok: "green",
  good: "green",
  warn: "amber",
  bad: "red",
  info: "blue",
  mut: "mut",
};

export function LxPill({ tone, children }: { tone: keyof typeof PILL_TONE; children: React.ReactNode }) {
  return <span className={"lx-pill " + PILL_TONE[tone]}>{children}</span>;
}
