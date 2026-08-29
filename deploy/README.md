# LexiCue sync production deployment

The production topology is intentionally small: Docker Compose runs PostgreSQL
and the sync API; the host's existing Nginx terminates HTTPS. The API only binds
to `127.0.0.1:8080`, and PostgreSQL has no host port.

## 1. Prepare the server

Install Docker Engine with the Compose plugin, Nginx, Certbot, `curl`, and
[`age`](https://age-encryption.org/). Point the sync domain's DNS record at the
server. Only ports 22, 80, and 443 should be reachable from the Internet.

Check out an explicit release tag or commit under `/opt/lexicue`, then create the
deployment environment:

```sh
cd /opt/lexicue/deploy
cp .env.example .env
chmod 600 .env
```

Generate independent random values for `POSTGRES_PASSWORD` and
`SYNC_METRICS_TOKEN`. Configure `BACKUP_AGE_RECIPIENT` with an age public key
whose private identity is stored offline. Never commit `.env` or the identity.

## 2. Start PostgreSQL and the API

```sh
docker compose config
docker compose up -d --build
docker compose ps
./verify.sh
```

The API creates its v1 schema at startup. No v2/v3 migration or baseline is
required. Inspect startup failures with `docker compose logs api db`.

## 3. Configure Nginx and HTTPS

Copy `nginx/lexicue-sync.conf.example` into the host's Nginx configuration,
replace every `sync.example.com` with the real domain, and provision the TLS
certificate. The exact Certbot command depends on the distribution and existing
Nginx layout. Before reload, always run:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

The example forwards required proxy headers, allows 16 MiB requests and
120-second uploads, and rejects public `/metrics` access. Monitor metrics from
the host through `http://127.0.0.1:8080/metrics` with the
`x-sync-metrics-token` header.

Verify the public endpoint after DNS and TLS are active:

```sh
./verify.sh https://sync.example.com
curl --fail https://sync.example.com/health
curl --fail https://sync.example.com/v1/capabilities
```

The capabilities response must advertise `"protocol_version":1`.

## 4. Encrypted daily backups

Run `./backup.sh` once and verify the encrypted output. It never writes a
plaintext dump and retains 30 days by default. To install the supplied systemd
timer, adjust `/opt/lexicue` in both unit files if the checkout lives elsewhere,
then copy and enable them:

```sh
sudo cp systemd/lexicue-sync-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lexicue-sync-backup.timer
systemctl list-timers lexicue-sync-backup.timer
```

At least monthly, copy one backup to an isolated test environment and run:

```sh
./restore-verify.sh backups/lexicue-YYYYMMDD-HHMMSS.sql.gz.age /offline/path/age-identity.txt
```

The script restores into a temporary database, verifies that tables exist, and
drops it. Do not put the offline age identity on the production server merely to
run this check.

## 5. Build and release clients

After the public verification passes, add the GitHub Actions repository variable
`LEXICUE_SYNC_ENDPOINT=https://sync.example.com`. Do not include a trailing slash
or `/v1`. This endpoint is public configuration; database passwords, metrics
tokens, Android signing material, and recovery keys remain secrets.

Manually run **Build Installers** as a Draft Release first. Complete the two-device,
offline-conflict, large-blob, Android credential-store, and backup-restore checks
before promoting the draft to a public release.

## Updating

Deploy immutable commits or tags, not a long-running `cargo run` process:

```sh
git fetch --tags
git checkout <verified-tag-or-commit>
cd deploy
docker compose up -d --build
./verify.sh
```

Keep the previous image/commit available until the health and client smoke tests
have passed. Database backups are still required before every production update.
