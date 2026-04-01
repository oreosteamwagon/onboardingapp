# OnboardingApp

A self-hosted employee onboarding platform built with Next.js 14. HR and admin staff define task-based workflows, assign them to new hires, track completion, and manage approvals from a single web interface.

Developed with [Claude Code](https://claude.ai/code).

---

## Features

- **Workflow builder** -- compose reusable tasks into named workflows and assign them to users
- **Three task types** -- Standard (checkbox), Upload (file submission), and Learning (course + scored quiz)
- **Approval queue** -- supervisors and HR review and approve/reject uploaded submissions
- **Learning courses** -- rich-text course content with multiple-choice quizzes and printable pass certificates
- **Resources library** -- upload files or add web links that users can access from their dashboard
- **Document categories** -- admin-defined categories for organising resource documents
- **Role-based access control** -- five-role hierarchy with per-route and per-resource enforcement
- **Email notifications** -- SMTP or Microsoft Graph (Entra ID) for overdue task reminders and workflow events
- **Branding** -- customisable organisation name, logo, and primary/accent colours
- **Structured audit logs** -- JSON logs to stdout and database, viewable by admins with configurable retention
- **Rate limiting** -- Redis-backed per-user and per-IP limits on logins, uploads, approvals, and other sensitive actions

## Role Hierarchy

Roles are cumulative -- each role inherits the permissions of all roles below it.

| Role | Key permissions |
|------|----------------|
| `USER` | Complete own tasks, view own resources and documents |
| `SUPERVISOR` | View and approve tasks for users in supervised workflows |
| `PAYROLL` | All supervisor permissions + upload documents, view all documents |
| `HR` | All payroll permissions + manage tasks, workflows, courses, and assign users |
| `ADMIN` | Full access including users, branding, categories, email config, logs, and factory reset |

## Tech Stack

- **Framework** -- Next.js 14 (App Router, standalone output)
- **Auth** -- Auth.js v5 (next-auth 5.0.0-beta.25), Credentials provider, JWT sessions, Argon2id
- **Database** -- PostgreSQL 16 via Prisma 5
- **Cache / Rate limiting** -- Redis 7 (authenticated, required in production)
- **Styling** -- Tailwind CSS
- **Rich text** -- TipTap v2
- **Container** -- Docker + Docker Compose

---

## Local Development

Local development runs the app directly on your machine with Node.js. There is no TLS, no reverse proxy, and no Docker required. The app runs on `http://localhost:3000` with hot-reload enabled so code changes appear immediately in the browser.

This mode is for developing and testing the application. It is not suitable for production use.

### Prerequisites

- Node.js 20+
- PostgreSQL 16 running locally (or via `docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine`)
- Redis 7 running locally (or via `docker run -p 6379:6379 redis:7-alpine`). Optional -- the app falls back to in-memory rate limiting if `REDIS_URL` is not set, but this is single-process only.

### Step 1. Install dependencies

```bash
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required because TipTap v2 and next-auth v5 beta have peer dependency conflicts that do not affect runtime behaviour.

### Step 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with development values:

```env
DATABASE_URL="postgresql://postgres:dev@localhost:5432/onboarding"
POSTGRES_USER=postgres
POSTGRES_PASSWORD=dev
POSTGRES_DB=onboarding

AUTH_SECRET=dev-secret-at-least-32-characters-long
NEXTAUTH_URL=http://localhost:3000

UPLOAD_DIR=./uploads
NODE_ENV=development

REDIS_PASSWORD=
ADMIN_BOOTSTRAP_PASSWORD=localdev123
```

`REDIS_PASSWORD` can be left empty for local development. The app will use in-memory rate limiters. `EMAIL_ENCRYPTION_KEY` and `CRON_SECRET` are only needed if you want to test email or cron features locally.

### Step 3. Create the database and seed

```bash
npx prisma migrate deploy
npx prisma db seed
```

This creates all tables and seeds the admin user with the password from `ADMIN_BOOTSTRAP_PASSWORD`.

### Step 4. Start the dev server

```bash
npm run dev
```

Open `http://localhost:3000` and log in with username `admin` and the password you set in `ADMIN_BOOTSTRAP_PASSWORD`.

### Running tests

```bash
npm test
```

---

## Production Deployment (Docker Compose)

This section covers deploying the application in a production or staging environment using Docker Compose. The app runs inside a container, listens on `127.0.0.1:3000`, and must be fronted by a TLS-terminating reverse proxy.

### Architecture

```
Internet
   |
[Palo Alto / Firewall]
   |
[Reverse Proxy (Caddy, Nginx, etc.)]  -- terminates TLS, forwards to 127.0.0.1:3000
   |
[OnboardingApp container] -- app on frontend + backend networks
   |
[backend network (internal, no external routing)]
   |          |
[PostgreSQL] [Redis]
```

The `backend` Docker network is marked `internal: true`, so the database and Redis are unreachable from outside Docker. Only the app container bridges both the frontend and backend networks.

### Prerequisites

- A Linux host (or VM) with Docker and Docker Compose v2 installed
- A TLS certificate for the external hostname
- A reverse proxy (Caddy recommended for simplest setup; Nginx, Traefik, and HAProxy also work) -- see [REVERSE_PROXY.md](REVERSE_PROXY.md) for complete configurations
- Network access from the host to an SMTP server or Microsoft Graph API (if email notifications are needed)

### Step 1. Clone the repository

```bash
git clone <repository-url>
cd OnboardingApp
```

### Step 2. Generate secrets

Generate all required secrets. Each secret should be unique and random.

```bash
# Database password
openssl rand -hex 20

# Auth.js session signing secret
openssl rand -base64 32

# Redis password
openssl rand -base64 32

# Initial admin password
openssl rand -base64 16

# Email encryption key (only if configuring email)
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"

# Cron secret (only if scheduling cron jobs)
openssl rand -base64 32
```

Save these values -- you will need them in the next step.

### Step 3. Configure environment variables

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env` and replace every placeholder. A complete production `.env` looks like this:

```env
# Database -- the password in DATABASE_URL must match POSTGRES_PASSWORD
DATABASE_URL="postgresql://onboarding:<db-password>@db:5432/onboarding"
POSTGRES_USER=onboarding
POSTGRES_PASSWORD=<db-password>
POSTGRES_DB=onboarding

# Auth.js
AUTH_SECRET=<auth-secret>

# The external URL users will access -- must be HTTPS, no trailing slash.
# Auth.js uses this for CSRF validation, callback URLs, and cookie settings.
NEXTAUTH_URL=https://onboarding.corp.example.com

# Upload directory inside the container (mapped to a Docker volume)
UPLOAD_DIR=/app/uploads

# Must be 'production' for secure cookie flags and other hardening
NODE_ENV=production

# Redis -- Docker Compose constructs REDIS_URL from this automatically
REDIS_PASSWORD=<redis-password>

# Initial admin password -- required on first boot
ADMIN_BOOTSTRAP_PASSWORD=<admin-password>

# Reverse proxy is in place -- enable per-IP rate limiting
TRUST_PROXY=true

# Disable the factory reset endpoint in production
DISABLE_FACTORY_RESET=true

# Email encryption key -- required if configuring email in the admin panel
# 64-character hex string (32 bytes)
EMAIL_ENCRYPTION_KEY=<64-hex-chars>

# Cron secret -- required if scheduling overdue-task or log-cleanup cron jobs
CRON_SECRET=<cron-secret>

# Log level: ERROR (errors only), ACCESS (errors + login events), LOG (everything)
LOG_LEVEL=ACCESS

# Log retention in days (default 90)
LOG_RETENTION_DAYS=90
```

Important notes:
- `POSTGRES_PASSWORD` and the password in `DATABASE_URL` must be identical.
- `NEXTAUTH_URL` must match the external hostname exactly -- CSRF protection depends on it.
- `TRUST_PROXY=true` must only be set when a reverse proxy is confirmed to strip client-supplied `X-Forwarded-For` headers. See [REVERSE_PROXY.md](REVERSE_PROXY.md).

### Step 4. Build and start the services

```bash
docker compose up -d --build
```

On the first start, the entrypoint script will:

1. Run `prisma migrate deploy` to create all database tables.
2. Run the seed script to create the admin user (using `ADMIN_BOOTSTRAP_PASSWORD`) and built-in document categories.
3. Start the Next.js server on port 3000.

Watch the logs to confirm a clean startup:

```bash
docker compose logs -f app
```

You should see:
```
Running database migrations...
Seeding database (no-op if already seeded)...
Admin password set from ADMIN_BOOTSTRAP_PASSWORD
Seeded admin user: admin
Seeded default branding
Seeded built-in document categories
Starting application...
```

### Step 5. Configure the reverse proxy

Set up your reverse proxy to terminate TLS and forward traffic to `127.0.0.1:3000`. Ready-to-use configurations for both Caddy and Nginx are provided in **[REVERSE_PROXY.md](REVERSE_PROXY.md)**.

The proxy must:
- Terminate TLS with TLSv1.2+ and strong ciphers
- Set `X-Forwarded-For` to the real client IP (strip client-supplied values)
- Set `Host` to match the `NEXTAUTH_URL` hostname
- Generate and forward `X-Request-ID` for log correlation
- Block `/api/cron/*`, `/api/admin/factory-reset`, and `/uploads/`

### Step 6. Verify the deployment

```bash
# Health check
curl -s https://onboarding.corp.example.com/api/health
# Expected: {"status":"ok"}

# Login page loads
curl -sI https://onboarding.corp.example.com/login
# Expected: 200 with security headers (CSP, HSTS, X-Frame-Options)

# Cron blocked externally
curl -sI https://onboarding.corp.example.com/api/cron/log-cleanup
# Expected: 403
```

Log in with username `admin` and the password from `ADMIN_BOOTSTRAP_PASSWORD`. Change the admin password immediately.

### Step 7. Configure email (optional)

In the admin panel under **Admin > Email**, configure either:

- **SMTP** -- any standard SMTP server (port 465 or 587 with TLS). Port 25 is not supported.
- **Microsoft Graph (Entra ID)** -- requires an Entra ID app registration with the `Mail.Send` application permission. Enter the tenant ID, client ID, client secret, and sending address.

`EMAIL_ENCRYPTION_KEY` must be set in `.env` before configuring either provider -- it encrypts stored credentials at rest.

Use the **Send Test Email** button to verify the configuration.

### Step 8. Schedule cron jobs (optional)

Two endpoints should be called by an internal scheduler. These must be called from the trust zone (not through the reverse proxy, which blocks `/api/cron/*`).

**Overdue task reminders** -- call daily:
```bash
curl -X POST http://127.0.0.1:3000/api/cron/overdue-tasks \
  -H "X-Cron-Secret: <your-cron-secret>"
```

**Log retention cleanup** -- call weekly:
```bash
curl -X POST http://127.0.0.1:3000/api/cron/log-cleanup \
  -H "X-Cron-Secret: <your-cron-secret>"
```

Example crontab on the Docker host:
```cron
# Daily at 2 AM -- overdue task reminders
0 2 * * * curl -sf -X POST http://127.0.0.1:3000/api/cron/overdue-tasks -H "X-Cron-Secret: <secret>" > /dev/null

# Sunday at 3 AM -- log retention cleanup
0 3 * * 0 curl -sf -X POST http://127.0.0.1:3000/api/cron/log-cleanup -H "X-Cron-Secret: <secret>" > /dev/null
```

### Stopping and updating

```bash
# Stop all services
docker compose down

# Pull latest code and rebuild
git pull
docker compose up -d --build
```

Data is persisted in two named Docker volumes (`pgdata` for the database, `uploads` for files) and survives container restarts and rebuilds.

### Viewing logs

Application logs are written to stdout in JSON format:

```bash
# Follow live logs
docker compose logs -f app

# Search for login failures
docker compose logs app | grep login_failure
```

Admin users can also view logs in the web UI under **Admin > Logs** with level and date filters.

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `POSTGRES_USER` | Yes | PostgreSQL username (Docker Compose) |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (Docker Compose) -- must match `DATABASE_URL` |
| `POSTGRES_DB` | Yes | PostgreSQL database name (Docker Compose) |
| `AUTH_SECRET` | Yes | Random secret for Auth.js session signing -- min 32 bytes |
| `NEXTAUTH_URL` | Yes | Public base URL, e.g. `https://onboarding.example.com` |
| `UPLOAD_DIR` | Yes | Filesystem path for uploaded files (`/app/uploads` in Docker) |
| `NODE_ENV` | Yes | `production` for deployed environments |
| `REDIS_PASSWORD` | Yes | Password for Redis; Docker Compose constructs `REDIS_URL` from it |
| `ADMIN_BOOTSTRAP_PASSWORD` | Yes | Initial admin password on first boot |
| `TRUST_PROXY` | Production | Set to `true` when behind a reverse proxy that strips `X-Forwarded-For` |
| `DISABLE_FACTORY_RESET` | Production | Set to `true` to disable the factory reset endpoint |
| `EMAIL_ENCRYPTION_KEY` | If using email | 64-character hex string for encrypting stored email credentials |
| `CRON_SECRET` | If using cron | Shared secret for cron endpoints -- min 32 bytes |
| `LOG_LEVEL` | No | Minimum log level: `ERROR`, `ACCESS`, or `LOG` (default: `LOG`) |
| `LOG_RETENTION_DAYS` | No | Days to retain AppLog rows before cron cleanup (default: 90) |

---

## Security Notes

- Passwords hashed with Argon2id (`m=65536, t=3, p=4`)
- JWT sessions with 2-hour absolute maximum and 30-minute idle timeout
- Session cookies: `HttpOnly`, `SameSite=Strict`, `__Secure-` prefix in production
- CSP with per-request nonces and `strict-dynamic`; violations reported to `/api/csp-report`
- HSTS with 2-year max-age, includeSubDomains, and preload
- Uploaded files validated by magic bytes (not extension) and capped at 25 MB
- All database queries use parameterised statements via Prisma
- Rate limiting is Redis-backed with per-user and per-IP keys
- Login rate limiting keys on username when no reverse proxy is configured, preventing global lockout DoS
- Cron secret compared with `crypto.timingSafeEqual` to prevent timing attacks
- Users are never deleted, only deactivated, to preserve audit trails
- Docker network isolation: database and Redis on an internal network with no external routing
- API responses include `Cache-Control: no-store` to prevent proxy/browser caching of authenticated data
- All 429 responses include `Retry-After` headers per RFC 6585
- `X-Request-ID` propagated from reverse proxy through the app for end-to-end request tracing
