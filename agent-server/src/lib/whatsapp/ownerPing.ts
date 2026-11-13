/** Not more than one WhatsApp message to the owner every few minutes, however many customers need them.
 *
 *  Each "this customer needs you" used to send the owner its own WhatsApp. That is right for one customer
 *  and wrong for a surge: a hundred people messaging at once (an ad goes live, a broadcast lands) would put a
 *  hundred pings on the owner's phone in a minute, which is how an owner learns to mute the number — and
 *  then misses the one that mattered. The dashboard notification and the "needs you" flag on the lead are
 *  still written for EVERY customer (nothing is hidden); only the interruption on the owner's phone is
 *  rationed, and the next one that does go out says how many came in the meantime.
 *
 *  In-process, like every other limiter here: agent-server is one process. */
export function makePingGate(minGapMs = 3 * 60_000, now: () => number = () => Date.now()) {
  const state = new Map<string, { at: number; held: number }>();
  return {
    /** `send` — may a WhatsApp go out now? `held` — how many were suppressed since the last one that did. */
    take(tenantId: string): { send: boolean; held: number } {
      const t = now();
      const s = state.get(tenantId);
      if (!s || t - s.at >= minGapMs) {
        const held = s?.held ?? 0;
        state.set(tenantId, { at: t, held: 0 });
        return { send: true, held };
      }
      s.held++;
      return { send: false, held: s.held };
    },
  };
}

export const ownerPings = makePingGate();
