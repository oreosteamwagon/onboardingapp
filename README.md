# OnboardingApp

A self-hosted employee onboarding platform built with Next.js 14. It lets HR and admin staff define task-based workflows, assign them to new hires, track completion, and manage approvals — all from a single web interface.

## Features

- **Workflow builder** — compose reusable tasks into named workflows and assign them to users
- **Three task types** — Standard (checkbox), Upload (file submission), and Learning (course + scored quiz)
- **Approval queue** — supervisors and HR review and approve/reject uploaded submissions
- **Learning courses** — rich-text course content with multiple-choice quizzes and printable pass certificates
- **Resources library** — upload files or add web links that users can access from their dashboard
- **Document categories** — admin-defined categories for organising resource documents
- **Role-based access control** — five-role hierarchy with per-route and per-resource enforcement
- **Email notifications** — SMTP or Microsoft Graph (Entra ID) for overdue task reminders via a daily cron job
- **Branding** — customisable organisation name, logo, and primary/accent colours
- **Structured audit logs** — JSON logs written to stdout and stored in the database, viewable by admins
- **Rate limiting** — per-user limits on logins, uploads, approvals, and other sensitive actions

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
- **Auth** — Auth.js v5 with Credentials provider, JWT sessions, Argon2id password hashing
- **Database** — PostgreSQL 16 via Prisma 5
- **Styling** — Tailwind CSS
- **Rich text** — TipTap v2
- **Containerisation** — Docker + Docker Compose

---

## Deployment (Docker Compose)

This is the recommended way to run the application in production.

### Prerequisites

- Docker and Docker Compose installed on the host

### 1. Clone the repository

```bash
git clone <repository-url>
cd OnboardingApp
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in every `CHANGE_ME` value:

```env
# Database connection — used by the app
DATABASE_URL="postgresql://onboarding:CHANGE_ME@db:5432/onboarding"

# PostgreSQL credentials — used by the db service
POSTGRES_USER=onboarding
POSTGRES_PASSWORD=CHANGE_ME
POSTGRES_DB=onboarding

# Auth.js secret — generate with: openssl rand -base64 32
AUTH_SECRET=CHANGE_ME_USE_OPENSSL_RAND_BASE64_32

# Public URL of the deployment (no trailing slash)
NEXTAUTH_URL=https://your-domain.example.com

# Upload directory (mapped to the Docker volume)
UPLOAD_DIR=/app/uploads

NODE_ENV=production
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

Navigate to `http://localhost:3000` (or your configured `NEXTAUTH_URL`).

**Default admin credentials:**

| Username | Password |
|----------|----------|
| `admin`  | `T34mw0rk!` |

Change the admin password immediately after first login.

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
- `npm`

### 1. Install dependencies

```bash
npm install --legacy-peer-deps
```

> `--legacy-peer-deps` is required because TipTap v2 has peer dependency conflicts with React 18.

### 2. Configure environment variables

```bash
cp .env.example .env
```

Update `DATABASE_URL` to point at your local PostgreSQL instance and set `NEXTAUTH_URL=http://localhost:3000`.

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

The app can send overdue-task reminder emails. Configure one of two providers in the admin panel under **Admin > Email**, then set up a daily cron job to call the notification endpoint.

### SMTP

Any standard SMTP server (e.g. Gmail, SendGrid, Postfix).

### Microsoft Graph (Entra ID / Microsoft 365)

Requires an Entra ID app registration with `Mail.Send` application permission and a client secret. Configure the tenant ID, client ID, client secret, and sending address in the admin panel.

### Cron endpoint

The endpoint `POST /api/cron/overdue-tasks` must be called once per day by an external scheduler. Protect it with a shared secret:

```env
CRON_SECRET=<random-string-at-least-32-chars>
```

Example cron call:

```bash
curl -X POST https://your-domain.example.com/api/cron/overdue-tasks \
  -H "X-Cron-Secret: <your-cron-secret>"
```

The endpoint is idempotent — it only notifies users whose tasks became overdue since the last run.

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `POSTGRES_USER` | Yes | PostgreSQL username (Docker Compose only) |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (Docker Compose only) |
| `POSTGRES_DB` | Yes | PostgreSQL database name (Docker Compose only) |
| `AUTH_SECRET` | Yes | Random secret for Auth.js session signing (min 32 chars) |
| `NEXTAUTH_URL` | Yes | Public base URL of the app, e.g. `https://onboarding.example.com` |
| `UPLOAD_DIR` | Yes | Filesystem path where uploaded files are stored |
| `NODE_ENV` | Yes | Set to `production` in all deployed environments |
| `CRON_SECRET` | If using email | Shared secret for the overdue-tasks cron endpoint |
| `LOG_LEVEL` | No | Minimum log level to write: `ERROR`, `ACCESS`, or `LOG` (default: `LOG`) |

---

## Security Notes

- Passwords are hashed with Argon2id.
- Session cookies use `HttpOnly`, `SameSite=Lax`, and the `__Secure-` prefix in production.
- Uploaded files are validated by magic bytes (not just extension) and capped at 25 MB.
- All database queries use parameterised statements via Prisma.
- Rate limiting is applied to login, uploads, approvals, and other sensitive endpoints.
- Users are never deleted — only deactivated — to preserve audit trails.
- For multi-instance deployments, replace the in-memory rate limiter with Redis.
