"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const rows: [string, string, string, string][] = [
  ["Works without prompting", "✓ Team runs on your schedule", "✗ You operate it", "✓ But enterprise setup"],
  ["You see the team working", "✓ Live animated office", "✗ Text box", "✗ Config dashboards"],
  ["Human approval built-in", "✓ Every single action", "—", "Partial"],
  ["Small-business pricing", "✓ Free, then $5", "$39–99/mo", "$1,000s + contracts"],
  ["Leads + content + SEO together", "✓ One team", "Content only", "Usually one lane"],
];

export function Comparison() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground mb-4 text-balance">
            Why teams pick us over AI tools
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="rounded-2xl border border-border bg-card overflow-x-auto"
        >
          <table className="w-full border-collapse text-sm min-w-[560px]">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left px-5 py-4 font-medium"></th>
                <th className="px-5 py-4 font-semibold text-foreground">GrowthTeam AI</th>
                <th className="px-5 py-4 font-medium">AI writing tools</th>
                <th className="px-5 py-4 font-medium">Enterprise AI agents</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]} className="border-t border-border">
                  <td className="px-5 py-3.5 text-muted-foreground">{r[0]}</td>
                  <td className="px-5 py-3.5 text-center font-semibold text-foreground bg-primary/10">{r[1]}</td>
                  <td className="px-5 py-3.5 text-center text-muted-foreground">{r[2]}</td>
                  <td className="px-5 py-3.5 text-center text-muted-foreground">{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}
