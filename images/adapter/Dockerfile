# Per-adapter image. One image per ACP agent, built FROM the shared base.
#
# The adapter itself is PID 1 and speaks ACP JSON-RPC over stdin/stdout, which
# is what Zakura's ContainerRuntime.attachStdio connects to. There is no
# supervisor and no shell wrapper in the hot path: anything written to stdout
# that is not JSON-RPC will corrupt the protocol stream.
#
# Everything above the install step comes from the base image, so adding or
# rebuilding an adapter touches exactly one layer.
ARG ACP_BASE=ghcr.io/moonrend/acp-registry/base:latest
FROM ${ACP_BASE}

# ACP_KIND is one of: npx | uvx | binary
ARG ACP_ID
ARG ACP_KIND
ARG ACP_PACKAGE=""
ARG ACP_ARCHIVE=""
ARG ACP_SHA256=""
ARG ACP_CMD=""
ARG ACP_VERSION=""
# args/env come straight from the registry as JSON. They are parsed inside the
# installer (with node, which is already present) rather than re-quoted through
# a shell string, which is where this kind of plumbing usually corrupts values.
ARG ACP_ARGS="[]"
ARG ACP_ENV="{}"
# Comma-separated "pkg==ver" pins for transitive deps upstream left unbounded.
ARG ACP_CONSTRAINTS=""

ENV ACP_ID=${ACP_ID} \
    ACP_KIND=${ACP_KIND} \
    ACP_VERSION=${ACP_VERSION}

# Installs the adapter AND bakes ${ACP_HOME}/etc/{argv,env}. Only this step can
# resolve the real executable path: npm bin names are not derivable from the
# package name, and archive layouts vary per release.
RUN ACP_ARGS="${ACP_ARGS}" ACP_ENV="${ACP_ENV}" ACP_CONSTRAINTS="${ACP_CONSTRAINTS}" \
    /usr/local/bin/install-adapter \
    && test -s "${ACP_HOME}/etc/argv" \
    && test -x "$(head -n1 "${ACP_HOME}/etc/argv")"

# Credentials live on a per-adapter volume mounted here, so they survive
# container replacement and stay isolated between adapters.
ENV HOME=/home/acp
RUN mkdir -p /home/acp && chmod 700 /home/acp
VOLUME ["/home/acp"]

# Image-level provenance so a running container can be traced to its source.
LABEL org.opencontainers.image.source="https://github.com/Moonrend/acp-registry" \
      org.opencontainers.image.licenses="MIT" \
      dev.zakura.acp.id="${ACP_ID}" \
      dev.zakura.acp.kind="${ACP_KIND}" \
      dev.zakura.acp.version="${ACP_VERSION}"

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/acp-entrypoint"]
