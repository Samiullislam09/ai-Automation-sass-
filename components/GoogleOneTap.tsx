"use client";
import { useEffect } from "react";
import { useSignedIn } from "@/components/landing-v2/AuthLink";
import { makeNonce, oneTapClientId } from "@/lib/google-one-tap";

/** Google One Tap: the small "Continue as <you>" card Google shows to a visitor who is already signed
 *  in to Google in this browser. One tap, and they are signed in here.
 *
 *  HOW IT SIGNS IN. Google gives this page a signed ID token; it goes straight to Supabase
 *  (`signInWithIdToken`), which verifies it against the nonce made below and starts the session. No
 *  redirect and no /auth/callback hop, so the same hard navigation as the other logins is used
 *  (a router.push used to lose the cookie race, see AuthCard). The workspace is created by
 *  getCurrentTenantId the first time /dashboard loads, exactly as after the Google button.
 *
 *  WHAT IT NEVER DOES. It never auto-signs anyone in (`auto_select: false`): a person always taps. It
 *  shows nothing to a visitor who is already signed in here. If anything fails it stays quiet, because
 *  the "Continue with Google" button on the page is still there; a failed extra prompt is not an error
 *  message anyone needs.
 *
 *  OFF BY DEFAULT: without NEXT_PUBLIC_GOOGLE_CLIENT_ID this renders and loads nothing.
 *
 *  Google's script is loaded on demand, after `deferMs`, so the home page (which was just made lighter) pays
 *  for it only once it has had time to paint, and a visitor who signs in meanwhile never downloads it.
 *
 *  Needs, outside this repo: the site's origin in the Google client's "Authorised JavaScript origins", and
 *  the client id in Supabase → Authentication → Providers → Google. */

type CredentialResponse = { credential?: string };
type GsiId = {
  initialize: (cfg: Record<string, unknown>) => void;
  prompt: () => void;
  cancel: () => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

function loadGsi(): Promise<GsiId | null> {
  return new Promise((resolve) => {
    const ready = () => resolve(window.google?.accounts?.id ?? null);
    if (window.google?.accounts?.id) return ready();
    let el = document.getElementById("gsi-client") as HTMLScriptElement | null;
    if (!el) {
      el = document.createElement("script");
      el.id = "gsi-client";
      el.src = GSI_SRC;
      el.async = true;
      el.defer = true;
      document.head.appendChild(el);
    }
    el.addEventListener("load", ready, { once: true });
    el.addEventListener("error", () => resolve(null), { once: true });
  });
}

export function GoogleOneTap({ deferMs = 400 }: { deferMs?: number }) {
  const signedIn = useSignedIn();

  useEffect(() => {
    const clientId = oneTapClientId();
    if (!clientId || signedIn) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const gsi = await loadGsi();
        if (!gsi || cancelled) return;
        const nonce = await makeNonce();
        if (cancelled) return;

        gsi.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          auto_select: false,
          cancel_on_tap_outside: false,
          itp_support: true,
          use_fedcm_for_prompt: true,
          callback: async (resp: CredentialResponse) => {
            if (!resp?.credential) return;
            try {
              const { createClient } = await import("@/lib/supabase/client");
              const { error } = await createClient().auth.signInWithIdToken({ provider: "google", token: resp.credential, nonce: nonce.raw });
              if (error) {
                console.warn("[one-tap] sign-in failed:", error.message);
                return;
              }
              window.location.href = "/dashboard";
            } catch (e) {
              console.warn("[one-tap] sign-in failed:", (e as Error).message);
            }
          },
        });
        gsi.prompt();
      } catch (e) {
        console.warn("[one-tap] could not start:", (e as Error).message);
      }
    }, deferMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { window.google?.accounts?.id?.cancel(); } catch { /* script not loaded yet */ }
    };
  }, [signedIn, deferMs]);

  return null;
}
