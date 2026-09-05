#!/usr/bin/env node
// Validates every declaration against schema/agent.schema.json and against the
// extra rules a schema cannot express (checksum required for binaries, unique
// profileIds, and so on). CI runs this on every push.
import fs from "node:fs";
import path from "node:path";
import { loadAgents, ROOT } from "./lib.mjs";

const schema = JSON.parse(
  fs.readFileSync(path.join(ROOT, "schema/agent.schema.json"), "utf8"),
);

const errors = [];
const fail = (id, msg) => errors.push(`${id}: ${msg}`);

// Minimal structural check against the schema's required/enum/additionalProperties.
function checkSchema(doc) {
  const props = schema.properties;
  for (const key of schema.required) {
    if (doc[key] === undefined) fail(doc.id ?? "<unknown>", `missing required "${key}"`);
  }
  for (const key of Object.keys(doc)) {
    if (!props[key]) fail(doc.id, `unknown top-level field "${key}"`);
  }
  if (doc.id && !/^[a-z0-9][a-z0-9-]*$/.test(doc.id)) {
    fail(doc.id, "id must be lowercase alphanumeric with dashes");
  }
  const distKinds = props.dist.properties.kind.enum;
  if (doc.dist && !distKinds.includes(doc.dist.kind)) {
    fail(doc.id, `dist.kind must be one of ${distKinds.join(", ")}`);
  }
  const modes = props.storage.properties.mode.enum;
  if (doc.storage && !modes.includes(doc.storage.mode)) {
    fail(doc.id, `storage.mode must be one of ${modes.join(", ")}`);
  }
}

const agents = loadAgents();
const seenProfiles = new Map();

for (const a of agents) {
  checkSchema(a);

  const d = a.dist ?? {};
  if (d.kind === "npx" || d.kind === "uvx") {
    if (!d.package) fail(a.id, `dist.kind=${d.kind} requires dist.package`);
  }
  if (d.kind === "binary") {
    if (!d.archive) fail(a.id, "dist.kind=binary requires dist.archive");
    // A binary pulled over the network without a checksum is an unpinned
    // dependency; refuse to build one.
    if (!d.sha256) fail(a.id, "dist.kind=binary requires dist.sha256");
    else if (!/^[a-f0-9]{64}$/.test(d.sha256)) fail(a.id, "dist.sha256 must be 64 hex chars");
    if (!d.cmd) fail(a.id, "dist.kind=binary requires dist.cmd");
  }

  const s = a.storage ?? {};
  if (s.mode === "files") {
    if (!Array.isArray(s.artifacts) || s.artifacts.length === 0) {
      fail(a.id, "storage.mode=files requires a non-empty artifacts list");
    }
  }
  if (Array.isArray(s.artifacts)) {
    for (const art of s.artifacts) {
      for (const p of [art.durable, art.runtime]) {
        // Persisted paths are joined onto host directories; a traversal here
        // would let a declaration write outside its own volume.
        if (path.isAbsolute(p) || p.split("/").includes("..")) {
          fail(a.id, `artifact path "${p}" must be relative and free of ".."`);
        }
      }
    }
  } else if (s.artifacts && (s.mode === "none")) {
    fail(a.id, `storage.artifacts is meaningless when mode=none`);
  }

  if (a.profileId) {
    if (seenProfiles.has(a.profileId)) {
      fail(a.id, `profileId "${a.profileId}" already used by ${seenProfiles.get(a.profileId)}`);
    }
    seenProfiles.set(a.profileId, a.id);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) in ${agents.length} declarations:\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const enabled = agents.filter((a) => a.enabled).length;
console.log(`✓ ${agents.length} declarations valid (${enabled} enabled)`);