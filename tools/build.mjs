#!/usr/bin/env node
// Builds adapter images from declarations, smoke-tests each with a real ACP
// initialize handshake, optionally pushes, and can delete locally afterwards so
// a full 39-agent run fits on a small disk.
//
//   node tools/build.mjs                 # enabled agents, build + smoke
//   node tools/build.mjs --all           # every declaration
//   node tools/build.mjs --only a,b      # explicit ids (ignores enabled)
//   node tools/build.mjs --push --prune  # publish, then reclaim disk
import { spawn } from "node:child_process";
import path from "node:path";
import { loadAgents, buildArgs, imageRef, ROOT } from "./lib.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1];
};

const PUSH = has("--push");
const PRUNE = has("--prune");
const ALL = has("--all");
const ONLY = (valueOf("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SMOKE_TIMEOUT_MS = Number(valueOf("--smoke-timeout") ?? 90_000);

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Start the image and speak ACP over stdio. A container that exits 0 without
 * answering is still broken, so we require a well-formed initialize result.
 */
function smokeTest(ref) {
  return new Promise((resolve) => {
    const p = spawn(
      "docker",
      ["run", "--rm", "-i", "--pull", "never", ref],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let stderr = "";
    let settled = false;
    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { p.kill("SIGKILL"); } catch {}
      resolve({ ok, reason, stderr: stderr.slice(-600) });
    };
    const timer = setTimeout(() => finish(false, `no response in ${SMOKE_TIMEOUT_MS}ms`), SMOKE_TIMEOUT_MS);

    p.stdout.on("data", (c) => {
      out += c.toString();
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const msg = JSON.parse(t);
          if (msg.id === 1 && msg.result) {
            const v = msg.result.protocolVersion;
            if (v === undefined) return finish(false, "initialize result missing protocolVersion");
            return finish(true, `protocolVersion=${v}`);
          }
          if (msg.id === 1 && msg.error) {
            return finish(false, `initialize error: ${JSON.stringify(msg.error).slice(0, 200)}`);
          }
        } catch {
          // Partial line; wait for more output.
        }
      }
    });
    p.stderr.on("data", (c) => { stderr += c.toString(); });
    p.on("error", (err) => finish(false, `spawn failed: ${err.message}`));
    p.on("exit", (code) => finish(false, `exited early with code ${code}`));

    p.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        },
      })}\n`,
    );
  });
}

const all = loadAgents();
const targets = ONLY.length
  ? all.filter((a) => ONLY.includes(a.id))
  : ALL
    ? all
    : all.filter((a) => a.enabled);

if (ONLY.length) {
  const missing = ONLY.filter((id) => !all.some((a) => a.id === id));
  if (missing.length) {
    console.error(`unknown agent id(s): ${missing.join(", ")}`);
    process.exit(1);
  }
}
if (!targets.length) {
  console.error("no agents selected");
  process.exit(1);
}

console.log(`Building base image ...`);
const BASE_TAG = "acp-base:local";
const baseCode = await run("docker", [
  "build", "-t", BASE_TAG, "-f", path.join(ROOT, "images/base/Dockerfile"), path.join(ROOT, "images/base"),
]);
if (baseCode !== 0) { console.error("base image build failed"); process.exit(1); }

const results = [];
for (const [i, agent] of targets.entries()) {
  const ref = imageRef(agent);
  const latest = imageRef(agent, "latest");
  console.log(`\n[${i + 1}/${targets.length}] ${agent.id} -> ${ref}`);

  const args = buildArgs(agent);
  const buildArgv = ["build", "-t", ref, "-t", latest];
  // Point the adapter layer at the base we just built, so a fresh clone works
  // before anything has been published.
  buildArgv.push("--build-arg", `ACP_BASE=${BASE_TAG}`);
  for (const [k, v] of Object.entries(args)) buildArgv.push("--build-arg", `${k}=${v}`);
  buildArgv.push("-f", path.join(ROOT, "images/adapter/Dockerfile"), path.join(ROOT, "images/adapter"));

  const code = await run("docker", buildArgv);
  if (code !== 0) { results.push({ id: agent.id, stage: "build", ok: false }); continue; }

  process.stdout.write("  smoke: ");
  const smoke = await smokeTest(ref);
  console.log(smoke.ok ? `ok (${smoke.reason})` : `FAILED (${smoke.reason})`);
  if (!smoke.ok && smoke.stderr) console.log(`  stderr tail: ${smoke.stderr.split("\n").slice(-4).join("\n  ")}`);
  if (!smoke.ok) { results.push({ id: agent.id, stage: "smoke", ok: false, reason: smoke.reason }); continue; }

  if (PUSH) {
    const a = await run("docker", ["push", ref]);
    const b = await run("docker", ["push", latest]);
    if (a !== 0 || b !== 0) { results.push({ id: agent.id, stage: "push", ok: false }); continue; }
  }
  if (PRUNE) {
    // Only ever removes tags this script created.
    await run("docker", ["rmi", ref, latest], { stdio: "ignore" });
  }
  results.push({ id: agent.id, ok: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${"=".repeat(56)}`);
console.log(`ok: ${results.length - failed.length}/${results.length}`);
for (const f of failed) console.log(`  ✗ ${f.id} (${f.stage}${f.reason ? `: ${f.reason}` : ""})`);
process.exit(failed.length ? 1 : 0);