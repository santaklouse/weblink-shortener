# Weblink Shortener

A minimal Node.js URL shortener with PocketBase running behind the application.

## Features

- Create short URLs without registration.
- Guest links expire after 24 hours by default.
- Each guest link includes an unguessable statistics page URL.
- Registration and sign-in use an `HttpOnly` session cookie.
- Email registrations must be verified before password sign-in is allowed.
- Email accounts can securely request and confirm password resets.
- Users can sign in or create an account with Google OAuth 2.0.
- Signed-in users can securely connect a Telegram bot with a one-time deep link.
- The Telegram bot can create, list, edit, enable, disable, delete, and inspect owned links.
- A Telegram Mini App provides the same link management and statistics inside Telegram.
- Registered users receive permanent links and a dashboard with click statistics.
- Custom slugs are available only to registered users and must be unique.
- Registered owners can enable, disable, and delete their links.
- Clicks are incremented atomically.
- Detailed analytics include country, referrer, masked visitor network, device, browser, operating system, recent click time, and expandable sanitized HTTP request metadata.
- Open statistics pages refresh their data in the background every 10 seconds without a page reload.
- Unique visitors are counted with a keyed hash; full IP addresses are never stored.
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
- `APP_DOMAIN`: the public URL shortener hostname.
- `ADMIN_DASHBOARD_DOMAIN`: the separate PocketBase administrator hostname.
- `PUBLIC_BASE_URL`: the complete public shortener URL including `http://` or `https://`.
- `ADMIN_ALLOWED_IP`: the administrator's public IP address with a `/32` mask.
- `ANALYTICS_HASH_SECRET`: a stable random secret containing at least 32 characters.
- `TUNNEL_TOKEN`: the Cloudflare Tunnel token when the `cloudflared` service is used.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth 2.0 web application credentials.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, and `SMTP_PASSWORD`: the transactional email server used for account verification, password reset, and email-change messages.
- `MAIL_FROM_ADDRESS`: a verified sender address accepted by the SMTP provider.
- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_INTERNAL_SECRET`: Telegram bot credentials and the private bot-to-application secret.

Generate the analytics secret once and save the printed value in `.env`:

```bash
openssl rand -hex 32
```

Generate a separate Telegram internal secret:

```bash
openssl rand -hex 32
```

The included development defaults use `localhost` and `pb.localhost`. Never leave `ADMIN_ALLOWED_IP=0.0.0.0/0` in production because it makes PocketBase Dashboard reachable from every IP address.

Start the stack:

```bash
docker compose up -d --build
```

Docker Compose automatically:

1. Builds PocketBase 0.39.9 and runs `./pocketbase serve --http=0.0.0.0:8090`.
2. Creates or updates the PocketBase superuser.
3. Creates the locked `users` and `short_links` collections.
4. Creates the locked `click_events` analytics collection.
5. Starts the Node.js application.
6. Starts Nginx and Cloudflare Tunnel after the health checks succeed.

The Telegram service uses an opt-in Compose profile and starts after its credentials are configured:

```bash
docker compose --profile telegram up -d --build setup app telegram-bot nginx
```

With the local defaults:

- Application: [http://localhost](http://localhost)
- PocketBase Dashboard: [http://pb.localhost/_/](http://pb.localhost/_/)

Sign in to PocketBase Dashboard with `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` from `.env`.

## Google sign-in

Create an OAuth 2.0 client in Google Cloud Console with the application type **Web application**. Its authorized redirect URI must be the exact `PUBLIC_BASE_URL` value followed by `/api/auth/google-callback`.

For local development with the default Node.js port, use:

```text
http://localhost:3000/api/auth/google-callback
```

The scheme, hostname, port, path, and trailing slash must exactly match the public URL used by the application. Production Google OAuth redirect URIs must use HTTPS. Because this application runs on a URL-shortener domain, keep the callback path ending in `/google-callback`.

Paste the generated client ID and client secret into the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` entries in `.env`.

Apply the collection configuration and restart the application:

```bash
docker compose up -d --build setup app nginx
```

The setup container enables Google OAuth for the PocketBase `users` collection and maps the Google profile name to the existing `name` field. The browser starts and completes authentication only through Node.js routes; the PocketBase URL, OAuth code verifier, PocketBase auth token, and Google client secret remain server-side.

## Telegram bot

