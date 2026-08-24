"use client";

/** The sound an agent makes when it finishes.
 *
 *  Synthesised with the Web Audio API rather than shipped as an mp3: two short sine tones is
 *  a few lines of code, and an audio file would be a network request that can fail, a licence
 *  to track, and a CDN this app deliberately doesn't have.
 *
 *  Off by default and remembered per browser. A dashboard that starts making noise on its own
 *  is a dashboard people mute at the operating system, which loses the signal entirely.
 */

const KEY = "gt-sound";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // private mode / storage blocked — silence is the safe default
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers start the context suspended until a user gesture. By the time anything here
  // fires the user has clicked something, so resuming is enough — and if it isn't allowed
  // yet, the promise rejects harmlessly and we simply stay quiet.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** One sine blip. Gain is ramped, never switched — a square edge on a gain node is an
 *  audible click, which is what makes cheap notification sounds feel cheap. */
function blip(at: number, freq: number, duration: number, peak: number) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(a.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** Rising two-note figure — reads as "done" without being a fanfare you'd hear forty times a day. */
export function playSuccess() {
  if (!soundEnabled()) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  blip(t, 659.25, 0.16, 0.18);        // E5
  blip(t + 0.13, 987.77, 0.26, 0.16); // B5
}

/** Falling pair for a failure. Deliberately quieter and lower: it should register as
 *  "something needs you", not as an alarm. */
export function playError() {
  if (!soundEnabled()) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  blip(t, 349.23, 0.18, 0.12);        // F4
  blip(t + 0.16, 261.63, 0.3, 0.11);  // C4
}
