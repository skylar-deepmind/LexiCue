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
trap 'rm -f "$partial"' EXIT HUP INT TERM
docker compose exec -T db pg_dump --clean --if-exists -U lexicue lexicue | gzip | age -r "$BACKUP_AGE_RECIPIENT" -o "$partial"
test -s "$partial" || { echo "encrypted backup is empty" >&2; exit 1; }
mv "$partial" "$target"
trap - EXIT HUP INT TERM
find "$backup_dir" -type f -name 'lexicue-*.sql.gz.age' -mtime "+$retention_days" -delete
echo "Encrypted backup created: $target"
