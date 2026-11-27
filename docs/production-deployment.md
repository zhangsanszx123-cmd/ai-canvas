# AI Canvas production deployment

## Parameters

- Repository: `zhangsanszx123-cmd/ai-canvas` (private).
- Public origin: `http://43.143.85.207:8082`.
- SSH user: `ubuntu`, port `22`; dedicated key: `~/.ssh/ai-canvas-deploy`.
- Project directory: `/opt/projects/ai-canvas`.
- Compose project / image: `ai-canvas`.
- App listener: `127.0.0.1:13002` -> container `3000`.
- External Docker network: `1panel-network` (gateway `172.18.0.1`).
- Existing port 80 / free-video and port 8081 / ai-tools are preserved.

## Runtime and data

Next.js standalone and one persistent worker run from the same verified image. Worker uses a PostgreSQL advisory lock; run only one worker against a database. PostgreSQL holds accounts, sessions, canvas state and task leases. S3 holds images; no local business-data bind mounts are needed. The app and worker each have a 1 GiB memory limit.

Edit `/opt/projects/ai-canvas/deploy/runtime.env` directly on the server (mode 600). Required variables: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `TOAPIS_API_KEY`, `DEEPSEEK_API_KEY`. Optional variables follow `.env.example` and `docs/environment.md`. Never send values in chat or commit this file. Compose supplies `APP_URL=http://43.143.85.207:8082` and `DB_CA_CERT=/run/secrets/postgres-ca.pem` and `DB_TLS_SERVERNAME=43.143.85.207` (verified certificate SAN). HTTP requires session cookies without Secure; verify the installed Better Auth behavior before launch. SMTP is optional.

The existing dedicated `ai-canvas` database is retained. Production uses `ai_canvas_app`, a dedicated non-superuser role with schema usage and application-table DML permissions; it cannot create databases, roles or schema objects. Migration history is read-only. The generated role credential is stored only in server runtime.env. The internal database name must match its TLS certificate, or use an explicitly verified certificate identity; never disable verification. The CA is mounted read-only from `deploy/secrets/postgres-ca.pem`. The existing shared PostgreSQL currently publishes 5432 publicly; changing that shared service requires separate coordination because local development may depend on it. An application container must use the internal Docker network, not the public published port.

Review pending SQL migrations before running them manually; CI and container startup never migrate. After loading the first image, use `APP_IMAGE=<verified image> docker compose run --rm --no-deps app node --conditions=react-server migrate.mjs`. This command can alter schema, so review the selected production database and migration plan first and supply separate operator credentials for the one-off migration; runtime credentials intentionally lack DDL privileges. An existing worker using the same database must be stopped before launching the production worker.

## Release

GitHub Environment `production` permits only `main`. Five environment secrets hold SSH host, port, user, private key and trusted known_hosts. Build uses only placeholder configuration, never production credentials. The workflow runs typecheck, lint and service-free regression tests, builds linux/amd64, computes the portable config digest, uploads a one-day artifact, and sends it over SSH. The receiving scripts verify archive SHA-256, image config digest and local image identity, then await health for both app and worker. Failures restore the previous image for both services.

Public port 8082 must be allowed by the cloud firewall. OpenResty listens on 8082 and forwards to `127.0.0.1:13002`; use `$http_host` to preserve the port, replace forwarded client IP with `$remote_addr`, disable proxy buffering and permit at least 10 MB image uploads. Do not expose 13002 publicly. Authentication rate limiting depends on the proxy supplying a trustworthy client IP.

## Verify and rollback

Check `docker compose ps`, homepage, static assets, public project API, login with a nonexistent account (expect authentication failure, not INVALID_ORIGIN), and no public connection to port 13002. Check worker health and database TLS. Verify login cookies over HTTP. Real paid model generation requires a separate explicit test; do not claim it was tested merely because containers are healthy.

Rollback: `bash deploy/deploy.sh "$(cat deploy/previous-image)"`. Retain current and previous images. Environment changes require force-recreation of both services. Back up the database, S3 objects, runtime.env, CA, and release history; protect backups of secrets.

## Deployment status

2026-11-27: deployed successfully at http://43.143.85.207:8082/.

- Source release: `4883cb2`.
- Verified image: `ai-canvas:sha256-486fd130d78e9d2b80cba8c7338d87d9cfa8e9b86e1af7d814fec7977cba43cf`.
- Successful workflow: https://github.com/zhangsanszx123-cmd/ai-canvas/actions/runs/46027425197.
- Default repository branch is now `main`; production environment permits `main` only.
- Both app and worker are healthy; worker heartbeat was one second old during final verification.
- Runtime values were imported from local .env over SSH with explicit user authorization; no values were printed or committed. Database credentials were replaced with the restricted server-generated app role. Local .env remains unchanged.
- OpenResty proxy is active on 8082. The user confirmed cloud firewall port 8082 was allowed. Existing sites on 80 and 8081 return 200. Port 13002 has no public HTTP response.
- Typecheck, lint, regression tests and image build succeeded. The image includes a worker module-loading check. The standalone worker aliases next/server to next/server.js for native ESM resolution.
- Public homepage, JavaScript assets, project listing and private API rejection passed. Public registration, login, HTTP cookie session, authenticated API and logout passed; temporary accounts were deleted.
- Desktop and mobile browser checks passed with zero page errors and no mobile horizontal overflow. Existing project images displayed correctly.
- Database TLS and rejection of an invalid certificate identity were verified. S3 bucket HEAD and read-only ToAPIs / DeepSeek model lists returned success from the application container. No paid generation was initiated as a verification test.
- Final homepage returns 200 and has no localhost metadata references. Public APP_URL is supplied at build time for static metadata, and at runtime for authentication.
- This is the first successful release; previous-image becomes available after the next successful image change. Preserve both current and previous images for future rollback.

The checked proxy template is deploy/openresty-8082.conf. Future migration operations require separate operator credentials and grants for any newly added tables; the runtime role intentionally has no DDL privileges.
