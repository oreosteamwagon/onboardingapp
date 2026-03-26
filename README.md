# OnboardingApp

> This application was developed with [Claude](https://claude.ai/code) (Anthropic's AI coding assistant), including architecture, implementation, and security hardening.

A self-hosted employee onboarding platform built with Next.js 14. HR and admin staff define task-based workflows, assign them to new hires, track completion, and manage approvals — all from a single web interface.

## Features

- **Workflow builder** — compose reusable tasks into named workflows and assign them to users
- **Three task types** — Standard (checkbox), Upload (file submission), and Learning (course + scored quiz)
- **Approval queue** — supervisors and HR review and approve/reject uploaded submissions
- **Learning courses** — rich-text course content with multiple-choice quizzes and printable pass certificates
- **Resources library** — upload files or add web links that users can access from their dashboard
- **Document categories** — admin-defined categories for organising resource documents
- **Role-based access control** — five-role hierarchy with per-route and per-resource enforcement
- **Email notifications** — SMTP or Microsoft Graph (Entra ID) for overdue task reminders and workflow events
- **Branding** — customisable organisation name, logo, and primary/accent colours
- **Structured audit logs** — JSON logs written to stdout and stored in the database, viewable by admins with configurable retention
- **Rate limiting** — Redis-backed per-user and per-IP limits on logins, uploads, approvals, and other sensitive actions

## Role Hierarchy

Roles are cumulative — each role inherits the permissions of all roles below it.

| Role | Key permissions |
|------|----------------|
| `USER` | Complete own tasks, view own resources and documents |
| `SUPERVISOR` | View and approve tasks for users in supervised workflows |
| `PAYROLL` | All supervisor permissions + upload documents, view all documents |
| `HR` | All payroll permissions + manage tasks, workflows, courses, and assign users |
| `ADMIN` | Full access including users, branding, categories, email config, logs, and factory reset |

## Tech Stack

- **Framework** — Next.js 14 (App Router, standalone output)
- **Auth** — Auth.js v5 (next-auth 5.0.0-beta.25) with Credentials provider, JWT sessions, Argon2id password hashing
- **Database** — PostgreSQL 16 via Prisma 5
- **Cache / Rate limiting** — Redis 7 (authenticated, required)
- **Styling** — Tailwind CSS
- **Rich text** — TipTap v2
- **Containerisation** — Docker + Docker Compose

---

## Deployment (Docker Compose)

### Prerequisites

- Docker and Docker Compose installed on the host
- A TLS-terminating reverse proxy (Nginx, Caddy, Traefik) in front of the app for production

### 1. Clone the repository

```bash
git clone <repository-url>
cd OnboardingApp
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and replace every `CHANGE_ME` value. The required variables are:

```env
# Database
DATABASE_URL="postgresql://onboarding:<password>@db:5432/onboarding"
POSTGRES_USER=onboarding
POSTGRES_PASSWORD=<password>          # must match the password in DATABASE_URL
POSTGRES_DB=onboarding

# Auth.js — generate with: openssl rand -base64 32
AUTH_SECRET=<random-32-bytes>

# Public URL of the deployment (no trailing slash)
NEXTAUTH_URL=https://your-domain.example.com

UPLOAD_DIR=/app/uploads
NODE_ENV=production

# Redis authentication — generate with: openssl rand -base64 32
# Docker Compose passes this to Redis and constructs REDIS_URL automatically.
REDIS_PASSWORD=<random-32-bytes>

# Required if email is configured — 64-character hex string (32 bytes)
# generate with: node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
EMAIL_ENCRYPTION_KEY=<64-hex-chars>

# Required for cron endpoints — generate with: openssl rand -base64 32
CRON_SECRET=<random-32-bytes>
```

> `POSTGRES_PASSWORD` and the password in `DATABASE_URL` must match.

### 3. Start the services

```bash
docker compose up -d
```

On first start the entrypoint will:
1. Run `prisma migrate deploy` to apply all database migrations
2. Run the seed script to create the default admin account and built-in document categories
3. Start the Next.js server on port 3000

### 4. Access the application

The app binds to `127.0.0.1:3000` — it must be accessed through a reverse proxy in production. Point your proxy at `localhost:3000` and ensure it terminates TLS.

**Default admin credentials:**

| Username | Password |
|----------|----------|
| `admin`  | `T34mw0rk!` |

Change the admin password immediately after first login.

Alternatively, set `ADMIN_BOOTSTRAP_PASSWORD` in `.env` before the first start to use a password of your choice. If neither is set, a random password is printed to stdout on first boot.

### Stopping and updating

```bash
# Stop
docker compose down

# Pull latest changes and rebuild
git pull
docker compose up -d --build
```

Data is persisted in two named Docker volumes (`pgdata` for the database, `uploads` for files) and survives container restarts and rebuilds.

---

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL 16 running locally (or via Docker)
- Redis 7 running locally (or via Docker)

### 1. Install dependencies

```bash
npm install --legacy-peer-deps
```

> `--legacy-peer-deps` is required because TipTap v2 and next-auth v5 beta have peer dependency conflicts that do not affect runtime behaviour.

### 2. Configure environment variables

```bash
cp .env.example .env
```

Update `DATABASE_URL` to point at your local PostgreSQL instance, set `NEXTAUTH_URL=http://localhost:3000`, and set `REDIS_PASSWORD` (or remove it and clear `REDIS_URL` to use the in-memory fallback).

### 3. Set up the database

```bash
npx prisma migrate deploy
npx prisma db seed
```

### 4. Start the dev server

```bash
npm run dev
```

The app is available at `http://localhost:3000`.

---

## Email Notifications (optional)

The app sends emails for workflow events (assignment, task additions, approval requests, overdue reminders, and completion). Configure a provider in the admin panel under **Admin > Email**.

### SMTP

Any standard SMTP server (Gmail, SendGrid, Postfix, etc.).

### Microsoft Graph (Entra ID / Microsoft 365)

Requires an Entra ID app registration with the `Mail.Send` application permission and a client secret. Configure the tenant ID, client ID, client secret, and sending address in the admin panel.

`EMAIL_ENCRYPTION_KEY` must be set before configuring either provider — it is used to encrypt stored SMTP passwords and Entra client secrets at rest.

---

## Cron Jobs

Two endpoints must be called by an external scheduler (system cron, Docker cron, Kubernetes CronJob, or a hosted cron service). Both require the `X-Cron-Secret` header and are rate-limited.

### Overdue task reminders

```
POST /api/cron/overdue-tasks
```

Call once per day. Sends reminder emails to users with tasks overdue by more than 7 days. Idempotent — will not send duplicate emails.

### Log retention cleanup

```
POST /api/cron/log-cleanup
```

Call periodically (e.g. weekly). Deletes `AppLog` database rows older than `LOG_RETENTION_DAYS` (default: 90 days).

### Example cron call

```bash
curl -X POST https://your-domain.example.com/api/cron/overdue-tasks \
  -H "X-Cron-Secret: <your-cron-secret>"
```

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `POSTGRES_USER` | Yes | PostgreSQL username (Docker Compose only) |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (Docker Compose only) |
| `POSTGRES_DB` | Yes | PostgreSQL database name (Docker Compose only) |
| `AUTH_SECRET` | Yes | Random secret for Auth.js session signing — min 32 bytes |
| `NEXTAUTH_URL` | Yes | Public base URL of the app, e.g. `https://onboarding.example.com` |
| `UPLOAD_DIR` | Yes | Filesystem path where uploaded files are stored |
| `NODE_ENV` | Yes | Set to `production` in all deployed environments |
| `REDIS_PASSWORD` | Yes | Password for the Redis service; Docker Compose constructs `REDIS_URL` from it |
| `EMAIL_ENCRYPTION_KEY` | If using email | 64-character hex string (32 bytes) for encrypting stored email credentials |
| `CRON_SECRET` | If using cron | Shared secret for the cron endpoints — min 32 bytes |
| `ADMIN_BOOTSTRAP_PASSWORD` | No | Initial admin password on first boot; random if unset |
| `LOG_LEVEL` | No | Minimum log level: `ERROR`, `ACCESS`, or `LOG` (default: `LOG`) |
| `LOG_RETENTION_DAYS` | No | Days to retain AppLog rows (default: 90) |
| `TRUST_PROXY` | No | Set to `true` when behind a trusted reverse proxy that strips `X-Forwarded-For` |

---

## Security Notes

- Passwords are hashed with Argon2id (`m=65536, t=3, p=4`).
- Session cookies use `HttpOnly`, `SameSite=Strict`, and the `__Secure-` prefix in production.
- Uploaded files are validated by magic bytes (not extension alone) and capped at 25 MB.
- All database queries use parameterised statements via Prisma.
- HTML email bodies escape all user-controlled values (task titles, workflow names, usernames) before interpolation.
- File downloads are streamed directly from disk — files are not buffered into process memory.
- Rate limiting is Redis-backed; the Redis service requires password authentication.
- Login rate limiting keys on username when no reverse proxy is configured, preventing a global lockout DoS.
- The cron secret is compared with `crypto.timingSafeEqual` to prevent timing-based enumeration.
- Re-uploading a file for an approved task resets the approval status to pending, forcing re-review.
- Users are never deleted — only deactivated — to preserve audit trails.
- Hex color values stored in the database are validated against a strict 6-digit allowlist before CSS injection.
- Set `TRUST_PROXY=true` only after confirming your reverse proxy strips client-supplied `X-Forwarded-For` headers.
