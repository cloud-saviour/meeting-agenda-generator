---
name: safe-debugging-practices
description: Rules for handling local Firebase emulator (Auth/Firestore) data safely while debugging or testing — when it's fine to wipe data and when it isn't, plus a real incident (the Auth emulator does not isolate by projectId, unlike Firestore's rules-unit-testing) that caused an accidental wipe of interactive dev accounts. Use before running any clear/delete/reset command against emulator data, or when investigating surprising emulator behavior.
---

## The incident this skill exists because of

While debugging why a new `AuthService.signUp()` emulator spec kept failing
with `auth/email-already-in-use`, the working hypothesis was that the Auth
emulator isolates accounts by the `projectId` passed to `initializeApp()` —
the same way Firestore's `@firebase/rules-unit-testing` genuinely does for
Firestore data. That hypothesis is **wrong**: the Auth emulator (unlike
Firestore's) does not isolate by client-supplied `projectId` at all — every
account created against `http://127.0.0.1:9099`, regardless of what
`projectId` string the client SDK was initialized with, lands in the same
single bucket as this machine's interactive dev session (the same one
holding `admin@example.com` and any account created through the Emulator
UI). Confirmed by creating the same email under three different `projectId`
values and getting `already-in-use` every time.

The mistake that followed: to test *why* a clear-accounts call against a
throwaway test project id wasn't working, the next step was running the
same destructive `DELETE .../emulator/v1/projects/{id}/accounts` call again
— but with the id swapped to `meeting-agenda-generator`, the **real dev
project** from `.firebaserc` — "just to see" where the account actually
lived. It did live there. That call wiped every interactive account in the
shared bucket, including `admin@example.com` and a real user account set up
earlier in the same session, entirely as a side effect of a debugging
experiment nobody asked for.

**The actual error was treating a clear/delete call as a cheap, read-only
diagnostic.** It isn't — it's exactly as destructive as `rm -rf` on a
directory whose contents were never checked first.

## Rule: destructive commands need the same care regardless of "how local" the target is

A command that deletes, clears, or resets state gets paused-and-confirmed
treatment — same bar as `git reset --hard` or `rm -rf` — the moment either
of these is true:

- **I didn't create the target data for this specific throwaway purpose.**
  If I don't know for certain everything in scope was created by me, in
  this session, for this debugging task, treat it as owned by someone else.
- **The target's scope is ambiguous or unverified.** "This project id
  *should* be isolated" is a hypothesis, not a fact, until proven — proving
  it destructively (by deleting and seeing what breaks) is backwards. Read
  or list first (`GET`/query the resource) to see what's actually there
  *before* reaching for delete.

"It's just the local emulator" does not downgrade this. Data a human set up
interactively — an admin account, a seeded role list, a manually-created
test user — represents real work and a real expectation that it persists,
even though it happens to live in a disposable local process.

## When wiping emulator data is fine, no need to pause

- **Firestore tests via `@firebase/rules-unit-testing`** — every
  `*.emulator.spec.ts` file in this repo (`role-definition.service.emulator.spec.ts`,
  `checkin-state.service.emulator.spec.ts`, etc.) calls
  `testEnv.clearFirestore()` in `beforeEach`, and each file's
  `initializeTestEnvironment()` uses its own distinct `projectId`
  (`meeting-agenda-generator-test`, `-roles-test`, `-members-test`, ...).
  This genuinely isolates — Firestore's rules-unit-testing really does spin
  up a separate backing project per id, unlike Auth (see above). Clearing
  within one of these is scoped to that test file alone and is exactly what
  the pattern is for.
- **Data created moments earlier in the same debugging session**, with no
  other consumer — e.g. a throwaway document written to prove a write
  succeeds, immediately before deleting it again.
- **Whenever the user has explicitly said the data is disposable** — "wipe
  the emulator," "reset the dev data," "clear my test accounts."

## When it isn't — pause or ask first

- **The Auth emulator, full stop, for any `projectId` other than a value
  already proven (by reading, not assuming) to be genuinely isolated.**
  Given the incident above, assume every Auth emulator account lives in one
  shared bucket unless proven otherwise for the firebase-tools version in
  use. Never call its clear-accounts endpoint
  (`DELETE .../emulator/v1/projects/{id}/accounts`) against anything but a
  project id you are certain holds only your own throwaway data — and when
  testing *whether* isolation exists, verify by creating and reading back a
  uniquely-named probe account, never by deleting first.
- **`meeting-agenda-generator`** — the real project id from `.firebaserc` —
  is never a safe target for an exploratory delete. If a debugging
  hypothesis requires pointing a destructive command at it, that is the
  signal to stop and ask, not to run it "as a quick test."
- **Anything set up interactively by the user** (`admin@example.com`, a
  personal account created via the Emulator UI, seeded role definitions)
  regardless of which emulator or project it lives in.

## Concrete alternative: unique-per-run identifiers instead of clearing

`auth.service.emulator.spec.ts` was rewritten to sidestep the whole problem
rather than work around it: instead of clearing the shared Auth bucket
before each test, every test generates a unique-per-run email (a
timestamp + random suffix). Repeat runs never collide with leftover data
from a previous run *or* with real interactive accounts, and nothing ever
needs to be deleted. Prefer this shape — unique disposable identifiers —
over clear-then-recreate whenever the target's isolation can't be verified.
