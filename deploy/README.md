# LexiCue sync deployment

1. Copy `.env.example` to `.env`, set a unique long `POSTGRES_PASSWORD`, and point `SYNC_DOMAIN` at this server.
2. Open TCP ports 80 and 443 only. PostgreSQL is deliberately not exposed.
3. If this deployment owns ports 80 and 443, run `docker compose up -d --build` from this directory. If an existing Caddy owns those ports, use `docker compose -f docker-compose.shared-caddy.yml up -d --build` and add its `sync` host to that Caddy configuration.
4. Verify `https://$SYNC_DOMAIN/health` returns `ok`, then use that URL in LexiCue's Cloud Sync settings.
5. Install [age](https://age-encryption.org/) on the host, set `BACKUP_AGE_RECIPIENT` to your offline age public recipient, and run `./backup.sh` once manually. It fails closed when the recipient or `age` is missing, and retains 14 days of `.sql.gz.age` encrypted dumps by default. Test recovery separately with `age -d -i /path/to/private-key.txt backup.sql.gz.age | gunzip`.
6. Set `SYNC_METRICS_TOKEN` if you need `/metrics`; send it only from a trusted monitoring job in the `x-sync-metrics-token` header. `/health` checks both the process and PostgreSQL.

Caddy obtains and renews the TLS certificate automatically after DNS is in place.