Create the bot in Telegram by opening [@BotFather](https://t.me/BotFather), running `/newbot`, and following its prompts. Save the returned token as `TELEGRAM_BOT_TOKEN` and the bot username without `@` as `TELEGRAM_BOT_USERNAME`. Generate `TELEGRAM_INTERNAL_SECRET` with the command shown above; do not reuse the bot token or analytics secret. Set `TELEGRAM_WEBAPP_URL` to the public HTTPS URL of the Mini App; this deployment uses `https://l1n.pp.ua/telegram`.

### BotFather configuration

For `@weblink_shortener_bot`, use these exact settings in [@BotFather](https://t.me/BotFather):

1. Send `/mybots` and select `@weblink_shortener_bot`.
2. Open **Bot Settings → Configure Mini App → Enable Mini App**.
3. When BotFather asks for the Mini App URL, send `https://l1n.pp.ua/telegram`.
4. Open **Bot Settings → Menu Button**. Set the button text to `Open app` and its URL to `https://l1n.pp.ua/telegram`.
5. Optionally open **Edit Bot → Edit Description** and use `Create, manage, and inspect short links from Telegram.`
6. Optionally open **Edit Bot → Edit About** and use `A secure short-link dashboard with detailed click statistics.`

The bot also calls `setChatMenuButton` during startup, so step 4 is restored automatically after each deployment. Configuring the Main Mini App in step 2 is still recommended because it adds a prominent launch button to the bot profile.

Start the Telegram profile:

```bash
docker compose --profile telegram up -d --build setup app telegram-bot nginx
```

To sign in to the bot safely:

1. Sign in to the web application.
2. Select **Connect Telegram** in the dashboard.
3. Open the generated one-time Telegram link within 10 minutes.
4. Press **Start** in the private bot chat.

The website never sends an email password, Google token, PocketBase token, or browser session cookie to Telegram. The deep-link token is random, stored only as an HMAC hash, expires, and is deleted after use. The bot accepts account commands only in private chats.

Available commands:

- `/app`
- `/new <URL> [slug]`
- `/links`
- `/stats <slug>`
- `/edit <slug> <URL> [new-slug]`
- `/enable <slug>` and `/disable <slug>`
- `/delete <slug>`
- `/account`
- `/logout`
- `/help`

The bot communicates only with the private Node.js API at `http://app:3000` inside the Compose network. It never connects to PocketBase directly. Long polling is used, so no public Telegram webhook or additional domain is required. The Mini App sends Telegram `initData` to Node.js, which delegates signature validation to the bot's private validator on port `3001`. The bot token is never exposed to Node.js or the browser.

## Email verification

Password registrations do not create a browser session immediately. PocketBase sends a verification message, but its link always targets the public Node.js application at `PUBLIC_BASE_URL/verify-email`; the verification token is then confirmed by a server-side Node.js request to PocketBase. Unverified accounts can request a new message from the verification page.

The setup container replaces every PocketBase authentication template that contains a link:

- account verification uses `/verify-email`;
- password reset uses `/reset-password`;
- email change confirmation uses `/confirm-email-change`.

None of these messages use the PocketBase Dashboard domain or expose a PocketBase API URL. Run the setup service after changing `PUBLIC_BASE_URL` or either domain:

```bash
docker compose up -d --build setup app nginx
```

## Password reset email

Password reset requests are handled by Node.js and delivered by PocketBase. Configure the SMTP and sender entries already present in `.env` before using the flow in production. Use `SMTP_TLS=false` for a STARTTLS connection such as port 587, or `SMTP_TLS=true` when the SMTP provider requires an implicit TLS connection such as port 465.

`PUBLIC_BASE_URL` must be the public HTTPS origin of the shortener. The setup container uses that origin for links to `/reset-password`; PocketBase adds a single-use reset token to each message.

Apply the mail configuration and restart the application:

```bash
docker compose up -d --build setup app nginx
```

You can send a password-reset test email from PocketBase Dashboard under **Settings → Mail settings**. The SMTP password is passed only to the setup container and stored by PocketBase; it is never exposed to the browser or Node.js application container.

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

- `APP_DOMAIN` routes to Node.js and must match the hostname in `PUBLIC_BASE_URL`.
- `ADMIN_DASHBOARD_DOMAIN` routes only to PocketBase Dashboard and is protected by an IP allowlist.

In production, terminate TLS in front of this Nginx instance using Cloudflare, an external load balancer, or another HTTPS proxy. When HTTPS is enabled, set `NODE_ENV=production` and use an `https://` value for `PUBLIC_BASE_URL`. Session cookies will then include the `Secure` flag.

## Country analytics

Country lookup supports two modes.

### Local MaxMind database

Download `GeoLite2-Country.mmdb` from MaxMind and place it at:

```text
geoip/GeoLite2-Country.mmdb
```

The Docker container mounts this directory read-only and reloads the database when it changes. This is the recommended mode when the origin accepts traffic from the public internet.

### Cloudflare headers

When all public traffic is guaranteed to pass through Cloudflare, enable IP Geolocation or the visitor-location Managed Transform in Cloudflare and set:

```dotenv
TRUST_CLOUDFLARE_HEADERS=true
```

This trusts `CF-IPCountry` for the country and `CF-Connecting-IP` for privacy-masked visitor analytics. Do not enable it while clients can connect directly to the origin, because direct clients could spoof these headers.

Each newly recorded click also stores the request method, protocol, host, path, HTTP version, and request headers for the expandable event view. Authorization credentials, cookies, token/secret/key/password headers, sensitive query parameters, and headers containing the full client IP are redacted before the event is written to PocketBase. Header data is bounded to prevent oversized analytics records.

Cloudflare Tunnel deployments that route through the included Nginx proxy must enable this setting. Otherwise, click analytics see the intermediate Docker network and may display an address such as `172.18.0.0`. Recreate the application container after changing the value:

```bash
docker compose up -d --no-deps --force-recreate app
```

Full visitor IPs are never stored. IPv4 addresses are masked to `/24`, IPv6 addresses to `/48`, and unique visitors are derived with `HMAC-SHA256` using `ANALYTICS_HASH_SECRET`. Referrer URLs may contain query parameters, so the statistics URL should be treated as a secret for anonymous links.

## Access model

PocketBase collection API rules are locked. The browser calls only these Node.js endpoints:

- `POST /api/links`: create a short URL.
- `GET /api/stats/:token`: view statistics using the secret token.
- `POST /api/auth/register`: create an account.
- `POST /api/auth/login`: sign in.
- `POST /api/auth/resend-verification`: request a new account verification email.
- `POST /api/auth/verify-email`: confirm an account verification token.
- `POST /api/auth/forgot-password`: request a password reset email.
- `POST /api/auth/reset-password`: set a new password with a valid reset token.
- `POST /api/auth/confirm-email-change`: confirm an email-change token and password.
- `GET /api/auth/providers`: return enabled public sign-in choices.
- `GET /api/auth/google/start`: start Google authentication.
- `GET /api/auth/google-callback`: validate and complete Google authentication.
- `POST /api/auth/logout`: sign out.
- `GET /api/auth/me`: return the current user.
- `GET /api/links`: list the signed-in user's links.
- `PATCH /api/links/:id`: edit the destination URL or slug and enable or disable an owned link.
- `DELETE /api/links/:id`: delete an owned link.
- `GET /api/telegram/status`: return the signed-in user's Telegram connection status.
- `POST /api/telegram/link`: create a one-time Telegram deep link.
- `DELETE /api/telegram/link`: disconnect Telegram from the signed-in account.
- `GET /:slug`: redirect and increment the click counter.

PocketBase superuser credentials exist only in the `app` and `setup` container environments. They are not included in browser HTML or JavaScript.

The `/api/internal/telegram/*` routes require `TELEGRAM_INTERNAL_SECRET`, are called only from the Compose network, and always resolve link ownership from the stored Telegram binding. The bot container has no PocketBase credentials.

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
- `APP_DOMAIN=localhost`: public application hostname routed to Node.js.
- `ADMIN_DASHBOARD_DOMAIN=pb.localhost`: isolated PocketBase Dashboard hostname.
- `NGINX_PORT=80`: published Nginx port.
- `ANALYTICS_MAX_EVENTS=5000`: maximum events loaded for one detailed report.
- `ANALYTICS_RECENT_EVENTS=50`: number of recent clicks returned by the API.
- `GEOIP_DB_PATH=/geoip/GeoLite2-Country.mmdb`: local MaxMind database path.
- `TRUST_CLOUDFLARE_HEADERS=false`: trust Cloudflare location and visitor-IP headers.
- `TELEGRAM_LINK_TTL_MINUTES=10`: one-time Telegram login link lifetime.
- `TELEGRAM_WEBAPP_URL=https://l1n.pp.ua/telegram`: public HTTPS Mini App URL.
- `TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS=86400`: maximum accepted age of signed Telegram Mini App authentication data.
- `TELEGRAM_POLL_TIMEOUT_SECONDS=25`: Telegram Bot API long-poll timeout.

## Verification

```bash
npm run check
docker compose config --quiet
```

The tests cover URL validation, slug handling, and the unpredictability of statistics tokens. A public deployment should also add CAPTCHA and destination-domain moderation.
