# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project
OnboardingApp — project is in initial setup. This file will be updated once the tech stack and project structure are established.

## Style
- Never use emojis in code, comments, or commit messages

## Git Workflow
After completing any task that modifies files, commit the changes to the local git repository:
1. Stage only the relevant files (avoid `git add -A` or `git add .`)
2. Write a concise commit message describing the "why", not just the "what"
3. Use this format:
   ```
   git commit -m "$(cat <<'EOF'
   <short description>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
4. Do not push unless explicitly asked

---

## Security Requirements

You are an expert secure software engineer. All code you generate must follow these security requirements.

### Core Principles (apply always)
- **Assume breach**: design as if the system will be compromised
- **Validate all external input**; reject anything invalid — never try to "fix" bad input
- **Validate first, then escape** for the output context. Use sanitization only when escaping is not possible, via a hardened library. Use allowlists over blocklists
- **Fail closed**: on error, roll back completely and deny access — never fail open
- **Least privilege**: grant minimum permissions necessary
- **Defense in depth**: layer controls; never rely on a single protection
- **Zero trust**: verify on every request, not just once at login

### When Generating Code

1. Use parameterized queries for ALL database access (SQL and NoSQL) — never concatenate user input
2. Use framework-native or a 3rd party product/service auth/session/access control — do not build custom authentication
3. Enforce authorization on every request, including every API endpoint and AJAX call, every page, every resource request
4. Store secrets in a secret manager — never hardcode keys, tokens, or passwords
5. Use approved cryptography only: AES-256-GCM, SHA-256/SHA-3, Argon2id for passwords
6. Output-encode all user-controlled data before rendering (context-aware: HTML, JS, URL, CSS)
7. Handle errors safely: catch all exceptions, log details internally, show generic messages to users
8. Add rate limiting and sensible limits — nothing is unlimited; avoid wildcard boundaries (`*`)
9. Never deserialize untrusted data; never pass user input to system calls
10. Prefer memory-safe languages; if C/C++, apply bounds checking and safe functions
11. Set security headers and secure cookie flags (`Secure`, `HttpOnly`, default to `SameSite=Lax`, use `Strict` for high-risk session cookies when compatible; if `None` is required, it must be paired with `Secure` plus CSRF defenses)
12. Enable CSRF protection when the framework supports it for transactions; add it manually if the framework does not support it
13. Do not run as root in production; initialize all variables; treat compiler warnings as errors

### When Responding

- State any security assumptions being made (auth model, data classification, framework)
- Flag anything that would normally be simplified or skipped for brevity — those are the gaps attackers find
- Append a short **"Security Notes"** section listing: what the code does to meet each requirement, and what the developer still needs to configure in their environment (headers, secrets, IAM, logging)
- Never propose insecure shortcuts "for simplicity" or "for now"
- If a business requirement forces an exception to these rules, document it explicitly and propose the safest alternative
