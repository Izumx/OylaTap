# Lesson flow implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Make the approved first iteration concrete: video covers, useful microquestion feedback and one clear next step after viewing or testing.

**Architecture:** Generate JPEG covers on demand behind the same access check as video, cache by media identity, and expose the first playable episode in the catalogue. Keep existing React components, RU/KK translations and separate viewing/assessment signals.

**Tech Stack:** Express, PostgreSQL, React, TypeScript, FFmpeg, Playwright.

**Spec:** User-approved first iteration in this chat and docs/PRODUCT_DIRECTION.md.

## Global constraints

- Preserve local Khanate seed integration, existing accounts, results and media.
- Continue in the running local checkout; no dependency additions or database migrations.
- Keep the current dark/mint visual language and existing typography.
- Retelling remains optional; a wrong answer never locks navigation.

## Review focus

- Private video must imply private cover, including after a cover has been cached.
- Missing/unreadable video or failed cover generation keeps the existing illustration usable.
- Wrong-answer replay restarts the same episode rather than advancing or resuming at its end.
- A partial test score points to its saved review, including after page reload.
- Correct feedback and session end fit a 390px phone and keep guest access working.

### Task 1: Real video covers

Files: server/posters.ts, server/index.ts, src/lib.tsx, src/components.tsx, src/SeasonPage.tsx, src/style.css; tests/lesson-flow.spec.ts.

- [x] Add API/UI tests for JPEG cover, private access and fallback.
- [x] Run tests and confirm missing endpoint/cover failure.
- [x] Implement first playable episode metadata, protected JPEG endpoint, cached extraction and reusable cover with illustration fallback.
- [x] Run cover tests and TypeScript build.

### Task 2: Microquestion and viewing completion

Files: src/Student.tsx, src/style.css; tests/lesson-flow.spec.ts.

- [x] Test wrong answer → replay from start → correct answer → clear next step on mobile.
- [x] Confirm failure, then add replay and explicit feedback, preserving retry and optional navigation.
- [x] Make session end distinguish watched clips from correct microquestions, highlight the final test and remove duplicate primary actions.
- [x] Verify guest and existing daily routes.

### Task 3: Topic next step and verification

Files: src/SeasonPage.tsx, docs/LEARNING_PATH.md; tests/lesson-flow.spec.ts.

- [x] Test watched topic with partial saved score → primary link to review, full score → optional retelling.
- [x] Confirm failure, implement focused next-step copy and action.
- [x] Run new and affected browser tests, build, formatting and diff checks; visually inspect mobile and desktop screenshots.
- [x] Review changes, fix findings and leave the app running locally.

## Execution notes

The user explicitly asked to proceed; execute inline without another approval round. Cover generation uses existing FFmpeg. No new media generation or external services are required.


Verification: 26/26 Playwright scenarios passed (MVP, daily and lesson-flow), production build and formatting passed. Independent review found incorrect next-step copy for retelling/complete; reproduced in two failing tests, fixed and verified. Mobile/desktop topic, library and feedback screenshots inspected. New test suite uses its own PostgreSQL pool to avoid closing another file's shared connection. Existing local seed changes preserved; no push performed.
