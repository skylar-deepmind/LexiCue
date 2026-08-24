FROM rust:1.85-alpine AS build
RUN apk add --no-cache musl-dev pkgconfig
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && printf 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
COPY schema.sql ./schema.sql
RUN cargo build --release

FROM alpine:3.21
RUN addgroup -S lexicue && adduser -S lexicue -G lexicue
COPY --from=build /app/target/release/lexicue-sync-server /usr/local/bin/lexicue-sync-server
USER lexicue
EXPOSE 8080
CMD ["lexicue-sync-server"]
