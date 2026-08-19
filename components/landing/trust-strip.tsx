"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

/** Real integrations from the product spec — not fabricated customer logos. */
const channels = ["WordPress", "Google Search Console", "Google Business Profile", "Meta", "LinkedIn", "Google Analytics"];

export function TrustStrip() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} className="py-14 overflow-hidden border-y border-border">
      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6 }}
        className="text-center mb-8"
      >
        <p className="text-sm text-muted-foreground uppercase tracking-wider font-medium">
          Publishes and distributes where your business already lives
        </p>
      </motion.div>

      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />

        <div className="flex animate-marquee">
          {[...channels, ...channels].map((name, index) => (
            <div
              key={index}
              className="flex items-center justify-center min-w-[200px] h-14 mx-8 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all duration-300"
            >
              <span className="font-display font-medium text-foreground/80 text-lg">{name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
