---
name: tdd-workflow
description: The red-green-refactor loop for this project. Use whenever implementing a new service, utility function, or behavior change in src/app/services/ or src/app/utils/ — write the failing test before the implementation, not after.
---

Tests in this project exist to be written first, not backfilled. This
skill is the process; `angular-test-writer` (a subagent) is the tool that
actually writes the spec files — invoke it as step 2 below, not before
you know what behavior you're testing.

## The loop

1. **Describe the behavior in plain terms before writing any code.** What
   should the new method/function do, and — just as important — what
   should it refuse to do? (See `role-locking-pattern` for the specific
   shape this takes when the new thing is a claim/release action.)

2. **Write the failing spec first.** Either write it yourself or invoke
   the `angular-test-writer` agent, describing the behavior from step 1.
   The spec should fail at this point — there's no implementation yet, or
   the implementation doesn't yet handle the case you're describing.

3. **Confirm red.** Run `ng test --watch=false` (or `npm test`). The new
   spec must actually fail, not error out for an unrelated reason
   (missing import, typo). A spec that fails for the wrong reason isn't
   testing what you think it's testing.

4. **Implement the minimum to turn it green.** Don't add behavior beyond
   what the failing spec demands yet.

5. **Confirm green.** Run `ng test --watch=false` again. The new spec
   passes, and — check this explicitly — every previously-passing spec
   still passes. A change that breaks `agenda-timeline.spec.ts` while
   adding an unrelated feature is exactly the kind of regression this
   loop exists to catch.

6. **Refactor if the implementation is messier than it should be**, with
   the tests as your safety net. Re-run tests after refactoring, before
   moving on.

## Where this applies most directly in this project

- **New state-service methods** (anything on `CheckinStateService`,
  `RoleDefinitionService`, `AgendaStateService`, `AgendaImportExportService`):
  always test-first. These are the files with the most existing spec
  coverage and the clearest existing patterns to follow.
- **`src/app/utils/*.ts`** — pure functions are the cheapest thing in this
  codebase to test-first; there's no `TestBed` ceremony. See
  `agenda-timeline.spec.ts`, which was written against the *current*
  duplicated clock logic before the extraction that created
  `computeAgendaTimeline`, specifically so the extraction was verified
  behavior-preserving rather than assumed to be.
- **`docx.service.ts`** is the deliberate exception — see
  `angular-test-writer`'s notes on why this file is verified by manual
  browser DOCX-export checks instead of unit tests, unless explicitly
  asked to mock `fetch`/`Image` and test it anyway.

## The enforcement backstop

A `PostToolUse` hook (see `.claude/settings.json`) warns when a `.ts` file
lands in `services/` or `utils/` without a sibling `.spec.ts`. That hook
catches the case where this workflow got skipped — it's not a substitute
for following steps 1–6, since a warning after the fact can't un-skip
"red" (you can still write a passing test for code that already exists,
which verifies current behavior but was never test-first, and won't
catch you writing an implementation that happens to satisfy a
loosely-written afterthought test). Treat the hook as a safety net, not
the process itself.
