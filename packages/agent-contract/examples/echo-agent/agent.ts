/**
 * The echo agent itself. Everything below the imports is the whole agent:
 * a manifest and one handler that emits the event sequence the UI renders.
 *
 * It calls no LLM and no API on purpose — what it proves is the *contract*:
 * steps, progress, per-item data events, developer logs, validated output.
 *
 * In a standalone agent repo this import is `@mrlxwa/agent-contract`.
 */
import { defineAgent, AgentError } from "../../src/index.js";
import { echoManifest } from "./manifest.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const echoAgent = defineAgent({
  manifest: echoManifest,
  handlers: {
    async echo(ctx) {
      const { text, delay_seconds = 0 } = ctx.input as { text: string; delay_seconds?: number };

      ctx.step("parse", "Reading the text");
      const words = text.trim().split(/\s+/).filter(Boolean);
      if (!words.length) throw new AgentError("text has no words to echo", false, "empty_input");
      ctx.log(`parsed ${words.length} word(s), delay_seconds=${delay_seconds}`, "debug");

      ctx.step("echo", "Echoing word by word");
      const perWord = (Math.max(0, delay_seconds) * 1000) / words.length;
      for (const [i, word] of words.entries()) {
        if (perWord > 0) await sleep(perWord);
        if (ctx.signal.aborted) throw new AgentError("cancelled while echoing", true, "aborted");
        ctx.data("chunk", { index: i, word });
        ctx.progress((i + 1) / words.length, `${i + 1}/${words.length}`);
      }

      ctx.step("assemble", "Putting it back together");
      const out = words.join(" ");
      ctx.log(`echoed ${out.length} characters`);
      return { text: out, steps: 3 };
    },
  },
});
