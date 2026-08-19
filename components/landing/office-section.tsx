"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Office from "@/components/Office";

export function OfficeSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="office" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground mb-4 text-balance">
            This is your real dashboard
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Rooms light up as agents work, go dark when they're off, and yes — Chacha serves chai. ☕ Click a room to
            zoom in.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="rounded-2xl border border-border p-2 sm:p-3 bg-card"
        >
          <Office demo />
        </motion.div>
      </div>
    </section>
  );
}
