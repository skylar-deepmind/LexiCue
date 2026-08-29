#!/usr/bin/env sh
set -eu

endpoint="${1:-http://127.0.0.1:8080}"
endpoint="${endpoint%/}"

health="$(curl --fail --silent --show-error "$endpoint/health")"
test "$health" = "ok" || { echo "Unexpected health response: $health" >&2; exit 1; }

capabilities="$(curl --fail --silent --show-error "$endpoint/v1/capabilities")"
printf '%s' "$capabilities" | grep -Eq '"protocol_version"[[:space:]]*:[[:space:]]*1([,}])' || {
  echo "Protocol version 1 was not advertised: $capabilities" >&2
  exit 1
}

echo "LexiCue sync endpoint is healthy and supports protocol version 1: $endpoint"
