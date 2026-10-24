# Security Advisories

This file tracks security vulnerabilities that affected this project's runtime or dependencies
and how they were remediated. It is a paper trail for audits, not a vulnerability disclosure
policy.

## CVE-2026-111497 ("Node2Shell" / "HTTP2Shell" / "Python2Shell")

- **Disclosed**: 2026-10-21
- **Severity**: Critical, CVSS v4.0 9.2
- **Remediated**: 2026-10-24
- **Summary**: Out-of-bounds write in Google's Brotli decoder (`DecodeBlockTypeAndLength()`,
  libbrotli versions 1.0.3-1.2.0). A crafted Brotli stream forces an impossible block-type switch;
  the decoder mistakes the format error for "need more input" and keeps writing attacker-controlled
  bytes past an internal buffer, corrupting heap memory in any process that decompresses untrusted
  Brotli data. Can result in a crash, memory disclosure, or remote code execution.
- **Exposure in this app**: The app's container pinned `node:20-alpine` (`Dockerfile`). Node 20.x
  vendors Brotli 1.1.0, inside the vulnerable range, and Node 20 reached end-of-life on
  2026-04-30 -- it will never receive this fix. The app has no direct or transitive npm/Python
  Brotli dependency; exposure was entirely via Node's built-in decoder, reachable through
  `lib/email.ts`'s outbound `fetch()` calls to Microsoft Entra/Graph (which auto-decompress
  `Content-Encoding: br` responses) and, as an unaudited residual risk, any inbound request
  handling that might decompress a client-supplied `Content-Encoding: br` body.
- **Fix applied**:
  - `Dockerfile`: base image bumped from `node:20-alpine` to `node:24.22.1-alpine` (Node 24,
    Active LTS, carries the upstream fix). Pinned to the exact patch version rather than a
    floating major tag.
  - `package.json`: added an `engines` field (`"node": ">=24.22.1 <25"`) and bumped
    `@types/node` to match, so the minimum patched version is enforced and documented in the one
    repo file most likely to be checked before any future base-image change.
  - `.nvmrc`: added, pinned to `24.22.1`, for local-dev parity with the container.
  - `REVERSE_PROXY.md`: added a compensating control at the reverse-proxy layer (Caddy and Nginx
    configs) rejecting any inbound request with `Content-Encoding: br` -- this app has no
    legitimate use case for a compressed request body, so this closes the inbound path as
    defense in depth, independent of and in addition to the runtime upgrade.
- **Verification**: see `REVERSE_PROXY.md` check #9, and the full verification plan run against
  the rebuilt image (patched `node -v`, full Jest suite, native-module/login smoke test, the
  Microsoft Graph/Entra email flow end-to-end, and a broad manual smoke pass) before rollout.
- **Residual/follow-up items**:
  - The live reverse-proxy instance (outside this repo) must have the matching config applied
    and confirmed -- the `REVERSE_PROXY.md` update documents the requirement but does not itself
    change the running proxy.
  - If `docker build` fails during Prisma's query-engine resolution against the new Alpine base's
    OpenSSL version, bump `prisma`/`@prisma/client` (currently pinned `^5.22.0`) to a release with
    a matching binary target, then re-verify.
