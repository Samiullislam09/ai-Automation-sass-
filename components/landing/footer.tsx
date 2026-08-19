"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const footerLinks: Record<string, { label: string; href: string }[]> = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" },
    { label: "Your team", href: "#office" },
    { label: "FAQ", href: "#faq" },
  ],
  Account: [
    { label: "Log in", href: "/login" },
    { label: "Start free", href: "/signup" },
    { label: "Dashboard", href: "/app" },
  ],
  Company: [
    { label: "How it works", href: "#office" },
    { label: "Help", href: "/help/agents" },
    { label: "Contact", href: "mailto:hello@growthteam.ai" },
  ],
  Legal: [
    { label: "Terms", href: "/" },
    { label: "Privacy", href: "/" },
  ],
};

export function Footer() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <footer ref={ref} className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-2 md:grid-cols-5 gap-8"
        >
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                ⚡
              </div>
              <span className="font-semibold text-foreground">GrowthTeam AI</span>
            </Link>
            <p className="text-sm text-muted-foreground mb-4">Your AI marketing team — human-approved, always.</p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border">
              <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-glow" />
              <span className="text-xs text-muted-foreground">All agents operational</span>
            </div>
          </div>

          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-sm font-semibold text-foreground mb-4">{title}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-16 pt-8 border-t border-border text-center"
        >
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} GrowthTeam AI · Human-approved, always
          </p>
        </motion.div>
      </div>
    </footer>
  );
}
