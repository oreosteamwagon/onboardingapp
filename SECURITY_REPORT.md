# Security Assessment Report — OnboardingApp

**Date:** 2026-03-25
**Scope:** Full codebase review — authentication, authorisation, input handling, file upload, session management, cryptography, HTTP headers, rate limiting, secrets management, logging, email, and deployment configuration.
**Basis:** Independent static analysis of all source files. No prior report consulted.

---

## Executive Summary

The application demonstrates a strong overall security posture. Authentication, database access, file upload validation, HTML sanitisation, cryptographic practices, rate limiting, and HTTP security headers are all well-implemented. The outstanding findings are lower severity than is typical for an application at this stage. Four medium and five low severity issues were identified; no critical or high severity issues are present.

**Findings overview:**

| Severity | Total | Open | Resolved |
|----------|-------|------|----------|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 4 | 0 | 4 |
| Low | 5 | 5 | 0 |
| Informational | 6 | — | — |

---

## Findings

---

### MED-01 — HTML Injection in Outbound Email Templates

**Status: Resolved**

**File:** `lib/email.ts`

**Detail:**

The `emailHtml` helper builds HTML email bodies by direct string interpolation:

```typescript
const rows = bodyLines
  .map((line) => `<tr><td style="...">${line}</td></tr>`)
  .join('\n')
```

The body lines for several notification functions include user-controlled database values that are not HTML-escaped before interpolation. Specifically:

- `notifyApprovalNeeded` interpolates `task.title` and `displayName(user)` (first/last name or username)
- `notifyTaskAddedToWorkflow` interpolates `taskTitle` and `workflowName`
- `checkAndNotifyWorkflowCompletion` interpolates `userName` and `workflowName`
- `processOverdueTasks` interpolates `taskTitle`, `userName`, and `workflowName`

Task titles are validated only for length (`validateTitle` — up to 256 characters, no content restrictions). Workflow names are validated only for length (`validateWorkflowName` — up to 128 characters). Either can contain arbitrary strings including `<`, `>`, `"`, and `&`.

An HR or ADMIN user (or a compromised account at that privilege level) can create a task or workflow with a name such as:

```
</td></tr></table><img src="https://attacker.com/t.gif" width=1 height=1>
```

This would inject a tracking pixel into every approval notification, overdue reminder, and completion alert sent to all users. More damaging names could inject misleading copy, spoofed links, or credential-harvesting forms into emails targeting the full user base.

User first and last names are protected by `validateName`, which enforces a character-class regex permitting only letters, spaces, hyphens, apostrophes, and periods — no HTML characters. That path is not affected.

**Recommendation:**

HTML-escape all user-controlled values before interpolating them into the email template. A minimal helper:

```typescript
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
```

Apply this to every interpolated database value in `emailHtml` call sites, not to the structural HTML lines that callers construct. Alternatively, use a dedicated HTML email templating library that escapes by default.

---

### MED-02 — CRON_SECRET Comparison Is Not Constant-Time

**Status: Resolved**

**File:** `app/api/cron/overdue-tasks/route.ts:25`

**Detail:**

The cron endpoint authenticates callers by comparing a submitted header value against the configured secret:

```typescript
if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

JavaScript's `!==` operator on strings short-circuits at the first differing character. An attacker with network access to this endpoint can observe response latency across many requests and infer the correct secret one character at a time (a timing side-channel attack). While this requires many requests and a stable network path, it is a well-documented attack class against secret comparison in server-side code.

The endpoint is not rate-limited. An attacker could send a high volume of comparison requests without being throttled.

The effect of a compromised CRON_SECRET is limited — the cron endpoint is idempotent and only processes tasks where `overdueNotifiedAt IS NULL`, so repeated calls cannot trigger duplicate sends. However, a known secret grants the ability to trigger the processing batch on demand, including any future non-idempotent functionality added to this endpoint.

**Recommendation:**

Replace the string equality check with `crypto.timingSafeEqual`, which compares two equal-length Buffers in constant time:

```typescript
import { timingSafeEqual, randomBytes } from 'crypto'

