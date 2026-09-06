#!/usr/bin/env node
// One-shot migration: old Zakura manifest + hardcoded host tables -> per-agent
// declaration files. Kept in the repo because it documents exactly where each
// field came from; re-running it is how we prove the split lost nothing.
import fs from "node:fs";
import path from "node:path";

const ZAKURA = process.env.ZAKURA_DIR ?? "/opt/zakura-dev";
const OUT = path.resolve(process.argv[2] ?? "agents");

const manifest = JSON.parse(
  fs.readFileSync(path.join(ZAKURA, "scripts/acp-images.json"), "utf8"),
);

// --- Tables lifted verbatim from packages/shared/src/acp-sources.ts ---------
// profile id -> registry id. Direction is inverted here: the declaration owns
// its own profileId, so the host no longer needs the map at all.
const REGISTRY_BY_PROFILE = {
  "claude-code": "claude-acp",
  codex: "codex-acp",
  "gemini-cli": "gemini",
  opencode: "opencode",
  copilot: "github-copilot-cli",
  "qwen-code": "qwen-code",
  pi: "pi-acp",
  grok: "grok-build",
  auggie: "auggie",
  cline: "cline",
  cursor: "cursor",
  devin: "devin",
  goose: "goose",
  junie: "junie",
  nova: "nova",
  dirac: "dirac",
  codebuddy: "codebuddy-code",
  amp: "amp-acp",
  deepagents: "deepagents",
  poolside: "poolside",
  sigit: "sigit",
  "kimi-code": "kimi",
  "factory-droid": "factory-droid",
  kilo: "kilo",
  "fast-agent": "fast-agent",
};
const PROFILE_BY_REGISTRY = Object.fromEntries(
  Object.entries(REGISTRY_BY_PROFILE).map(([p, r]) => [r, p]),
);

// --- Storage shapes lifted from packages/shared/src/acp-storage.ts ---------
// The host used an if-chain on profileId. Each branch becomes a declaration.
function storageFor(profileId) {
  if (profileId === "codex") {
    return {
      mode: "files",
      env: {
        HOME: "${RUNTIME_DIR}",
        CODEX_HOME: "${STATE_DIR}",
        CODEX_SQLITE_HOME: "${STATE_DIR}",
      },
      artifacts: [
        { durable: ".codex/auth.json", runtime: "auth.json", sync: "codex_auth", when: ["self", "oauth"] },
        { durable: ".codex/config.toml", runtime: "config.toml", sync: "exit", when: ["self"] },
      ],
      skipWhenApiKey: false,
    };
  }
  if (profileId === "claude-code") {
    return {
      mode: "files",
      env: { HOME: "${RUNTIME_DIR}", CLAUDE_CONFIG_DIR: "${STATE_DIR}" },
      artifacts: [
        { durable: ".claude/.credentials.json", runtime: ".credentials.json", sync: "exit", when: ["self"] },
        { durable: ".claude/settings.json", runtime: "settings.json", sync: "exit", when: ["self"] },
        { durable: ".claude/settings.local.json", runtime: "settings.local.json", sync: "exit", when: ["self"] },
        { durable: ".claude/CLAUDE.md", runtime: "CLAUDE.md", sync: "exit", when: ["self"] },
        { durable: ".claude.json", runtime: ".claude.json", sync: "none", when: ["self"] },
      ],
      skipWhenApiKey: false,
    };
  }
  if (profileId === "hermes") {
    return {
      mode: "home",
      env: { HERMES_HOME: "${HOME_DIR}" },
      skipWhenApiKey: true,
    };
  }
  if (profileId === "opencode") {
    return { mode: "state-home", xdg: true, skipWhenApiKey: true };
  }
  if (profileId === "fx") {
    return {
      mode: "files",
      env: { HOME: "${HOME_DIR}" },
      artifacts: [{ durable: ".fx", runtime: ".fx", sync: "exit", when: ["self", "oauth"] }],
      skipWhenApiKey: true,
    };
  }
  if (profileId === "kiro") {
    // Device-code login state lives across ~/.kiro and ~/.aws, and kiro only
    // has a self mode, so the whole home must round-trip or every session
    // re-authenticates.
    return { mode: "state-home", xdg: true, skipWhenApiKey: false };
  }
  if (["grok", "copilot", "kimi-code", "pi"].includes(profileId)) {
    return { mode: "state-home", xdg: true, skipWhenApiKey: true };
  }
  // Default branch: a single credentials file, self mode only.
  return {
    mode: "files",
    env: { HOME: "${RUNTIME_DIR}" },
    artifacts: [
      { durable: ".credentials.json", runtime: ".credentials.json", sync: "exit", when: ["self"] },
    ],
    skipWhenApiKey: true,
  };
}

function authFor(profileId) {
  if (profileId === "codex") {
    return {
      modes: ["self", "oauth", "api_key"],
      apiKeyEnv: ["OPENAI_API_KEY"],
      noBrowserEnv: { NO_BROWSER: "1" },
    };
  }
  if (profileId === "kiro") return { modes: ["self"] };
  return { modes: ["self", "api_key"] };
}

fs.mkdirSync(OUT, { recursive: true });
const written = [];
for (const entry of manifest.images ?? manifest.agents ?? []) {
  const profileId = PROFILE_BY_REGISTRY[entry.id] ?? entry.id;
  const dist = { kind: entry.kind };
  if (entry.package) dist.package = entry.package;
  if (entry.archive) dist.archive = entry.archive;
  if (entry.sha256) dist.sha256 = entry.sha256;
  if (entry.cmd) dist.cmd = entry.cmd;
  if (entry.args?.length) dist.args = entry.args;
  if (entry.env && Object.keys(entry.env).length) dist.env = entry.env;

  const doc = {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    profileId,
    dist,
    storage: storageFor(profileId),
    auth: authFor(profileId),
  };
  const file = path.join(OUT, `${entry.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  written.push(entry.id);
}
console.log(`wrote ${written.length} declarations to ${OUT}`);
