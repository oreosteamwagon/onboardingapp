# Security Assessment Report — OnboardingApp

**Date:** 2026-03-21
**Scope:** Full codebase review — authentication, authorisation, input handling, file upload, session management, cryptography, HTTP headers, rate limiting, secrets management, and deployment configuration.
**Basis:** Static analysis of source code and configuration files.

---

## Executive Summary

The application demonstrates a strong security foundation with consistent, layered controls throughout. Authentication, database access, HTML sanitisation, file upload validation, and cryptographic practices are all well-implemented. Several issues were identified that must be addressed before internet-facing deployment, along with a number of medium and low-severity findings that should be remediated or acknowledged.

**Findings overview:**

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 3 |
| Low | 4 |
| Informational | 3 |

---

## Findings

---

### HIGH-01 — Deactivated and downgraded users retain access for up to 8 hours

**File:** `auth.config.ts`, `middleware.ts`, all API routes
**Risk:** A deactivated or demoted user continues to have full access to every route until their JWT expires.

**Detail:**
The application uses JWT sessions with an 8-hour `maxAge`. The middleware validates the presence of a JWT but does not check whether the user is still active or whether their role matches what is in the database. Only the approvals route (`/api/approvals/[userTaskId]/route.ts`) performs a live database check:

```typescript
// Only in the approvals route
const approver = await prisma.user.findUnique({
  where: { id: session.user.id },
  select: { id: true, active: true },
})
if (!approver || !approver.active) { ... }
```

This means if an admin deactivates an employee (e.g., upon termination), or demotes an HR user, the user can continue to perform privileged actions — create tasks, manage workflows, approve submissions — for up to 8 hours.

**Recommendation:**
Add an active-user and role-freshness check to every sensitive API route (or at minimum, to all routes that perform write operations). The most robust fix is a short-lived JWT (e.g., 15–30 minutes) paired with a silent refresh mechanism, or a server-side session store (e.g., database sessions via Auth.js) that allows immediate invalidation. If the 8-hour JWT is kept, every write-capable API route should perform the DB check that is currently only present in the approvals route.

---

### MEDIUM-01 — In-memory rate limiting does not scale across instances

**File:** `lib/ratelimit.ts`
**Risk:** Rate limiting is completely ineffective in load-balanced multi-instance deployments.

**Detail:**
All rate limiters use `RateLimiterMemory`, which is process-local. If the application runs behind a load balancer with two or more instances, an attacker can trivially bypass every rate limit — including the login limiter — by distributing requests across instances. Each instance tracks its own counters in isolation.

**Recommendation:**
Replace `RateLimiterMemory` with `RateLimiterRedis` (from the same `rate-limiter-flexible` library) backed by a Redis instance. The API surface is identical. This is noted in the README as a known gap and must be resolved before deploying more than one instance. Even for a single-instance deployment, a Redis-backed limiter survives process restarts.

---

### MEDIUM-02 — CSP weakened by `unsafe-inline` and `unsafe-eval`

**File:** `next.config.js`
**Risk:** The Content Security Policy provides minimal XSS protection against script injection.

**Detail:**
The configured CSP includes:
```
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

`unsafe-inline` allows any inline `<script>` block to execute, and `unsafe-eval` allows `eval()` and similar dynamic code evaluation. These directives effectively disable the XSS protection that CSP is designed to provide. An attacker who can inject HTML into any page (for example via a future XSS vulnerability in course content rendering) can execute arbitrary JavaScript.

This is a common trade-off with Next.js because its runtime historically required these directives. However, Next.js 13+ supports nonce-based CSP which eliminates the need for `unsafe-inline`.

**Recommendation:**
Implement nonce-based CSP using Next.js middleware. Generate a cryptographically random nonce per request and include it in both the CSP header and the `<script>` tags. This eliminates `unsafe-inline`. `unsafe-eval` can often be removed by avoiding dynamic code evaluation in dependencies; audit the dependency tree to confirm.

---

### MEDIUM-03 — Login rate limit keyed by IP with no account-level lockout

**File:** `lib/ratelimit.ts`, `lib/auth.ts`
**Risk:** A motivated attacker can brute-force user passwords by rotating IPs or using distributed infrastructure.

**Detail:**
The login rate limiter allows 10 attempts per 15 minutes, keyed by IP address:

```typescript
const loginLimiter = new RateLimiterMemory({
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
})
```

There is no per-account lockout or slowdown. An attacker with access to residential proxies or a botnet can attempt thousands of passwords against a single account by cycling IP addresses. There is also no check for whether the IP is extracted correctly through proxy headers (X-Forwarded-For), which can be spoofed if not configured at the reverse proxy level.

**Recommendation:**
Add a per-username rate limit (e.g., 10 attempts per 15 minutes per username) in addition to the IP limit. This stops targeted account attacks regardless of IP rotation. Ensure the reverse proxy is configured to set `X-Forwarded-For` and that the IP extracted in the login route is the real client IP, not `127.0.0.1` (the proxy). Consider a progressive delay (CAPTCHA or increasing lockout) after repeated failures.

---

### LOW-01 — Uploaded files directory excluded from middleware auth check

**File:** `middleware.ts`
**Risk:** If the uploads directory is ever served as static files, all uploaded documents would be accessible without authentication.

**Detail:**
The middleware matcher explicitly excludes the `uploads/` path:

```typescript
matcher: [
  '/((?!_next/static|_next/image|favicon.ico|uploads/).*)',
],
```

In the current deployment, uploaded files are stored in `/app/uploads` which is not served as a Next.js static directory (`public/`), so this exclusion is currently harmless. However, this creates a latent risk: if a reverse proxy is misconfigured to serve `/uploads/` directly, or if the `UPLOAD_DIR` is ever changed to point inside the `public/` directory, all files would become publicly accessible without authentication.

**Recommendation:**
Remove `uploads/` from the middleware matcher exclusion. There is no legitimate reason to exclude it. Uploaded files are served exclusively through the authenticated download API route, not as static files, so the exclusion serves no purpose and only introduces risk.

---

### LOW-02 — HTTP links permitted in course HTML content

**File:** `lib/sanitize.ts`
**Risk:** Instructors can embed `http://` links in course content, exposing users to mixed-content and potential MitM on linked resources.