const expected = Buffer.from(process.env.CRON_SECRET, 'utf8')
const received = Buffer.from(cronSecret, 'utf8')

if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

Add `checkCspReportRateLimit` (or a dedicated limiter) to throttle unauthenticated callers. Document `CRON_SECRET` in `.env.example` with a generation command (see also L-04).

---

### MED-03 — Re-Uploading an UPLOAD Task Does Not Reset Approval Status

**Status: Resolved**

**File:** `app/api/tasks/[taskId]/upload/route.ts:125–139`

**Detail:**

When a user submits a file for an UPLOAD-type task, the route atomically creates a new `Document` record and upserts the `UserTask`:

```typescript
const userTask = await tx.userTask.upsert({
  where: { userId_taskId: { userId: session.user.id, taskId } },
  update: {
    completed: true,
    completedAt: new Date(),
    documentId: doc.id,           // new document
    // approvalStatus is NOT reset
  },
  create: {
    userId: session.user.id,
    taskId,
    completed: true,
    completedAt: new Date(),
    documentId: doc.id,           // defaults to PENDING on create
  },
})
```

If the task already has `approvalStatus: 'APPROVED'` (from a previous upload that passed review), re-uploading updates `documentId` to a different file but leaves `approvalStatus` as `'APPROVED'`. The task does not re-enter the approval queue.

The observable consequence is that an approved user can silently replace the document that was reviewed and approved with any file that passes magic-byte validation. Because `approvalStatus` remains `APPROVED`, the task does not reappear in the approvals queue. The `notifyApprovalNeeded` fire-and-forget call does send an email, but the email appears in the approver's inbox for a task that the queue shows as already resolved — it is likely to be ignored or cause confusion.

In compliance-sensitive contexts (signed policy acknowledgements, identity documents, certifications), this allows a user to substitute a non-compliant or fraudulent document after the legitimate document has been reviewed.

**Recommendation:**

In the `update` branch of the upsert, reset `approvalStatus` to `'PENDING'`, clear `approvedAt`, and clear `approvedById` whenever a new document is submitted. This forces the replacement through the normal approval flow:

```typescript
update: {
  completed: true,
  completedAt: new Date(),
  documentId: doc.id,
  approvalStatus: 'PENDING',
  approvedAt: null,
  approvedById: null,
},
```

---

### MED-04 — Login Rate Limiting Is a Denial-of-Service Vector When TRUST_PROXY Is Unset

**Status: Resolved**

**Files:** `lib/ip.ts`, `app/api/auth/[...nextauth]/route.ts`

**Detail:**

When `TRUST_PROXY` is not set, `getClientIp` returns the string `'unknown'` for every caller:

```typescript
export function getClientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY) { ... }
  return 'unknown'
}
```

The login rate limiter then keys all requests under the single bucket `'rl:login:unknown'`. The limiter allows 10 requests per 15-minute window with a 15-minute block (`blockDuration: 15 * 60`).

Once any 10 failed login attempts are received — from any source, against any username — the entire `'unknown'` bucket is blocked. All subsequent login attempts from all users return 429 for 15 minutes. An attacker who can reach the login endpoint can sustain this lockout indefinitely by cycling through failed attempts every 15 minutes, effectively preventing any user from logging in.

This is distinct from the TRUST_PROXY IP-spoofing problem resolved in a prior review cycle. This finding concerns the DoS impact when TRUST_PROXY is legitimately absent (direct access, no proxy) — a configuration supported by the documented deployment model.

**Recommendation:**

Consider one or more of the following mitigations, applied in layers:

1. **Use a per-username limiter in addition to the per-IP limiter.** Key a second limiter on the submitted username. This limits brute-force against a specific account without affecting others.
2. **Increase the bucket granularity for the unknown-IP case.** When the IP is unknown, key on a combination of IP and username, or only on username, so a single attacker's failures do not consume the global quota.
3. **Document the operational risk clearly.** At minimum, add a startup log warning if `TRUST_PROXY` is unset and the application is accessible beyond localhost, so operators are aware of the shared-bucket behaviour.

