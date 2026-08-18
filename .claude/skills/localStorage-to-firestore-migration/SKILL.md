---
name: localStorage-to-firestore-migration
description: Guides the planned swap of CheckinStateService (and eventually AgendaStateService) from localStorage to Firestore for real cross-device sync. Use when actually implementing this migration, not before — it's documented here as a plan, not yet started.
---

This project's check-in feature currently persists to `localStorage` via
`StorageService` (see `CLAUDE.md`'s Persistence section) — a deliberate
stand-in chosen so the role-locking logic could be built and tested
without standing up a Firebase project first. This was never step one of
an in-progress Firebase rollout; it's a complete, working substitute that
this skill describes how to replace when the time comes.

**Do not start this migration speculatively.** It requires a real
Firebase project, billing awareness, and changes the app's trust model
(client-side security rules become the enforcement boundary instead of
nothing). Only follow this when explicitly asked to implement real
cross-device sync.

## Why Firestore, not the alternatives

Already decided (see `CLAUDE.md` and the backend-comparison analysis done
for this project): Firestore's `runTransaction()` gives atomic
check-and-set for role claims for free, and `onSnapshot()`/`docData()`
gives live cross-device sync for free — no hand-rolled WebSocket server,
no custom locking logic to get right. A custom MongoDB/Spring Boot/
Auth0 stack was considered and rejected specifically because Render's
free-tier cold starts land on exactly the moment the check-in page
matters most (everyone opening the link 10 minutes before a meeting).

## What changes, and what doesn't

**Doesn't change:** `CheckinStateService`'s public method signatures —
`checkIn()`, `claimRole()`, `releaseRole()`, `addSpeakerSignup()`,
`claimEvaluatorSlot()`, `releaseEvaluatorSlot()`, `updateMeeting()`. No
component (`RoleBoardComponent`, `SpeakerSignupComponent`,
`EvaluatorSlotsComponent`, `AttendanceListComponent`,
`CheckinComponent`) needs to change at all — they only ever called these
methods, never touched storage directly.

**Changes:** the *internals* of `CheckinStateService`'s persistence layer
— `StorageService`'s `get`/`set` calls get replaced with Firestore SDK
calls (`docData()` for reads, `updateDoc()` for writes,
`runTransaction()` specifically for `claimRole`/`claimEvaluatorSlot`,
since those need atomic check-and-set — see the
`role-locking-pattern` skill for what that logic currently does with
`localStorage`, which is exactly what `runTransaction()` needs to
reproduce against a real document).

## Setup (once, when this migration actually starts)

1. `npm install firebase @angular/fire`
2. Firebase Local Emulator Suite for offline dev/test:
   `npm install -g firebase-tools`, then `firebase init emulators`
   (Firestore + Auth), then `firebase emulators:start`. Fully offline
   after this one-time init. Do not skip this — a hand-rolled mock of
   Firestore's transaction semantics will not faithfully reproduce its
   retry-on-conflict behavior, so the role-locking logic must be tested
   against either the emulator or a real project, never a plain mock.
2. In `app.config.ts`, add `provideFirestore`/`provideAuth`, wired to the
   emulator when `isDevMode()`.
3. Rewrite `CheckinStateService`'s private `persist()`/`loadSnapshot()`
   (and the `claimRole`/`claimEvaluatorSlot` methods specifically, for
   the transaction) to use Firestore calls instead of `StorageService`.
   `RoleDefinitionService` can migrate the same way if/when club-specific
   role customization needs to sync too.
4. Identity: `currentUid` currently comes from a locally-generated id
   persisted in `localStorage`. Real cross-device identity requires
   Firebase Auth (see the multi-tenant plan referenced in `CLAUDE.md` for
   the fuller picture — accounts become necessary once subscription
   status needs to follow a person across devices, not just this
   migration alone).

## Verification

Existing specs in `checkin-state.service.spec.ts` use a `FakeStorage`
in-memory implementation — once the service depends on Firestore instead
of `StorageService`, those specs either need an emulator-backed test
environment or should be reconsidered as integration tests run
separately from the fast unit suite. Don't just delete the coverage;
decide deliberately where claim-locking correctness gets re-verified
against real Firestore transaction semantics.
