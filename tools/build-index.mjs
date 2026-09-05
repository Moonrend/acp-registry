#!/usr/bin/env node
// Compiles agents/*.json into dist/index.json — the single artifact hosts
// fetch. Hosts should never need to read individual declaration files.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadAgents, imageRef, ROOT, IMAGE_PREFIX } from "./lib.mjs";

const CHECK = process.argv.includes("--check");
const OUT_DIR = path.join(ROOT, "dist");
const OUT_FILE = path.join(OUT_DIR, "index.json");

const agents = loadAgents();
const index = {
  schemaVersion: 1,
  imagePrefix: IMAGE_PREFIX,
  agents: agents.map((a) => ({
    id: a.id,
    name: a.name,
    version: a.version,
    enabled: Boolean(a.enabled),
    profileId: a.profileId ?? a.id,
    image: imageRef(a),
    dist: { kind: a.dist.kind },
    storage: a.storage,
    auth: a.auth ?? { modes: ["self"] },
  })),
};
// Content hash lets a host cache the index and detect changes cheaply.
index.digest = createHash("sha256")
  .update(JSON.stringify(index.agents))
  .digest("hex")
  .slice(0, 16);

const serialized = `${JSON.stringify(index, null, 2)}\n`;

if (CHECK) {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
  if (current !== serialized) {
    console.error("✗ dist/index.json is stale — run: node tools/build-index.mjs");
    process.exit(1);
  }
  console.log(`✓ dist/index.json up to date (${index.agents.length} agents, digest ${index.digest})`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, serialized);
console.log(`wrote ${OUT_FILE} (${index.agents.length} agents, digest ${index.digest})`);