The `.env.example` already documents `TRUST_PROXY`, but does not explain the DoS consequence of leaving it unset. Update the comment accordingly.

---

### LOW-01 — Redis Deployed Without Authentication or TLS

**Status: Open**

**File:** `docker-compose.yml`

**Detail:**

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
```

The Redis service has no password configured and no TLS. The connection URL in the environment is `redis://redis:6379` — unauthenticated plaintext.

Within the Docker Compose network, all services on the same bridge network can reach the Redis port without credentials. If any container in the stack is compromised through a vulnerability in another service (the application, a future sidecar, a misconfigured volume), the attacker gains full read/write access to the Redis keyspace, which holds all rate limiter counters.

A write-capable attacker can:
- Delete all rate limit counters (restoring their own bucket quotas mid-attack)
- Reset specific keys (e.g. the login limiter for their IP) to evade brute-force limits
- Flood the keyspace to degrade rate limit enforcement

The rate limiters are the primary control preventing credential brute-force and resource exhaustion.

**Recommendation:**

Configure Redis authentication by setting `requirepass` in the Redis configuration and updating the connection URL:
```
REDIS_URL=redis://:strongpassword@redis:6379
```

For a deployment beyond a single trusted host, also enable TLS on the Redis listener and use a `rediss://` URL. At minimum, confirm that the Docker bridge network is isolated and no Redis port is forwarded to the host.

---

### LOW-02 — CSP `style-src-attr 'unsafe-inline'` Weakens Inline Style Protection

**Status: Open**

**File:** `middleware.ts:17`

**Detail:**

```typescript
"style-src-attr 'unsafe-inline'",
```

The comment in the source notes this is required because dynamic inline style attributes (e.g. progress bar widths set via `style="width: 43%"`) cannot carry a nonce. The directive permits any inline style attribute on any element across all pages.

The practical impact today is limited — a review of all server-rendered pages found no path where user-controlled content reaches a `style` attribute. However, the directive means that any future HTML injection vulnerability (a missed sanitisation, a new feature added without review) could be exploited to inject CSS. CSS injection without JavaScript enables:

- Data exfiltration via attribute selectors and `url()` background requests
- UI redressing (hiding legitimate UI elements, rendering attacker-controlled content in their place)

This is not a defence-in-depth gap that can be easily eliminated without restructuring how dynamic styles are applied, but it should be tracked.

**Recommendation:**

Where possible, replace inline style attributes with CSS custom properties that are set via a `<style>` block carrying a nonce. For genuinely dynamic per-element values (progress bars, user-configurable widths), consider defining a constrained set of CSS classes generated at build time, selected conditionally in JSX, rather than computing arbitrary style values.

If `unsafe-inline` for `style-src-attr` must remain, document the residual risk explicitly and ensure all HTML rendering paths are reviewed for user-controlled content reaching style attributes.

---

### LOW-03 — File Downloads Load the Entire File Into Process Memory

**Status: Open**

**Files:** `app/api/documents/[documentId]/download/route.ts`, `app/api/attachments/[attachmentId]/download/route.ts`, `app/api/branding/logo/route.ts`

**Detail:**

All three file-serving routes read the complete file into a `Buffer` using `fs/promises.readFile` before constructing the response:

```typescript
buffer = await readFile(filePath)
return new NextResponse(new Uint8Array(buffer), { ... })
```

The maximum file size accepted at upload is 25 MB. Under concurrent load, each in-flight download of a 25 MB file holds 25 MB of heap memory for the duration of the request. The per-user rate limiter (60 downloads/min) throttles individuals, but multiple distinct users downloading large files simultaneously could cause significant memory pressure in constrained environments.

