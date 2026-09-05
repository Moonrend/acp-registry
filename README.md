# acp-registry

Build definitions and runtime declarations for [ACP](https://agentclientprotocol.com)
adapter containers.

Each agent is described by exactly one file in [`agents/`](agents). That file is
the only place per-agent knowledge lives: how to install the adapter, how to
launch it, and where its credentials persist. Hosts consume the compiled
[`dist/index.json`](dist/index.json) and carry no agent-specific code.

**Adding an agent is a single-file pull request here.** No host changes.

## Layout

| Path | Purpose |
| --- | --- |
| `agents/<id>.json` | One declaration per agent — dist, storage, auth |
| `schema/agent.schema.json` | Schema the declarations validate against |
| `images/base/` | Shared base image: OS packages, entrypoint, installer |
| `images/adapter/` | Generic per-agent layer, driven entirely by build args |
| `dist/index.json` | Compiled index that hosts fetch |
| `tools/` | Validate, build, index, and upstream-sync scripts |

## Images

Two layers keep 39 agents cheap to build:

```
images/base      node:22-bookworm-slim + ca-certificates, curl, git, ripgrep, tar ...
      └── images/adapter   installs one agent via ACP_* build args
```

The base is built once and shared, so a per-agent layer only adds that agent's
own bytes. Images publish to `ghcr.io/moonrend/acp-registry/<id>:<version>`
(plus `:latest`).

Debian rather than Alpine is deliberate: several upstream adapters ship glibc
binaries that do not run against musl.

## Declaration format

```jsonc
{
  "id": "codex-acp",
  "name": "Codex",
  "version": "1.10.0",
  "enabled": true,
  "profileId": "codex",          // stable host-side id
  "dist": {                       // how to install
    "kind": "npx",               // npx | uvx | binary
    "package": "@zed-industries/codex-acp@1.10.0"
  },
  "storage": {                    // how credentials persist
    "mode": "files",             // home | state-home | files | none
    "env": { "CODEX_HOME": "${STATE_DIR}" },
    "artifacts": [
      { "durable": ".codex/auth.json", "runtime": "auth.json", "sync": "codex_auth" }
    ]
  },
  "auth": { "modes": ["self", "oauth", "api_key"], "apiKeyEnv": ["OPENAI_API_KEY"] }
}
```

### `storage.mode`

| Mode | Behaviour |
| --- | --- |
| `home` | Persist the whole `$HOME`. |
| `state-home` | Persist `$HOME` under a state dir, with XDG vars pointed at it. |
| `files` | Persist an explicit `artifacts` list only. |
| `none` | Stateless. |

`${STATE_DIR}`, `${RUNTIME_DIR}` and `${HOME_DIR}` are expanded by the host.

## Tools

```bash
node tools/validate.mjs         # schema + policy checks
node tools/build-index.mjs      # regenerate dist/index.json
node tools/build-index.mjs --check

node tools/build.mjs                        # build + smoke-test enabled agents
node tools/build.mjs --all --push --prune   # everything, publish, reclaim disk
node tools/build.mjs --only cursor,goose

node tools/sync-upstream.mjs            # report upstream drift
node tools/sync-upstream.mjs --write    # apply and re-pin checksums
```

Every build runs a real ACP `initialize` handshake against the finished
container; an image that does not answer fails the build.

`--prune` removes each image after pushing, which is what makes a full
39-agent run possible on a small disk.

## Guarantees

- **Binaries are checksum-pinned.** `dist.sha256` is mandatory for
  `kind: binary` and verified at build time; validation refuses a declaration
  without one.
- **Upstream drift is caught daily.** A scheduled workflow re-checks upstream,
  re-pins checksums, and opens a PR. Local policy fields (`enabled`,
  `profileId`, `storage`, `auth`) are never overwritten.
- **Artifact paths are sandboxed.** Absolute paths and `..` are rejected, so a
  declaration cannot write outside its own volume.