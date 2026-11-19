"use client";
import { useEffect, useState } from "react";
import { normalizeProfile, type SiteProfile } from "@/components/SiteBrainModel";

/** What the analyst made of the site, for the onboarding "Is this your business?" step. Polls until the answer is final (ready / no-pages / off). */

export type ProfileStatus = "ready" | "thinking" | "no-pages" | "off";

export type OnboardingProfile = {
  status: ProfileStatus;
  profile: SiteProfile | null;
  pagesCrawled: number;
  builtFromPages: number | null;
};

const PROFILE_POLL_MS = 3000;

/** Reads what the analyst made of the site. Returns `null` while it is still loading, so the
 *  parent can hold the step rather than flashing an empty screen and then filling it.
 *
 *  Polls every few seconds while the answer is still "thinking" — a single one-shot read (the
 *  original behaviour) meant a tenant whose crawl was still running the moment step 4 was
 *  reached stayed on "thinking" for the rest of the wizard even if the analyst finished ten
 *  seconds later, so screens 5/6 and the real completion check on step 8 both need this to
 *  keep looking rather than trust one snapshot. Stops on its own once the answer is final
 *  (ready/no-pages/off) — never polls a tenant that is already done. */
export function useOnboardingProfile(enabled: boolean): OnboardingProfile | null {
  const [state, setState] = useState<OnboardingProfile | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      fetch("/api/onboarding/profile")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const next: OnboardingProfile = {
            status: (d?.status as ProfileStatus) ?? "thinking",
            profile: d?.profile ? normalizeProfile(d.profile) : null,
            pagesCrawled: Number(d?.pagesCrawled) || 0,
            builtFromPages: Number(d?.builtFromPages) || null,
          };
          setState(next);
          if (next.status === "thinking") timer = setTimeout(tick, PROFILE_POLL_MS);
        })
        // A failed read is treated as "still thinking" for the same reason the API treats a
        // database error that way: it is not a reason to stop somebody signing up.
        .catch(() => {
          if (!alive) return;
          setState({ status: "thinking", profile: null, pagesCrawled: 0, builtFromPages: null });
          timer = setTimeout(tick, PROFILE_POLL_MS);
        });
    };
    tick();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return state;
}