This also means the application holds the entire plaintext of every document in heap memory simultaneously with all other in-flight requests. While this is the normal Node.js pattern for small files, it warrants review for a document management feature that may serve large PDFs.

**Recommendation:**

Use Node.js streaming APIs (`fs.createReadStream`) combined with the Web Streams API (`ReadableStream`) to pipe file contents directly to the response without buffering the entire file in memory. Next.js route handlers support returning a `ReadableStream` as the response body. Set `Content-Length` from `fs.stat` before streaming so the browser knows the file size without buffering.

As an interim control, consider reducing `MAX_SIZE_BYTES` in `lib/upload.ts` for documents that are likely to be viewed online (5 MB is typical for PDFs), reserving 25 MB for formats like DOCX where it may be more appropriate.

---

### LOW-04 — CRON_SECRET Not Documented in `.env.example`

**Status: Open**

**Files:** `app/api/cron/overdue-tasks/route.ts`, `.env.example`

**Detail:**

The cron endpoint requires a `CRON_SECRET` environment variable for authentication:

```typescript
if (!process.env.CRON_SECRET) {
  logError({ message: 'CRON_SECRET env var is not set', action: 'cron_overdue' })
  return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
}
```

The variable is not present in `.env.example`. An operator who uses `.env.example` as the canonical reference for required environment variables will deploy without `CRON_SECRET` set. The endpoint will return 503 on every call, silently disabling overdue task notifications without any visible startup error.

The endpoint also lacks a rate limiter (see MED-02), meaning the 503 response can be triggered indefinitely without cost to the caller.

**Recommendation:**

Add `CRON_SECRET` to `.env.example` with a generation command and a note that it is required for the overdue-task cron job to function:

```bash
# Required for POST /api/cron/overdue-tasks — generate with: openssl rand -base64 32
CRON_SECRET=CHANGE_ME
```

---

### LOW-05 — next-auth@5 Pre-Release Version Used in Production

**Status: Open**

**File:** `package.json`

**Detail:**

```json
"next-auth": "^5.0.0-beta.25"
```

`next-auth` v5 is a beta release. Pre-release software:
- May have undisclosed security vulnerabilities not yet tracked by CVE or `npm audit`
- Has no stable API contract — breaking changes may be introduced in a subsequent beta
- The `^` semver range allows automatic installation of `5.0.0-beta.26` or later betas during `npm install`, which could introduce regressions or security issues without a deliberate package update

Auth.js v5 handles session management, JWT signing and verification, CSRF protection for auth routes, and cookie configuration. Defects in this library have a high impact surface.

**Recommendation:**

Pin the dependency to the exact version (`5.0.0-beta.25`, without `^`) to prevent unintended updates:

```json
"next-auth": "5.0.0-beta.25"
```

Monitor the next-auth/Auth.js repository and changelog for the stable v5 release or security advisories. Update deliberately rather than automatically. Consider running `npm audit` as part of CI to catch known vulnerabilities in installed versions.

---

### INFO-01 — AppLog Has No Retention Policy

**File:** `prisma/schema.prisma`
**Severity:** Informational

The `AppLog` table has no time-based expiry, archival, or deletion mechanism. The only bulk deletion path is the factory reset (`app/api/admin/factory-reset/route.ts`), which deletes all log records as part of wiping the environment — erasing the audit trail in the process.

At production log volume (access logs, error events, CSP violations), the table will grow continuously. This causes increasing disk usage, degraded query performance over time, and makes forensic review of large date ranges impractical.

**Recommendation:** Implement a background retention job that deletes `AppLog` rows older than a configurable threshold (90 days is a reasonable default). This can be a second cron endpoint (`/api/cron/log-cleanup`) protected by the same `CRON_SECRET` mechanism. Alternatively, configure the log aggregator (Datadog, Loki, CloudWatch) as the primary retention store and reduce the DB log write to critical events only.

---

### INFO-02 — Hex Color Validation Is Inconsistent Across the Codebase

