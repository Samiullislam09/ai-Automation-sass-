"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** Light/dark switch — icon-only pill button. Renders a neutral placeholder until
 *  mounted so server/client markup matches (next-themes reads localStorage on mount). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={mounted ? (dark ? "Switch to light theme" : "Switch to dark theme") : "Toggle theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={
        "inline-flex items-center justify-center size-9 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors " +
        className
      }
    >
      {mounted ? dark ? <Sun size={16} /> : <Moon size={16} /> : <Sun size={16} className="opacity-0" />}
    </button>
  );
}
