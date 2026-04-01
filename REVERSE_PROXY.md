# Reverse Proxy Configuration Requirements

This document describes how to configure the reverse proxy that sits in front of the OnboardingApp in a DMZ deployment. All examples use Nginx; adapt to your proxy (Caddy, Traefik, HAProxy) as needed.

The app listens on `127.0.0.1:3000` (HTTP, no TLS). The reverse proxy terminates TLS and forwards requests to the app over the loopback interface.

---

## Prerequisites

Before configuring the proxy, ensure:

1. `NEXTAUTH_URL` is set to the external HTTPS URL (e.g. `https://onboarding.corp.example.com`).
2. `TRUST_PROXY=true` is set in the app environment so rate limiting keys on the real client IP from `X-Forwarded-For`.
3. A TLS certificate and private key are available for the external hostname.

---

## Complete Nginx Configuration

```nginx
# /etc/nginx/conf.d/onboarding.conf

# Rate limit zone for general abuse prevention (optional, defense-in-depth
# alongside the app's own rate limiting)
limit_req_zone $binary_remote_addr zone=general:10m rate=30r/s;

server {
    listen 80;
    server_name onboarding.corp.example.com;

    # Redirect all HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name onboarding.corp.example.com;

    # -------------------------------------------------------------------
    # TLS
    # -------------------------------------------------------------------
    ssl_certificate     /etc/nginx/tls/onboarding.crt;
    ssl_certificate_key /etc/nginx/tls/onboarding.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';
    ssl_prefer_server_ciphers on;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;

    # OCSP stapling (if your CA supports it)
    # ssl_stapling on;
    # ssl_stapling_verify on;
    # ssl_trusted_certificate /etc/nginx/tls/ca-chain.crt;

    # -------------------------------------------------------------------
    # Request limits
    # -------------------------------------------------------------------
    client_max_body_size 30m;  # Slightly above the app's 25 MB upload limit

    # -------------------------------------------------------------------
    # Timeouts
    # -------------------------------------------------------------------
    proxy_connect_timeout 5s;
    proxy_send_timeout    30s;
    proxy_read_timeout    60s;

    # -------------------------------------------------------------------
    # Path restrictions -- block endpoints that must not be externally accessible
    # -------------------------------------------------------------------

    # Cron endpoints are called by an internal scheduler, not through the proxy
    location /api/cron/ {
        return 403;
    }

    # Factory reset must never be triggered from the internet
    location /api/admin/factory-reset {
        return 403;
    }

    # Files are served through authenticated API routes, not directly
    location /uploads/ {
        return 404;
    }

    # -------------------------------------------------------------------
    # Proxy to app
    # -------------------------------------------------------------------
    location / {
        limit_req zone=general burst=60 nodelay;

        proxy_pass http://127.0.0.1:3000;

        # --- Headers (security-critical) ---

        # Strip any client-supplied forwarded headers, then set real values.
        # This prevents clients from spoofing their IP to bypass rate limits.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Host              $host;

        # Request correlation ID for tracing across Palo Alto, proxy, and app logs.
        # The app reads this in middleware and echoes it on the response.
        proxy_set_header X-Request-ID $request_id;

        # --- Proxy behavior ---
        proxy_http_version 1.1;
        proxy_set_header Connection '';

        # Do not buffer responses -- the app streams file downloads
        proxy_buffering off;

        # Do not pass the Server header from the backend
        proxy_hide_header X-Powered-By;
    }

    # -------------------------------------------------------------------
    # Health check endpoint (for upstream monitoring, not user-facing)
    # -------------------------------------------------------------------
    location = /api/health {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;

        # No rate limiting on health probes
        # No forwarded headers needed (the app does not log or rate-limit this endpoint)

        access_log off;
    }
}
```

---

## Header Requirements Explained

| Header | Value | Why |
|--------|-------|-----|
| `X-Forwarded-For` | `$remote_addr` | The app uses this for per-IP rate limiting when `TRUST_PROXY=true`. Must be set to the real client IP, not appended to a client-supplied value. |
| `X-Real-IP` | `$remote_addr` | Fallback read by `lib/ip.ts` if `X-Forwarded-For` is missing. |
| `X-Forwarded-Proto` | `$scheme` | Auth.js uses this to determine if the connection is secure. Required for correct cookie `Secure` flag behavior. |
| `X-Forwarded-Host` | `$host` | Used by Auth.js for callback URL construction. |
| `Host` | `$host` | Must match `NEXTAUTH_URL` hostname for CSRF validation. |
| `X-Request-ID` | `$request_id` | Nginx-generated unique ID. The app preserves it in logs and echoes it on the response for end-to-end request tracing. |

---

## Path Restrictions Explained

| Path | Action | Reason |
|------|--------|--------|
| `/api/cron/*` | `403` | Cron endpoints are protected by a shared secret but should only be called from an internal scheduler, not exposed to the internet. Schedule calls from a host in the trust zone directly to `127.0.0.1:3000`. |
| `/api/admin/factory-reset` | `403` | Destructive endpoint that deletes all data. The app also has an `DISABLE_FACTORY_RESET` env guard, but blocking at the proxy is defense-in-depth. |
| `/uploads/` | `404` | Files are served through authenticated API routes (`/api/documents/[id]/download`, `/api/attachments/[id]/download`). Direct filesystem access must be blocked. |

---

## Verification

After deploying the proxy, verify these behaviors:

```bash
# 1. HTTPS redirect
curl -sI http://onboarding.corp.example.com/login
# Expect: 301 -> https://...

# 2. Cron blocked
curl -sI https://onboarding.corp.example.com/api/cron/log-cleanup
# Expect: 403

# 3. Factory reset blocked
curl -sI https://onboarding.corp.example.com/api/admin/factory-reset
# Expect: 403

# 4. Uploads blocked
curl -sI https://onboarding.corp.example.com/uploads/anything
# Expect: 404

# 5. Health check passes
curl -s https://onboarding.corp.example.com/api/health
# Expect: {"status":"ok"}

# 6. X-Request-ID echoed
curl -sI https://onboarding.corp.example.com/login | grep -i x-request-id
# Expect: X-Request-ID: <hex string>

# 7. Cache-Control on API
curl -sI https://onboarding.corp.example.com/api/tasks | grep -i cache-control
# Expect: Cache-Control: no-store

# 8. Security headers present
curl -sI https://onboarding.corp.example.com/login | grep -iE '(strict-transport|content-security-policy|x-frame)'
# Expect: HSTS, CSP, X-Frame-Options: DENY
```
