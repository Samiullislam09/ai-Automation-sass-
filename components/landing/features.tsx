"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import { FileText, Share2, Target, ShieldCheck, ClipboardList, Wrench, Check } from "lucide-react";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};

const STAGES = ["Keyword", "SERP", "Blueprint", "Write", "QC"];

function PipelinePreview() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % (STAGES.length + 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5">
          <div
            className={
              "size-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors " +
              (i < step ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")
            }
          >
            {i < step ? <Check size={12} /> : i + 1}
          </div>
          {i < STAGES.length - 1 && (
            <div className={"h-px w-4 transition-colors " + (i < step ? "bg-primary" : "bg-border")} />
          )}
        </div>
      ))}
    </div>
  );
}

const cards = [
  { icon: FileText, title: "Articles built to compete", body: "We analyze the top 10 results for your keyword, map their gaps, build a blueprint — then write something more complete." },
  { icon: Share2, title: "Every platform, one approval", body: "Facebook, Instagram, X and LinkedIn auto-posted. Quora & Reddit drafted ready-to-paste, so your accounts never get banned." },
  { icon: Target, title: "Leads with a reason", body: "Define your ideal customer once. Every lead arrives scored, verified, and with the reason it fits — no junk lists." },
  { icon: ClipboardList, title: "A report every day", body: "Mr Lxwa writes you a short daily report: what was done, what's next. A manager's standup without the meeting." },
  { icon: Wrench, title: "Your site, cared for daily", body: "Broken links, slow pages, dropping rankings — detected daily, fixed with your approval." },
];

export function Features() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="features" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground mb-4 text-balance">
            Everything a marketing hire would do
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            One subscription replaces a content writer, a social manager, an SEO freelancer and a lead-gen tool —
            with none of them going rogue.
          </p>
        </motion.div>

        <motion.div
          ref={ref}
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {/* Large hero card — nothing publishes without approval */}
          <motion.div
            variants={itemVariants}
            className="md:col-span-2 group relative p-6 rounded-2xl bg-card border border-border hover:border-ring transition-all duration-300 overflow-hidden"
          >
            <div className="flex items-start justify-between gap-6 mb-8 flex-wrap">
              <div>
                <div className="p-2 rounded-lg bg-secondary w-fit mb-4">
                  <ShieldCheck className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">You approve everything</h3>
                <p className="text-muted-foreground text-sm max-w-sm">
                  Nothing publishes without your tap. Edit, approve or reject from your phone in seconds — every
                  article follows the same five-stage pipeline before it ever reaches you.
                </p>
              </div>
              <PipelinePreview />
            </div>
            <div className="grid grid-cols-3 gap-4 max-w-sm">
              {[["10", "tokens / article"], ["5", "pipeline stages"], ["0", "auto-published"]].map(([n, label]) => (
                <div key={label} className="text-center">
                  <div className="text-2xl font-bold text-foreground mb-1 tabular-nums">{n}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {cards.map(({ icon: Icon, title, body }) => (
            <motion.div
              key={title}
              variants={itemVariants}
              className="group relative p-6 rounded-2xl bg-card border border-border hover:border-ring transition-all duration-300"
            >
              <div className="p-2 rounded-lg bg-secondary w-fit mb-4">
                <Icon className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
              <p className="text-muted-foreground text-sm">{body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
