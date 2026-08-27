/**
 * A dependency-free host for the echo agent: `node:http` + `createHttpAgent`.
 *
 * The README's quickstart mounts the same `http.handle` on express; this file
 * exists to prove the adapter needs no framework at all — `handle` takes a
 * plain `{ method, path, headers, body }` and returns `{ status, body }`, so
 * any server can serve an agent in ~30 lines of glue.
 *
 * Run it:  npm run example:echo        (PORT / AGENT_TOKEN from the env)
 */
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { createHttpAgent, type HttpAgent } from "../../src/index.js";
import { echoAgent } from "./agent.js";

/** 2 MB, same limit the express quickstart uses. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface EchoServerOptions {
  /** Shared secret the brain sends as `x-agent-token`. */
  token: string;
  /** 0 = an ephemeral port (what the e2e test uses). */
  port?: number;
  /** Event batch interval in ms. Default 500 (the contract default). */
  batchMs?: number;
  onError?: (err: Error) => void;
}

export interface EchoServer {
  server: Server;
  agent: HttpAgent;
  /** The port actually bound (resolved after `listen`). */
  port: number;
  /** Finish in-flight runs, then close the socket and every keep-alive connection. */
  close(): Promise<void>;
}

export function createEchoServer(opts: EchoServerOptions): { server: Server; agent: HttpAgent } {
  const agent = createHttpAgent(echoAgent, {
    token: opts.token,
    ...(opts.batchMs !== undefined ? { batchMs: opts.batchMs } : {}),
    ...(opts.onError ? { onError: opts.onError } : {}),
  });

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown, extra?: Record<string, string>) => {
      const json = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json), ...extra });
      res.end(json);
    };

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        send(413, { error: "body too large" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          send(400, { error: "body must be valid JSON" });
          return;
        }
      }
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      agent
        .handle({ method: req.method ?? "GET", path, headers: req.headers, body })
        .then((out) => send(out.status, out.body, out.headers))
        .catch((e: unknown) => send(500, { error: e instanceof Error ? e.message : String(e) }));
    });
    req.on("error", () => {
      if (!res.writableEnded) send(400, { error: "request stream error" });
    });
  });

  return { server, agent };
}

/** Create + listen, resolving once the port is bound. */
export async function startEchoServer(opts: EchoServerOptions): Promise<EchoServer> {
  const { server, agent } = createEchoServer(opts);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", resolve);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
  return {
    server,
    agent,
    port,
    close: async () => {
      await agent.drain();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const token = process.env.AGENT_TOKEN ?? "echo-dev-token";
  const port = Number(process.env.PORT ?? 7801);
  startEchoServer({ token, port, onError: (e) => console.error("[echo] callback failed:", e.message) })
    .then((s) => {
      console.log(`[echo] listening on http://127.0.0.1:${s.port}  (token: ${token})`);
      console.log(`[echo] GET /health  GET /manifest  POST /run`);
      for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.once(sig, () => void s.close().then(() => process.exit(0)));
      }
    })
    .catch((e: unknown) => {
      console.error("[echo] failed to start:", e);
      process.exit(1);
    });
}
