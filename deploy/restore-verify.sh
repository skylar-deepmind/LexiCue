#!/usr/bin/env sh
set -eu

backup_file="${1:?Usage: ./restore-verify.sh BACKUP.sql.gz.age AGE-IDENTITY.txt}"
identity_file="${2:?Usage: ./restore-verify.sh BACKUP.sql.gz.age AGE-IDENTITY.txt}"
command -v age >/dev/null 2>&1 || { echo "age is required" >&2; exit 1; }
test -f "$backup_file" || { echo "Backup does not exist: $backup_file" >&2; exit 1; }
test -f "$identity_file" || { echo "Identity does not exist: $identity_file" >&2; exit 1; }
backup_file="$(cd "$(dirname "$backup_file")" && pwd)/$(basename "$backup_file")"
identity_file="$(cd "$(dirname "$identity_file")" && pwd)/$(basename "$identity_file")"

cd "$(dirname "$0")"
restore_db="lexicue_restore_verify_$(date +%Y%m%d%H%M%S)"
cleanup() {
  docker compose exec -T db dropdb --if-exists -U lexicue "$restore_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker compose exec -T db createdb -U lexicue "$restore_db"
age --decrypt -i "$identity_file" "$backup_file" | gunzip | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U lexicue -d "$restore_db" >/dev/null

table_count="$(docker compose exec -T db psql -At -U lexicue -d "$restore_db" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
test "$table_count" -gt 0 || { echo "Restore completed but no public tables were found" >&2; exit 1; }

echo "Restore verification passed ($table_count public tables). Temporary database removed."
