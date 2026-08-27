#!/usr/bin/env node
/**
 * Copy the agent contract's source into agent-server, and prove it stayed in step.
 *
 * WHY THIS EXISTS. `packages/agent-contract` is the one definition of what an agent is. The
 * brain and today's in-process agents need it at runtime — but Railway builds with Root
 * Directory = `agent-server`, so a `file:../packages/agent-contract` dependency points outside
 * the build context and `npm install` fails on deploy. Publishing to npm is the real fix
 * (docs/MANUAL_STEPS.md item 10) and needs an account the project does not have yet.
 *
 * Until then the source is vendored into `agent-server/src/vendor/agent-contract/`, and this
 * script is what keeps "vendored" from quietly meaning "forked":
 *
 *   node scripts/sync-contract.mjs           # copy package → agent-server (after editing the package)
 *   node scripts/sync-contract.mjs --check   # exit 1 if they differ (tests and CI run this)
 *
 * Rules: never edit the vendored copy — edit `packages/agent-contract/src` and re-run this.
 * Every vendored file gets a generated header saying exactly that.
 */
import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "packages", "agent-contract", "src");
const DST = path.join(ROOT, "agent-server", "src", "vendor", "agent-contract");
const CHECK = process.argv.includes("--check");

const HEADER = `// GENERATED — do not edit. Source: packages/agent-contract/src/%s
// Edit the package, then run: node scripts/sync-contract.mjs
`;

/** Tests, fixtures and examples are the package's own business; the runtime does not need them. */
const skip = (rel) => /\.test\.ts$/.test(rel) || /\.fixture\.ts$/.test(rel) || rel.startsWith("examples");

async function walk(dir, base = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else if (entry.name.endsWith(".ts") && !skip(rel)) out.push(rel);
  }
  return out;
}

if (!existsSync(SRC)) {
  console.error(`✕ ${path.relative(ROOT, SRC)} not found — is the package still there?`);
  process.exit(1);
}

const files = (await walk(SRC)).sort();
let differences = 0;

for (const rel of files) {
  const body = await readFile(path.join(SRC, rel), "utf8");
  const want = HEADER.replace("%s", rel) + body;
  const target = path.join(DST, rel);

  if (CHECK) {
    const have = existsSync(target) ? await readFile(target, "utf8") : null;
    if (have !== want) {
      console.error(`✕ out of sync: ${rel}${have === null ? " (missing)" : ""}`);
      differences++;
    }
    continue;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, want, "utf8");
}

// A file deleted from the package must disappear from the vendored copy too, or the brain keeps
// importing something the contract no longer defines.
const vendored = existsSync(DST) ? (await walk(DST)).sort() : [];
const extra = vendored.filter((rel) => !files.includes(rel));
for (const rel of extra) {
  if (CHECK) {
    console.error(`✕ stale vendored file (not in the package any more): ${rel}`);
    differences++;
  } else {
    await rm(path.join(DST, rel));
  }
}

if (CHECK) {
  if (differences) {
    console.error(`\n${differences} file(s) differ. Run: node scripts/sync-contract.mjs`);
    process.exit(1);
  }
  console.log(`✓ vendored contract matches the package (${files.length} files)`);
} else {
  console.log(`✓ synced ${files.length} file(s) → ${path.relative(ROOT, DST)}${extra.length ? `, removed ${extra.length} stale` : ""}`);
}
