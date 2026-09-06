import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const AGENTS_DIR = path.join(ROOT, "agents");
export const IMAGE_PREFIX = "ghcr.io/moonrend/acp-registry";

/** Read every agent declaration, sorted by id so output is deterministic. */
export function loadAgents() {
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = path.join(AGENTS_DIR, f);
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        throw new Error(`${f}: invalid JSON: ${err.message}`);
      }
      if (doc.id !== path.basename(f, ".json")) {
        throw new Error(`${f}: id "${doc.id}" does not match filename`);
      }
      return doc;
    });
}

export const imageRef = (agent, tag = agent.version) =>
  `${IMAGE_PREFIX}/${agent.id}:${tag}`;

/**
 * Build args for images/adapter/Dockerfile. The Dockerfile stays generic; all
 * per-agent knowledge arrives through these.
 */
export function buildArgs(agent) {
  const d = agent.dist;
  const args = {
    ACP_ID: agent.id,
    ACP_KIND: d.kind,
    ACP_VERSION: agent.version,
    ACP_PACKAGE: d.package ?? "",
    ACP_ARCHIVE: d.archive ?? "",
    ACP_SHA256: d.sha256 ?? "",
    ACP_CMD: d.cmd ?? "",
    ACP_ARGS: JSON.stringify(d.args ?? []),
    ACP_ENV: JSON.stringify(d.env ?? {}),
    // Comma-separated so the shell installer can split without a JSON parser.
    ACP_CONSTRAINTS: (d.constraints ?? []).join(","),
  };
  return args;
}
