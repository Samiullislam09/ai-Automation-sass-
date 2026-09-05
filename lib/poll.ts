/** Polling that stops when nobody is looking.
 *
 *  Every live panel in the dashboard re-fetches on a timer — the agent stage every 3s, the
 *  command centre every 7s, the schedule every 20s. Each of those requests runs real Supabase
 *  queries, and a browser tab left open in the background ran them all night: a single 3s
 *  poller is 28,800 requests a day on its own. On 2026-09-05 that is what put the project over
 *  Supabase's free egress allowance (7.67 GB against 5 GB) with exactly one active user, and
 *  the whole org was restricted for it.
 *
 *  So: the timer keeps ticking, but a tick while `document.hidden` does nothing, and the
 *  moment the tab comes back the callback runs immediately so the panel is never stale on
 *  screen. Visible behaviour is unchanged — this only removes work no one can see.
 *
 *  Returns a stop function; call it from the effect's cleanup instead of clearInterval. */
export function startPolling(fn: () => void, ms: number): () => void {
  let missed = false;
  const timer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) {
      missed = true;
      return;
    }
    fn();
  }, ms);

  const onVisible = () => {
    if (document.hidden || !missed) return;
    missed = false;
    fn(); // catch up at once rather than making the reader wait out the interval
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}
