FROM rust:1.85-alpine AS build
RUN apk add --no-cache musl-dev pkgconfig
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && printf 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
COPY schema.sql ./schema.sql
# Docker COPY may preserve an older source mtime than the placeholder compiled
# above. Touching the real entry point prevents Cargo from reusing that empty
# binary from the dependency-cache layer.
RUN touch src/main.rs && cargo build --release

FROM alpine:3.21
RUN addgroup -S lexicue && adduser -S lexicue -G lexicue
COPY --from=build /app/target/release/lexicue-sync-server /usr/local/bin/lexicue-sync-server
USER lexicue
EXPOSE 8080
CMD ["lexicue-sync-server"]
