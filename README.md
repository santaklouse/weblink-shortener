# Weblink Shortener

A minimal Node.js URL shortener with PocketBase running behind the application.

## Features

- Create short URLs without registration.
- Guest links expire after 24 hours by default.
- Each guest link includes an unguessable statistics page URL.
- Registration and sign-in use an `HttpOnly` session cookie.
- Registered users receive permanent links and a dashboard with click statistics.
- Custom slugs are available only to registered users and must be unique.
- Registered owners can enable, disable, and delete their links.
- Clicks are incremented atomically.
- PocketBase Dashboard is available on a separate administrator hostname.
- The public hostname proxies only to Node.js. PocketBase credentials and API calls are never exposed to the browser.

## Quick start with Docker Compose

Docker Engine and Docker Compose are required.

```bash
cd /Users/alexnevpryaga/projects/santaklouse/weblink-shortener
cp .env.example .env
```

Open `.env` and set these values before starting the stack:

- `PB_SUPERUSER_EMAIL`: the PocketBase administrator email.
- `PB_SUPERUSER_PASSWORD`: a long, unique administrator password.
- `SHORTENER_DOMAIN`: the public URL shortener hostname.
- `POCKETBASE_ADMIN_DOMAIN`: a separate PocketBase administrator hostname.
- `PUBLIC_BASE_URL`: the complete public shortener URL including `http://` or `https://`.
- `ADMIN_ALLOWED_IP`: the administrator's public IP address with a `/32` mask.

The included development defaults use `localhost` and `pb.localhost`. Never leave `ADMIN_ALLOWED_IP=0.0.0.0/0` in production because it makes PocketBase Dashboard reachable from every IP address.

Start the stack:

```bash
docker compose up -d --build
```

Docker Compose automatically:

1. Builds PocketBase 0.39.9 and runs `./pocketbase serve --http=0.0.0.0:8090`.
2. Creates or updates the PocketBase superuser.
3. Creates the locked `users` and `short_links` collections.
4. Starts the Node.js application.
5. Starts Nginx after the Node.js health check succeeds.

With the local defaults:

- Application: [http://localhost](http://localhost)
- PocketBase Dashboard: [http://pb.localhost/_/](http://pb.localhost/_/)

Sign in to PocketBase Dashboard with `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` from `.env`.

Check the stack:

```bash
docker compose ps
docker compose logs -f app pocketbase nginx
```

Stop the stack without deleting data:

```bash
docker compose down
```

PocketBase data is stored in the named Docker volume `pocketbase_data`. The command `docker compose down -v` also deletes the database and should only be used when the stored data is no longer needed.

## Domain and HTTPS

Create `A` or `AAAA` DNS records for the public and administrator hostnames pointing to the server. The included Nginx configuration listens on port `80` and selects the upstream by hostname:

- `SHORTENER_DOMAIN` routes to Node.js.
- `POCKETBASE_ADMIN_DOMAIN` routes to PocketBase and is protected by an IP allowlist.

In production, terminate TLS in front of this Nginx instance using Cloudflare, an external load balancer, or another HTTPS proxy. When HTTPS is enabled, set `NODE_ENV=production` and use an `https://` value for `PUBLIC_BASE_URL`. Session cookies will then include the `Secure` flag.

## Access model

PocketBase collection API rules are locked. The browser calls only these Node.js endpoints:

- `POST /api/links`: create a short URL.
- `GET /api/stats/:token`: view statistics using the secret token.
- `POST /api/auth/register`: create an account.
- `POST /api/auth/login`: sign in.
- `POST /api/auth/logout`: sign out.
- `GET /api/auth/me`: return the current user.
- `GET /api/links`: list the signed-in user's links.
- `PATCH /api/links/:id`: enable or disable an owned link.
- `DELETE /api/links/:id`: delete an owned link.
- `GET /:slug`: redirect and increment the click counter.

PocketBase superuser credentials exist only in the `app` and `setup` container environments. They are not included in browser HTML or JavaScript.

## Running without Docker

Node.js 22 or newer and a running PocketBase server are required.

```bash
npm install
cp .env.example .env
npm run setup:db
npm start
```

PocketBase can be started locally with:

```bash
./pocketbase serve --http=127.0.0.1:8090
```

Set either `POCKETBASE_TOKEN` or both `POCKETBASE_SUPERUSER_EMAIL` and `POCKETBASE_SUPERUSER_PASSWORD` in `.env`.

## Configuration

- `ANONYMOUS_LINK_TTL_HOURS=24`: guest link lifetime.
- `RATE_LIMIT_MAX=30`: maximum API requests per IP address per 15 minutes.
- `SESSION_MAX_AGE_DAYS=7`: session cookie lifetime.
- `TRUST_PROXY=true`: trust the client IP forwarded by Nginx.
- `NGINX_PORT=80`: published Nginx port.

## Verification

```bash
npm run check
PB_SUPERUSER_EMAIL=admin@example.com PB_SUPERUSER_PASSWORD='correct-horse-battery-staple-2026' docker compose config --quiet
```

The tests cover URL validation, slug handling, and the unpredictability of statistics tokens. A public deployment should also add CAPTCHA and destination-domain moderation.