**Detail:**
The HTML sanitiser allows both `https` and `http` schemes for anchor tags:

```typescript
allowedSchemes: ['https', 'http', 'mailto'],
```

This means an instructor (HR+) can embed plain HTTP links in course content. Users who click such links could be exposed to network-level interception on the linked resource.

**Recommendation:**
Restrict the allowed schemes for anchor tags to `['https', 'mailto']`. There is no legitimate reason to link to HTTP resources in a corporate onboarding platform. This is a low-effort, high-confidence fix.

---

### LOW-03 — No password complexity or history requirements enforced on password changes

**Risk:** Users and admins can set weak passwords, increasing the risk of credential compromise.

**Detail:**
The seed password (`T34mw0rk!`) meets complexity requirements, but the codebase does not enforce any minimum complexity rules on passwords set via the admin user management interface. A user's password could be reset to a single character.

**Recommendation:**
Implement and enforce a password policy on all password-set and password-reset operations: minimum length (12+ characters recommended), requirement for a mix of character classes, and optionally a check against a list of common passwords (e.g., the HIBP database). Add this validation to the server-side user management API route.

---

### LOW-04 — AppLog table has no retention policy, causing unbounded database growth

**File:** `prisma/schema.prisma`, `lib/logger.ts`
**Risk:** Unbounded log growth will eventually impact database performance and storage.

**Detail:**
Every request, login, approval, upload, and error generates a row in the `AppLog` table. There is no automatic expiry, archival, or deletion policy. In a production system with hundreds of users over months, this table will grow very large.

**Recommendation:**
Implement a database retention policy to delete `AppLog` rows older than a configurable threshold (90 days is a common baseline). This can be done via a scheduled SQL job, an extension of the existing cron endpoint, or a Prisma-based cleanup task. Add an index on `createdAt` if not already present (it is noted in the schema).

---

### INFO-01 — JWT role is stale after role changes

**File:** `auth.config.ts`
**Severity:** Informational (accepted behaviour, documented)

The user's role is encoded in the JWT at login time and is not refreshed from the database mid-session. A role change (e.g., HR → USER) takes effect only when the user's JWT expires and they log in again. This is the standard JWT trade-off and is acceptable given the 8-hour session window, but it should be documented and understood by operators. An immediate forced re-login (session invalidation) is not possible without server-side session storage. See HIGH-01 for the deactivation case.

---

### INFO-02 — `trustHost: true` requires correct reverse proxy configuration

**File:** `auth.config.ts`
**Severity:** Informational

`trustHost: true` tells Auth.js to trust the `Host` (and `X-Forwarded-Host`) header when constructing callback URLs. This is correct for deployments behind a trusted reverse proxy (Nginx, Caddy, etc.) but becomes a host header injection vector if the application is exposed directly to the internet without a proxy that validates or sets the Host header. Ensure the reverse proxy does not forward arbitrary `Host` headers and explicitly sets `X-Forwarded-Host` to the canonical domain.

---

### INFO-03 — Structured logs distinguish "user not found" from "wrong password"

**File:** `lib/auth.ts`
**Severity:** Informational

The access log messages differ between the two login failure cases:
- `'login failed: user not found or inactive'`
- `'login failed: invalid password'`

An attacker with read access to the application logs (e.g., a compromised ADMIN account or a misconfigured log collector) could use these messages to enumerate valid usernames. The response to the client is identical in both cases (returns `null`, which Auth.js turns into a generic error), so there is no external enumeration risk. This is flagged for awareness — if logs are ever exposed externally, this distinction leaks username validity.

---

## Controls Verified as Correctly Implemented

The following areas were reviewed and found to meet or exceed security best practices:

**Authentication**
- Argon2id with `m=65536, t=3, p=4` (industry-recommended parameters)
- Constant-time dummy hash verification on unknown usernames to prevent timing attacks
- Input length limits (128-char username, 256-char password) to prevent DoS via hash computation

