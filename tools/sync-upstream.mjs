#!/usr/bin/env node
// Reconciles declarations against the upstream ACP registry.
//   node tools/sync-upstream.mjs           # report drift
//   node tools/sync-upstream.mjs --write   # apply version/dist updates
//   node tools/sync-upstream.mjs --check   # exit 1 on drift (CI)
//
// Local policy fields (enabled, profileId, storage, auth) are never touched;
// only upstream-owned facts (version, package, archive, cmd, args) move.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadAgents, AGENTS_DIR } from "./lib.mjs";

const UPSTREAM =
  process.env.ACP_REGISTRY_URL ??
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");

async function sha256(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const hash = createHash("sha256");
  for await (const chunk of res.body) hash.update(chunk);
  return hash.digest("hex");
}

const res = await fetch(UPSTREAM);
if (!res.ok) {
  console.error(`failed to fetch upstream registry: HTTP ${res.status}`);
  process.exit(2);
}
const upstream = await res.json();
const byId = new Map();
for (const entry of upstream.agents ?? upstream.servers ?? []) {
  byId.set(entry.id ?? entry.name, entry);
}

const local = loadAgents();
const changes = [];
const warnings = [];

for (const agent of local) {
  const up = byId.get(agent.id);
  if (!up) {
    // An enabled agent vanishing upstream is a real problem: we would keep
    // publishing an image nobody maintains.
    (agent.enabled ? changes : warnings).push({
      id: agent.id,
      kind: "missing-upstream",
      detail: `no longer present in upstream registry${agent.enabled ? " (ENABLED!)" : ""}`,
    });
    continue;
  }
  const upVersion = up.version ?? up.latestVersion;
  if (upVersion && upVersion !== agent.version) {
    changes.push({ id: agent.id, kind: "version", from: agent.version, to: upVersion, entry: up, agent });
  }
}

for (const id of byId.keys()) {
  if (!local.some((a) => a.id === id)) {
    warnings.push({ id, kind: "new-upstream", detail: "present upstream but not declared here" });
  }
}

if (!changes.length && !warnings.length) {
  console.log(`✓ in sync with upstream (${local.length} declarations)`);
  process.exit(0);
}

for (const c of changes) {
  console.log(c.kind === "version" ? `~ ${c.id}: ${c.from} -> ${c.to}` : `! ${c.id}: ${c.detail}`);
}
for (const w of warnings) console.log(`  · ${w.id}: ${w.detail}`);

if (CHECK) process.exit(changes.length ? 1 : 0);

if (WRITE) {
  let applied = 0;
  for (const c of changes.filter((x) => x.kind === "version")) {
    const { agent, entry } = c;
    agent.version = c.to;
    const d = agent.dist;
    if (d.kind === "npx" || d.kind === "uvx") {
      const pkgName = (d.package ?? "").split("@").slice(0, -1).join("@") || d.package;
      if (pkgName) d.package = `${pkgName}@${c.to}`;
    }
    if (d.kind === "binary") {
      const nextArchive = entry.archive ?? entry.download?.url;
      if (nextArchive && nextArchive !== d.archive) {
        d.archive = nextArchive;
        // Version moved, so the old checksum is meaningless — re-pin it.
        try {
          d.sha256 = await sha256(nextArchive);
        } catch (err) {
          console.error(`  ✗ ${agent.id}: could not checksum new archive: ${err.message}`);
          continue;
        }
      }
    }
    fs.writeFileSync(
      path.join(AGENTS_DIR, `${agent.id}.json`),
      `${JSON.stringify(agent, null, 2)}\n`,
    );
    applied++;
  }
  console.log(`\napplied ${applied} update(s); run tools/build-index.mjs next`);
}