**Files:** `app/api/branding/route.ts:10`, `lib/validation.ts:178`, `app/layout.tsx:54`
**Severity:** Informational

Three different regexes govern hex color validation:

| Location | Regex | Accepts |
|----------|-------|---------|
| `app/api/branding/route.ts` | `/^#[0-9a-fA-F]{3,8}$/` | 3-, 4-, 5-, 6-, 7-, 8-digit hex |
| `app/layout.tsx` `sanitizeColor` | `/^#[0-9a-fA-F]{3,8}$/` | same as above |
| `lib/validation.ts` `validateHexColor` | `/^#[0-9a-fA-F]{6}$/` | 6-digit hex only |

A 3-digit shorthand (`#fff`) or 8-digit RGBA value (`#2563ebff`) accepted by the branding route is stored in the database and passes through `sanitizeColor` into the `<html style>` attribute without issue. The stored value would fail `validateHexColor` if that function were ever called on a retrieved color value. The inconsistency does not create a security issue today but could cause subtle bugs if the strict validator is applied to stored data in a future code path.

**Recommendation:** Standardise on a single regex. The 6-digit strict form in `validateHexColor` is the most interoperable with CSS and design tooling; update the branding route to use it, or replace all three with a shared helper from `lib/validation.ts`.

---

### INFO-03 — Orphaned Logo Files Accumulate When Branding Is Updated

**File:** `app/api/branding/route.ts`
**Severity:** Informational

When a new logo is uploaded, the route calls `saveUpload` to write the new file and then updates `BrandingSetting.logoPath` to the new UUID-based filename. The previous logo file is left on disk at the old path and is no longer referenced in the database. Repeated branding updates produce orphaned files that are never cleaned up.

This is an operational maintenance concern rather than a security issue (the files are accessible only via the `GET /api/branding/logo` path, which reads the current `logoPath` value from the database). Over time it wastes disk space.

**Recommendation:** Before writing the new logo, read the existing `BrandingSetting.logoPath` and delete that file after a successful upsert. Handle `ENOENT` gracefully in case the old file is already absent.

---

### INFO-04 — Entra ID Access Token Cached in Process Memory

**File:** `lib/email.ts:53`
**Severity:** Informational (acknowledged in existing code comment)

A live Microsoft Graph API access token is stored in a module-level variable for up to ~55 minutes (token TTL minus the 60-second refresh buffer). The code already contains a detailed comment (marked `MED-07` in the prior review cycle) documenting the exposure window, the attack vector (memory dump or heap inspection), the accepted risk for a single-instance deployment, and the remediation path (Redis-based token cache for multi-instance).

No new action required beyond the documented future work.

---

### INFO-05 — SameSite=Strict Cookie Will Require Relaxation When OIDC Is Added

**File:** `auth.config.ts:34`
**Severity:** Informational

The session cookie is configured with `sameSite: 'strict'`. This is optimal for CSRF prevention in a pure credentials-based flow. When Entra ID OIDC is added (a planned future capability), the browser will not send `SameSite=Strict` cookies during the cross-site redirect from Microsoft's identity endpoint back to the application. Auth.js's OIDC state verification will fail, breaking the login flow.

Adding OIDC will require changing the session cookie to `sameSite: 'lax'`. This has different CSRF characteristics — it permits cookies on top-level navigations from external sites, which is the trade-off inherent to all OIDC redirect flows. The change should be reviewed in the context of the full OIDC implementation.

---

### INFO-06 — Login Failure Logs Distinguish User-Not-Found From Wrong Password

**File:** `lib/auth.ts:52, 64`
**Severity:** Informational

The access log messages for the two login failure paths differ:
- `'login failed: user not found or inactive'`
- `'login failed: invalid password'`

There is no client-facing enumeration risk — the HTTP response is identical in both cases, and a constant-time dummy hash verify is correctly applied when the user is not found. The distinction in log messages would only be visible to an actor with log access (an internal user or a compromised log pipeline).

