# LexiCue sync deployment

1. Copy `.env.example` to `.env`, set a unique long `POSTGRES_PASSWORD`, and point `SYNC_DOMAIN` at this server.
2. Open TCP ports 80 and 443 only. PostgreSQL is deliberately not exposed.
3. If this deployment owns ports 80 and 443, run `docker compose up -d --build` from this directory. If an existing Caddy owns those ports, use `docker compose -f docker-compose.shared-caddy.yml up -d --build` and add its `sync` host to that Caddy configuration.
4. Verify `https://$SYNC_DOMAIN/health` returns `ok`, then use that URL in LexiCue's Cloud Sync settings.
5. Schedule `backup.sh` once per day on the host. It retains 14 days of encrypted PostgreSQL dumps by default.

Caddy obtains and renews the TLS certificate automatically after DNS is in place.
