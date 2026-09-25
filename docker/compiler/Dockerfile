FROM rust:1.86-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY apps/compiler-server apps/compiler-server
RUN cargo build --release -p tikzforge-compiler-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates poppler-utils && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/tikzforge-compiler-server /usr/local/bin/tikzforge-compiler-server
# Set TECTONIC_BIN to a trusted image-local binary when building an image with Tectonic cached.
ENV RUST_LOG=info
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/tikzforge-compiler-server"]