**Session management**
- JWT signed with `AUTH_SECRET` (must be 32+ bytes per `.env.example`)
- `HttpOnly`, `SameSite=Strict`, `Secure` (in production), `__Secure-` prefix in production
- 8-hour session expiry

**CSRF protection**
- `SameSite=Strict` cookie prevents cross-site request forgery on all state-changing requests
- CSP `form-action 'self'` restricts form submissions to same origin
- Auth.js built-in CSRF token for its own auth routes

**Authorisation**
- Role check on every API route — no unprotected endpoints
- Supervisor scope enforced via database join (WorkflowTask → UserWorkflow), not just role check
- TOCTOU-safe approval processing using a Prisma database transaction
- `isCorrect` field never returned to course-taking users — server-side scoring only

**Database access**
- All queries use Prisma's parameterised API — no raw SQL concatenation
- IDs validated against CUID format before use in queries
- Selective column projection (`select`) prevents over-fetching sensitive fields

**File upload**
- Magic-byte (file-type library) validation — extension alone is never trusted
- Strict allowlist: PDF, DOCX, PNG, JPEG only
- 25 MB hard limit enforced before magic-byte check
- UUID-based storage filenames — original name never used for filesystem access
- Path traversal defence on storagePath (separator and `..` rejection)
- Files written with mode `0o640` (owner read/write, group read, no world access)

**HTML sanitisation**
- `sanitize-html` with explicit allowlist of tags and attributes for course content
- `rel="noopener noreferrer"` added to all links via `transformTags`
- 200 KB size limit on course HTML before storage
- Sanitisation applied both on write (to database) and on serve (defence in depth)

**Secrets management**
- SMTP password and Entra client secret encrypted at rest with AES-256-GCM
- 96-bit random IV per encryption, 128-bit GCM authentication tag
- `EMAIL_ENCRYPTION_KEY` required as environment variable — fails closed if absent
- Encrypted secrets never returned in API responses (returns boolean `passwordSet` flag only)

**HTTP security headers**
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — 2-year HSTS
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — disables camera, microphone, geolocation
- `Content-Security-Policy` — despite the `unsafe-inline`/`unsafe-eval` findings, `frame-ancestors 'none'`, `base-uri 'self'`, and `form-action 'self'` are correctly set
- `X-Content-Type-Options: nosniff` also added to file download responses

**Rate limiting**
- Login: 10 attempts / 15 min per IP (plus block)
- File upload: 10 / min per user
- Course attempts: 20 / hour per user (prevents quiz brute-forcing)
- Factory reset: 3 / hour per admin
- Log reads: 30 / min per admin
- All sensitive write operations are rate-limited

**Error handling**
- Generic error messages to clients; detailed context logged internally
- Log meta scrubbed for keys containing: password, token, hash, secret, credential, auth
- All async operations wrapped in try/catch — no unhandled promise rejections on the hot path

**Docker / deployment**
- Application runs as non-root `nextjs` user (UID 1001)
- `prisma migrate deploy` runs automatically on container start — no manual migration steps
- Named Docker volumes for data persistence across container restarts
- Health check on the database service prevents app starting before DB is ready

---

## Pre-Deployment Checklist

The following must be in place before internet-facing deployment:

- [ ] **Change the default admin password** (`T34mw0rk!`) immediately after first boot
- [ ] **Generate a strong `AUTH_SECRET`** (minimum 32 random bytes: `openssl rand -base64 32`)
- [ ] **Generate `EMAIL_ENCRYPTION_KEY`** if using email (32 random bytes as hex)
- [ ] **Generate `CRON_SECRET`** if using email notifications (minimum 32 random bytes)
- [ ] **Deploy behind a TLS-terminating reverse proxy** (Nginx, Caddy, or similar)
- [ ] **Configure reverse proxy** to set `X-Forwarded-For` correctly and to not forward arbitrary Host headers
- [ ] **Set `NEXTAUTH_URL`** to the exact public URL (including `https://`) — required for CSRF and cookie security
- [ ] **Set `NODE_ENV=production`** — enables `__Secure-` cookie prefix and `Secure` flag
- [ ] **Set `LOG_LEVEL=ACCESS`** or `LOG_LEVEL=ERROR`** in production to reduce log volume
- [ ] **Plan AppLog retention** — implement deletion of rows older than 90 days
- [ ] **Address HIGH-01** — implement active-user DB checks across all write-capable routes, or reduce JWT maxAge
- [ ] **Address MEDIUM-01** — configure Redis-backed rate limiting before multi-instance deployment
- [ ] **Address MEDIUM-03** — add per-username rate limiting to the login route
- [ ] **Address LOW-01** — remove `uploads/` from the middleware matcher exclusion
- [ ] **Configure a log aggregator** (Datadog, Loki, CloudWatch) to ingest container stdout in JSON parse mode
- [ ] **Review and restrict network access** — the PostgreSQL port should not be exposed outside the Docker network

---

*This report reflects the state of the codebase as of commit `6785d1b` (2026-03-21). It covers static analysis only. Dynamic testing (DAST), penetration testing, and dependency vulnerability scanning are recommended as separate activities before go-live.*
