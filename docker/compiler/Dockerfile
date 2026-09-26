FROM rust:1.86-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY apps/compiler-server apps/compiler-server
RUN cargo build --release -p tikzforge-compiler-server

# Downloads a pinned, checksum-verified Tectonic release and bakes an offline package cache for
# everything docker/compiler/warmup.tex uses. This is the only stage with network access.
FROM debian:bookworm-slim AS tectonic
ARG TARGETARCH
ARG TECTONIC_VERSION=0.17.0
ARG TECTONIC_SHA256_AMD64=8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7
ARG TECTONIC_SHA256_ARM64=b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH:-amd64}" in \
      amd64) triple=x86_64-unknown-linux-musl; sha256="$TECTONIC_SHA256_AMD64" ;; \
      arm64) triple=aarch64-unknown-linux-musl; sha256="$TECTONIC_SHA256_ARM64" ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/tectonic.tar.gz \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${triple}.tar.gz" \
    && echo "${sha256}  /tmp/tectonic.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic \
    && rm /tmp/tectonic.tar.gz
ENV TECTONIC_CACHE_DIR=/opt/tectonic-cache
COPY docker/compiler/warmup.tex /tmp/warmup/warmup.tex
# The second run proves the cache is complete without network access.
RUN tectonic --untrusted --chatter=minimal --outdir /tmp/warmup /tmp/warmup/warmup.tex \
    && tectonic --untrusted --only-cached --chatter=minimal --outdir /tmp/warmup /tmp/warmup/warmup.tex \
    && rm -rf /tmp/warmup \
    && chmod -R a+rX,a-w "$TECTONIC_CACHE_DIR"

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY --from=tectonic /usr/local/bin/tectonic /usr/local/bin/tectonic
COPY --from=tectonic /opt/tectonic-cache /opt/tectonic-cache
COPY --from=builder /src/target/release/tikzforge-compiler-server /usr/local/bin/tikzforge-compiler-server
ENV TECTONIC_BIN=/usr/local/bin/tectonic
ENV TECTONIC_CACHE_DIR=/opt/tectonic-cache
ENV RUST_LOG=info
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/tikzforge-compiler-server"]