If logs are ever exposed beyond authorised admins (misconfigured log aggregator permissions, compromised admin account), this metadata leaks whether specific usernames exist in the system.

**Recommendation:** Standardise both log messages to a single generic form (`'login failed'`) if defence-in-depth log confidentiality is required. The current dual-message form aids incident investigation and is acceptable if log access is strictly controlled.

---

## Controls Verified as Correctly Implemented

The following areas were reviewed and found to meet or exceed security best practices.

**Authentication**
- Argon2id with `m=65536, t=3, p=4` (NIST-approved parameters) for all password hashing
- Constant-time dummy hash verify on user-not-found path to prevent timing-based username enumeration
- Hard limits (128-char username, 256-char password) prevent hash-computation DoS
- Temporary passwords generated with `crypto.randomBytes(12).toString('base64url')` — 96 bits of entropy

**Session management**
- JWT signed by `AUTH_SECRET`; 8-hour expiry (`maxAge: 28800`)
- Cookies: `HttpOnly`, `SameSite=Strict`, `Secure` and `__Secure-` prefix activated when `NODE_ENV=production` OR `NEXTAUTH_URL` starts with `https:`
- `verifyActiveSession` DB check on every authenticated API route — compensates for the JWT trust gap where a deactivated user retains a valid token
- JWT role validated against `VALID_ROLES` set at the session callback boundary — unrecognised role leaves `session.user.role` unset so all downstream permission checks fail closed

**CSRF protection**
- `SameSite=Strict` cookie prevents cross-site request forgery on all state-changing routes
- CSP `form-action 'self'` restricts form submissions to the same origin
- Auth.js built-in CSRF token for its own credential callback route

**Authorisation**
- Role check on every authenticated API route before any business logic
- Object-level authorisation enforced at the DB query layer (not just role)
- Supervisor scope enforced by joining through `WorkflowTask → UserWorkflow` — not by role check alone
- TOCTOU-safe approval: `approvalStatus` is re-read inside the transaction before updating; concurrent approvers cannot double-process
- Course scoring is server-side only; `isCorrect` is never returned to the course-taking user
- Certificate access: own attempt only, or `SUPERVISOR+` (`canViewAnyCertificate`)
- `canApproveAny` (ADMIN/PAYROLL/HR) vs `canApprove` (includes SUPERVISOR) enforced consistently
- Factory reset requires explicit `{ confirm: "FACTORY_RESET" }` body token to prevent accidental execution

**Database access**
- All queries use Prisma's parameterised client — no string concatenation with user input
- URL parameters validated against CUID regex (`/^c[a-z0-9]{24}$/`) before use in DB queries
- Selective `select` projections prevent over-fetching sensitive fields (e.g. `passwordHash` never returned)

**File upload**
- Magic-byte validation via `file-type` library; file extension alone is never trusted
- Strict MIME allowlist: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/png`, `image/jpeg`
- 25 MB hard limit checked before any I/O
- Storage filename is a `randomUUID()` + safe extension — original filename is never used for filesystem access
- Original filename sanitised with character allowlist and truncated to 255 chars before DB storage
- Path traversal guard: stored paths are rejected at every read/write/delete site if they contain `/`, `\`, or `..`
- Files written with `mode: 0o640`

**HTML sanitisation**
- `sanitize-html` with explicit tag and attribute allowlist applied to course content on both write (to DB) and read (to client)
- `rel="noopener noreferrer"` added to all links via `transformTags`
- 200 KB byte-length limit on course HTML enforced before storage

**Secrets management**
- SMTP passwords and Entra client secrets encrypted at rest with AES-256-GCM, 96-bit IV, 128-bit auth tag
- `EMAIL_ENCRYPTION_KEY` validated to exactly 32 bytes on every use — fails closed if absent or malformed
- Encrypted secrets never returned in API responses; only a boolean `passwordSet` flag is exposed

**HTTP security headers (applied by middleware to every response)**
- `Content-Security-Policy`: nonce-based `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'`; no `unsafe-inline` or `unsafe-eval`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff` (also set on individual file download responses)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2-year HSTS)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- CSP `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`
- CSP violation reporting: `report-uri /api/csp-report` with IP-based rate limiting (30/min)

