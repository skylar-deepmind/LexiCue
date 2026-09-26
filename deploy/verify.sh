#!/usr/bin/env sh
set -eu

endpoint="${1:-http://127.0.0.1:8080}"
endpoint="${endpoint%/}"
attempts="${VERIFY_ATTEMPTS:-12}"
retry_seconds="${VERIFY_RETRY_SECONDS:-3}"

case "$attempts" in *[!0-9]*|'') echo "VERIFY_ATTEMPTS must be a positive integer" >&2; exit 1;; esac
case "$retry_seconds" in *[!0-9]*|'') echo "VERIFY_RETRY_SECONDS must be a non-negative integer" >&2; exit 1;; esac
test "$attempts" -gt 0 || { echo "VERIFY_ATTEMPTS must be a positive integer" >&2; exit 1; }

attempt=1
while [ "$attempt" -le "$attempts" ]; do
  health="$(curl --fail --silent --show-error "$endpoint/health" 2>/dev/null || true)"
  if [ "$health" = "ok" ]; then
    capabilities="$(curl --fail --silent --show-error "$endpoint/v1/capabilities" 2>/dev/null || true)"
    if printf '%s' "$capabilities" | grep -Eq '"protocol_version"[[:space:]]*:[[:space:]]*1([,}])'; then
      echo "LexiCue sync endpoint is healthy and supports protocol version 1: $endpoint"
      exit 0
    fi
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$retry_seconds"
  fi
  attempt=$((attempt + 1))
done

echo "Sync endpoint did not become healthy with protocol version 1 after $attempts attempts: $endpoint" >&2
exit 1
