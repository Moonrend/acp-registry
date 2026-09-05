#!/usr/bin/env node
// Pins dist.sha256 for binary agents that upstream ships without a checksum.
// Usage: node tools/pin-checksums.mjs [id ...]   (default: all missing)
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadAgents, AGENTS_DIR } from "./lib.mjs";

async function sha256(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const hash = createHash("sha256");
  for await (const chunk of res.body) hash.update(chunk);
  return hash.digest("hex");
}

const only = new Set(process.argv.slice(2));
const targets = loadAgents().filter(
  (a) =>
    a.dist?.kind === "binary" &&
    !a.dist.sha256 &&
    (only.size === 0 || only.has(a.id)),
);

if (targets.length === 0) {
  console.log("nothing to pin");
  process.exit(0);
}

for (const agent of targets) {
  process.stdout.write(`${agent.id} ... `);
  const sum = await sha256(agent.dist.archive);
  agent.dist.sha256 = sum;
  // Rebuild dist so sha256 sits next to archive rather than at the end.
  const d = agent.dist;
  agent.dist = {
    kind: d.kind,
    ...(d.package ? { package: d.package } : {}),
    ...(d.archive ? { archive: d.archive } : {}),
    ...(d.sha256 ? { sha256: d.sha256 } : {}),
    ...(d.cmd ? { cmd: d.cmd } : {}),
    ...(d.args ? { args: d.args } : {}),
    ...(d.env ? { env: d.env } : {}),
  };
  fs.writeFileSync(
    path.join(AGENTS_DIR, `${agent.id}.json`),
    `${JSON.stringify(agent, null, 2)}\n`,
  );
  console.log(sum);
}
console.log(`pinned ${targets.length} checksum(s)`);