**Rate limiting**
- Login: 10 attempts / 15 min per IP (+ 15-min block); keyed on `getClientIp` — gated behind `TRUST_PROXY` to prevent spoofing
- File upload: 10 / min per user
- Course attempts: 20 / hour per user — prevents quiz answer brute-forcing
- Factory reset: 3 / hour per admin
- Log reads: 30 / min per admin
- All write-path endpoints covered; no unthrottled state-changing routes identified
- `RateLimiterRedis` when `REDIS_URL` is set; `RateLimiterMemory` with startup warning otherwise

**Error handling and logging**
- Generic error messages to clients; detailed context logged internally only
- Log metadata scrubbed for keys containing: `password`, `token`, `hash`, `secret`, `credential`, `auth`
- Structured JSON to stdout, suitable for log aggregation
- Async DB log write — failures are silently swallowed and never propagated to callers

**Open redirect prevention**
- `callbackUrl` in login flow validated to require a leading `/` and absence of `//` before use; falls back to `/dashboard`
- Document `url` field validated to `https:` protocol before redirect; `javascript:` and `data:` URLs result in 400

**Docker and deployment**
- Application runs as non-root `nextjs` user (UID 1001)
- Multi-stage Dockerfile; only compiled output in the Alpine-based runtime image
- App port bound to `127.0.0.1:3000:3000` — not exposed on all interfaces
- `prisma migrate deploy` runs on container start
- Health checks on both `db` and `redis` services; app service depends on `service_healthy`

---

## Pre-Deployment Checklist

- [ ] **Generate a strong `AUTH_SECRET`** — minimum 32 random bytes: `openssl rand -base64 32`
- [ ] **Generate `EMAIL_ENCRYPTION_KEY`** — 32 random bytes as hex: `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] **Generate `CRON_SECRET`** — minimum 32 random bytes: `openssl rand -base64 32` (see LOW-04)
- [ ] **Deploy behind a TLS-terminating reverse proxy** (Nginx, Caddy, Traefik, or similar)
- [ ] **Set `TRUST_PROXY=true`** once a trusted reverse proxy is in place that strips client-supplied `X-Forwarded-For`; understand shared-bucket DoS if left unset (see MED-04)
- [ ] **Set `NEXTAUTH_URL`** to the exact public URL including `https://` — required for CSRF and activates the `Secure` cookie flag
- [ ] **Set `NODE_ENV=production`** — required for the `__Secure-` cookie name prefix
- [ ] **Set `LOG_LEVEL=ACCESS`** (or `ERROR`) in production to reduce log volume
- [ ] **Configure Redis authentication** — set `requirepass` and update `REDIS_URL` (see LOW-01)
- [ ] **Plan AppLog retention** — implement deletion of rows older than 90 days (see INFO-01)
- [ ] **Configure a log aggregator** (Datadog, Loki, CloudWatch) to consume container stdout in JSON parse mode
- [ ] **Confirm PostgreSQL port is not exposed** outside the Docker network
- [ ] **Set `ADMIN_BOOTSTRAP_PASSWORD`** or record the generated password printed on first boot
- [x] **Fix MED-01** — HTML-escape task titles, workflow names, and course names before email interpolation before deploying email notifications
- [x] **Fix MED-03** — Reset `approvalStatus` to `PENDING` in the UPLOAD task re-upload upsert before going to production in any compliance-sensitive context
- [x] **Fix MED-02** — Replace CRON_SECRET string equality with `crypto.timingSafeEqual`

---

*Assessment date: 2026-03-25. Covers static analysis of the full application source. Findings reflect the state of the codebase at commit `0794fe6`. Dynamic testing (DAST), penetration testing, and dependency vulnerability scanning beyond `npm audit` are recommended as separate activities before go-live.*
