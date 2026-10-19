# Multiuser readiness implementation plan

> **For agentic workers:** Use focused parallel agents for recovery and backups; parent implements durable rendering and integration. Apply TDD and independent final review.

**Goal:** Implement the approved readiness work: recovery, database/media backups with a restore rehearsal, durable rendering, and honest RU/KK/PWA checks.

**Architecture:** Keep custom PostgreSQL authentication with hashed one-use reset tokens and configurable SMTP. Export consistent PostgreSQL snapshots together with referenced media and checksums; restore only into a separate new/empty target. Persist rendering requests in PostgreSQL and hold a row lock for each worker's processing transaction, so a process crash releases the lock and rolls back its claim. Isolate temporary render output before atomic promotion.

**Tech Stack:** Express, React, PostgreSQL, Node.js, FFmpeg, Playwright.

**Spec:** User explicitly selected item 6 from the improvement list. Mail service/public origin are being clarified asynchronously; implement configurable delivery without contacting external recipients.

## Global constraints

- Preserve existing accounts, media, local configuration and earlier uncommitted features.
- User subsequently authorized an Oracle pilot deployment. Preserve Zherkoz and its data. No outgoing real mail or Git push.
- Reset requests must not enumerate accounts; successful reset revokes old sessions.
- Backups include database and referenced media; restore rehearsal never overwrites live data.
- Existing uploaded cuts remain intact; queued requests survive process termination and cannot be claimed by two workers simultaneously.
- Mobile browser emulation is evidence about the browser only; physical-device checks stay explicitly pending.

## Review focus

- Expired/reused reset tokens and concurrent consumption cannot change passwords twice.
- No SMTP configuration must lead to an honest unavailable UI, not a false sent-email claim.
- Backup snapshots and file integrity checks detect missing/corrupt media; restore paths cannot escape the target.
- Worker crash, lock loss and graceful shutdown leave retryable queued work without duplicate publication.
- RU/KK offline screen, responsive recovery/invitation forms and session revocation are checked.

### Recovery (agent)

- [x] Implement migration010, reset router/mail configuration, request/reset screens and focused tests.
- [x] Integrate router/routes/config; verify no real mail sent.

### Backup/restore (agent)

- [x] Implement safe cross-platform backup/inspect/restore commands and documentation.
- [x] Produce a real local backup and verify restoration into a fresh database/media directory.

### Durable video jobs (parent)

- [x] Add failing tests for atomic enqueue, duplicate exclusion and recovery after killing a worker.
- [x] Add migration011 and transactional PostgreSQL queue; replace in-memory fire-and-forget launch and blanket startup failure.
- [x] Use isolated render work/output and cancellation on shutdown/lock loss; retain original uploaded MP4s.
- [x] Verify job success/failure and existing author rendering/publishing flow.

### Integration/acceptance

- [x] Apply additive migrations, configure local run without SMTP credentials, expose useful queue state.
- [x] Verify bilingual PWA fallback and responsive flows; document physical-device and production setup requirements.
- [x] Build, formatting, affected tests, independent review and final health check; record actual limitations.
