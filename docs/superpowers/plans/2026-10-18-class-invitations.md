# Class invitations implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with test-driven-development and final requesting-code-review.

**Goal:** A teacher can copy a class invitation link, and a student can follow it through authentication, explicit joining and opening the right lesson.

**Architecture:** Add a public invitation preview containing only class name and current membership status. Reuse the existing idempotent join API and class code, returning a server-chosen next path. Keep invitation state in `/join/:code` through authentication and reload. Registration accepts RU/KK language with existing defaults.

**Tech Stack:** React, Express, PostgreSQL, TypeScript, Playwright; no new dependencies or migration.

**Spec:** User requested the next iteration following the lesson-flow work; next agreed priority is invitation → account → class → topic, from docs/PRODUCT_DIRECTION.md.

## Global constraints

- Preserve prior local improvements, user accounts, results and media.
- Joining requires a logged-in student and an explicit button; preview GET never joins.
- Reuse the existing invitation code; retain manual joining and teacher workflows.
- Reveal no roster, email, teacher identity or private lesson data before joining.
- Support RU/KK, a 390px phone and the existing dark/mint visual language.
- Do not send invitations externally or push changes.

## Review focus

- Invalid, malformed and changed invitation codes do not retain stale class information.
- Registering or logging in preserves the invitation; teacher/creator accounts cannot join.
- Duplicate joins create one membership; class without a current topic still has a usable destination.
- Private current lessons become accessible only after membership; hidden public lessons remain filtered.
- Clipboard failure leaves a selectable link; guest/role state updates and route changes do not submit an old code.

### Task 1: API and destination

Files: server/index.ts, tests/invitations.spec.ts.

- [x] Write failing tests for safe preview, role/access checks, idempotent join and server-selected destination.
- [x] Add preview, shared code validation and join destination; test current private topic, unfinished assignment and empty class.
- [x] Verify all API checks.

### Task 2: Invitation/auth UI

Files: src/JoinClass.tsx, src/Auth.tsx, src/main.tsx, src/style.css; tests/invitations.spec.ts.

- [x] Write failing phone/browser tests for guest registration and existing-account login through invitation, invalid link and wrong role.
- [x] Add landing page, error/retry states, explicit join and persistent invitation route through authentication.
- [x] Add language choice to registration, keeping default RU and existing role behavior elsewhere.
- [x] Verify UI and persistence after reload; inspect mobile screenshot.

### Task 3: Teacher sharing and verification

Files: src/Teacher.tsx, docs/CLASS_INVITATIONS.md; tests/invitations.spec.ts.

- [x] Test visible selectable link and successful/failed copy feedback.
- [x] Add copy button, selectable fallback, bilingual instructions and local-host explanation for localhost links.
- [x] Run invitation and affected MVP/daily/lesson-flow tests, build and formatting; independent review and corrections.
- [x] Document behavior, mark plan complete and leave application running.


Verification: 34/34 selected Playwright scenarios passed across invitations, lesson-flow, MVP and daily sessions. Eight new invitation scenarios include delayed mutation regression tests. TypeScript/production build, changed-file formatting and diff checks passed. Static independent review found late-navigation/login reopening, reproduced and fixed with mounted/account guards. Invitation and teacher sharing screenshots inspected at 390px. No dependencies, migration or push; previous changes retained.
