/**
 * The echo agent's manifest — the smallest thing that is still a real agent.
 *
 * This is the file the brain reads from `GET /manifest` to learn what the agent
 * can do: the phrases feed the intent engine, `needs`/`provides` feed the
 * planner graph, `estimated_seconds` feeds the countdown and the watchdog
 * (timeout = 2 × estimated_seconds), and `office` feeds the workspace UI.
 *
 * In a standalone agent repo this import is `@mrlxwa/agent-contract`.
 */
import type { ManifestInput } from "../../src/index.js";

export const echoManifest = {
  id: "echo",
  name: "Mr. Echo",
  version: "1.0.0",
  description: "Says your text back to you, one word at a time. The reference agent for the contract.",
  actions: [
    {
      id: "echo",
      phrases: ["echo karo", "repeat after me", "say this back", "yeh dobara bolo"],
      input: { text: "string", delay_seconds: "number?" },
      output: { text: "string", steps: "number" },
      irreversible: false,
      estimated_seconds: 5,
      cost_units: 0,
      needs: [],
      user_messages: {
        started: "Echoing {text}",
        progress: "{count} words echoed",
        done: "Echoed {text}",
        failed: "Could not echo that",
      },
    },
  ],
  office: { room: "echo", ico: "🪞", color: "#4cc9f0" },
} satisfies ManifestInput;
