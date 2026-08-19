"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLANS, TOKEN_COST } from "@/lib/store";

const planCopy: Record<string, { tag: string; features: string[]; hot: boolean }> = {
  free: { tag: "1 full article every month", hot: false, features: ["10 tokens / month", "Full SERP article pipeline", "All 6 agents & daily reports", "No card required"] },
  starter: { tag: "~10 articles + stories & posts", hot: true, features: ["120 tokens / month", "Mix articles, stories & posts", "Priority pipeline", "Everything in Free"] },
  growth: { tag: "Volume + premium model + leads", hot: false, features: ["400 tokens / month", "Premium writing model", "Lead generation included", "Everything in Starter"] },
};

function BorderBeam() {
  return (
    <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
      <div className="absolute w-24 h-24 bg-primary/25 blur-xl border-beam-el" style={{ offsetPath: "rect(0 100% 100% 0 round 16px)" }} />
    </div>
  );
}

export function Pricing() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="pricing" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground mb-4 text-balance">Simple, honest pricing</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">Start free forever. Upgrade when your team earns it.</p>
        </motion.div>

        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {Object.entries(PLANS).map(([key, plan], index) => {
            const copy = planCopy[key];
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.3 + index * 0.1 }}
                className={
                  "relative p-6 rounded-2xl border transition-all duration-300 " +
                  (copy.hot ? "bg-card border-ring" : "bg-card/60 border-border hover:border-ring")
                }
              >
                {copy.hot && <BorderBeam />}
                {copy.hot && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-full">
                    Most popular
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-semibold text-foreground mb-2">{plan.name}</h3>
                  <p className="text-muted-foreground text-sm">{copy.tag}</p>
                </div>

                <div className="mb-6 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-foreground tabular-nums">${plan.price}</span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>

                <ul className="space-y-3 mb-8">
                  {copy.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-foreground/90">
                      <Check className="w-4 h-4 text-primary shrink-0" strokeWidth={1.5} />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  className={
                    "w-full rounded-full " +
                    (copy.hot
                      ? "shimmer-btn bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-secondary text-foreground hover:bg-secondary/70 border border-border")
                  }
                >
                  <Link href="/signup">Start free</Link>
                </Button>
              </motion.div>
            );
          })}
        </motion.div>

        <p className="text-center text-sm text-muted-foreground mt-8">
          Token costs: Article ⚡{TOKEN_COST.article} · Web Story ⚡{TOKEN_COST.story} · Social post ⚡{TOKEN_COST.social}
        </p>
      </div>
    </section>
  );
}
