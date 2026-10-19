# Восстановление пароля / Құпиясөзді қалпына келтіру

Recovery uses existing scrypt password hashing and PostgreSQL sessions. No auth provider migration is required.

## Configuration

Apply `db/010_password_reset.sql` using the normal migration runner before enabling the router. Mount `recoveryRouter()` at `/api/auth`, after auth rate limiting. Add public React routes `/forgot-password` and `/reset-password`, both rendering `RecoveryPage` from `src/Recovery.tsx`.

Set these environment variables on the server, then restart through the normal deployment process:

```
PASSWORD_RECOVERY_ENABLED=false
APP_URL=https://your-real-domain.example
SMTP_HOST=smtp.provider.example
SMTP_PORT=587
SMTP_USER=provider-username
SMTP_PASSWORD=provider-secret
SMTP_FROM=OylaTap <noreply@your-real-domain.example>
```

Keep delivery disabled until the owner chooses the provider and authorizes email sending. Set `PASSWORD_RECOVERY_ENABLED=true` to activate configured delivery. Without a complete configuration, the status endpoint returns `enabled:false`, the request endpoint returns 503, and the UI honestly explains that email recovery is unavailable. Status indicates configuration readiness, not an SMTP health check.

`APP_URL` must contain only an HTTPS origin; credentials, paths, query and fragment are rejected. HTTP loopback origins are accepted only outside production. Reset links never use the request Host header. Port 465 uses implicit TLS; other ports require STARTTLS with certificate validation. SMTP debug/message logging, file access and URL access are disabled. No external email is sent by the automated tests.

## Behavior and security

- `GET /api/auth/recovery-status` reports configuration readiness.
- `POST /api/auth/password-reset/request` accepts `{email,language?:'ru'|'kk'}`. Valid requests receive the same 202 response before account lookup or email work, including unknown accounts and SMTP failures. This prevents response timing from exposing SMTP/account existence. Delivery is best effort inside the server process: a crash after acknowledgement may require another request; this is not a durable email queue.
- Messages are localized and contain a 256-bit random token in the URL fragment. Only SHA-256 digests are stored. Fragments do not reach HTTP access logs or Referrer headers; the reset page immediately removes the fragment from browser history. Reverse proxies and analytics must never capture form bodies or page fragments.
- Tokens expire after 30 minutes. Expired records are pruned on reset requests. Deleting an account cascades to its tokens.
- `POST /api/auth/password-reset/confirm` accepts `{token,password}`. Passwords must contain 10–128 characters. Account locking, token consumption, password change, deletion of every session and invalidation of every other reset link occur in one transaction. Concurrent confirmations can succeed only once. Existing login sessions become invalid on their next request. Reset does not automatically sign the user in.
- The existing auth IP limiter must cover both endpoints. For multiple server replicas, replace its process-local store with a shared limiter and add recipient/global email quotas before large-scale deployment.
- Reset routes accept no redirect destination. A class invitation remains usable through its original link after logging in again.
- SMTP failures emit only a fixed operational warning, never the token, recipient or provider diagnostics. A failed token is deleted without affecting existing passwords or sessions.

## Verification

Run `npx playwright test tests/recovery.spec.ts`. Tests use a unique temporary PostgreSQL schema and independent HTTP listener, inject an in-memory mail sender, and close only their own database pools. They prove generic unknown-account responses, trusted reset origin, hashed token storage, password update, expiry, single use, concurrent replay protection, all-session revocation and other-link invalidation. They do not modify production users or sessions. The test runner may reuse the already-running app health endpoint; the recovery HTTP server is isolated.

SMTP readiness still requires an owner-authorized send/delivery check after the provider and public HTTPS origin are supplied. DNS/domain verification, SPF/DKIM/DMARC and provider quotas are operational configuration for the chosen provider.
