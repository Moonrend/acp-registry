# Shared base layer for every ACP adapter image.
#
# Split out from the per-adapter image so all adapters share ONE copy of the
# apt tree and the runtime scripts. Docker dedupes identical layers by digest,
# so N adapters cost `base + N * (adapter payload)` on disk and on the wire
# instead of N full images. Rebuilding a single adapter never re-runs apt.
#
# Base is bookworm-slim (glibc), NOT alpine. Upstream registry binaries are
# built for x86_64-unknown-linux-gnu and segfault or fail to link on musl.
FROM node:22-bookworm-slim

# ca-certificates: TLS to model APIs. git: agents that inspect repo state.
# ripgrep: several agents shell out to `rg` for search.
# The archive tools cover every asset format the upstream registry ships.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        file \
        git \
        ripgrep \
        tar \
        gzip \
        bzip2 \
        unzip \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

ENV ACP_HOME=/opt/zakura/acp \
    PATH=/opt/zakura/acp/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_NO_WARNINGS=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN mkdir -p /opt/zakura/acp/bin /opt/zakura/acp/etc /workspace

# Baked into the base so a script change rebuilds one layer here rather than
# invalidating every adapter's install step.
COPY install-adapter.sh /usr/local/bin/install-adapter
COPY acp-entrypoint.sh /usr/local/bin/acp-entrypoint
RUN chmod +x /usr/local/bin/install-adapter /usr/local/bin/acp-entrypoint

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/acp-entrypoint"]