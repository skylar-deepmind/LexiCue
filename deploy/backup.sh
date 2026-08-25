#!/usr/bin/env sh
set -eu

# Run daily from the host (for example with cron). A backup is never created
# unless it can be encrypted for the configured age recipient.
cd "$(dirname "$0")"
. ./.env
: "${BACKUP_AGE_RECIPIENT:?Set BACKUP_AGE_RECIPIENT to an age1... recipient before backing up}"
command -v age >/dev/null 2>&1 || { echo "age is required for encrypted backups" >&2; exit 1; }
backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
umask 077
timestamp="$(date +%Y%m%d-%H%M%S)"
target="$backup_dir/lexicue-$timestamp.sql.gz.age"
docker compose exec -T db pg_dump -U lexicue lexicue | gzip | age -r "$BACKUP_AGE_RECIPIENT" -o "$target"
find "$backup_dir" -type f -name 'lexicue-*.sql.gz.age' -mtime +14 -delete
