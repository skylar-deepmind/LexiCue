#!/usr/bin/env sh
set -eu

# Run daily from the host. A backup is never created unless it can be encrypted
# for the configured age recipient.
cd "$(dirname "$0")"
. ./.env
: "${BACKUP_AGE_RECIPIENT:?Set BACKUP_AGE_RECIPIENT to an age1... recipient before backing up}"
command -v age >/dev/null 2>&1 || { echo "age is required for encrypted backups" >&2; exit 1; }
backup_dir="${BACKUP_DIR:-./backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
case "$retention_days" in *[!0-9]*|'') echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2; exit 1;; esac
mkdir -p "$backup_dir"
umask 077
timestamp="$(date +%Y%m%d-%H%M%S)"
target="$backup_dir/lexicue-$timestamp.sql.gz.age"
partial="$target.partial"
dump_tmp="$(mktemp)"
gzip_tmp="$(mktemp)"
trap 'rm -f "$partial" "$dump_tmp" "$gzip_tmp"' EXIT HUP INT TERM

if ! docker compose exec -T db pg_dump --clean --if-exists -U lexicue lexicue >"$dump_tmp"; then
  echo "database dump failed; no backup was created" >&2
  exit 1
fi
if ! gzip -c "$dump_tmp" >"$gzip_tmp"; then
  echo "database compression failed; no backup was created" >&2
  exit 1
fi
if ! age -r "$BACKUP_AGE_RECIPIENT" -o "$partial" "$gzip_tmp"; then
  echo "backup encryption failed; no backup was created" >&2
  exit 1
fi
test -s "$partial" || { echo "encrypted backup is empty" >&2; exit 1; }
mv "$partial" "$target"
trap - EXIT HUP INT TERM
rm -f "$dump_tmp" "$gzip_tmp"
find "$backup_dir" -type f -name 'lexicue-*.sql.gz.age' -mtime "+$retention_days" -delete
echo "Encrypted backup created: $target"
