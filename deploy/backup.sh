#!/usr/bin/env sh
set -eu

# Run daily from the host (for example with cron). The database contains only
# encrypted study payloads, but retaining encrypted dumps makes disaster
# recovery and migrations practical.
cd "$(dirname "$0")"
. ./.env
backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
timestamp="$(date +%Y%m%d-%H%M%S)"
docker compose exec -T db pg_dump -U lexicue lexicue | gzip > "$backup_dir/lexicue-$timestamp.sql.gz"
find "$backup_dir" -type f -name 'lexicue-*.sql.gz' -mtime +14 -delete
