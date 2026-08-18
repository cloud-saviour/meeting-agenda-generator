---
name: commit-and-pr
description: This project's actual git conventions for committing and opening PRs — branch naming, commit message style, and the PR description format used so far. Use whenever asked to commit changes or open a PR for this repo.
---

## Branching

New work gets its own branch off `main`, named by kind:
`feature/<short-description>` for features (e.g.
`feature/add-normal-user-feature`), `docs/<short-description>` for
documentation-only changes (e.g. `docs/add-claude-md`). Don't commit
directly to `main`.

## Commit messages

One-line imperative summary, blank line, then a body explaining **why**,
not a restatement of the diff. Real examples from this repo's history:

```
Rename meeting signup feature to check-in

Renames the /signup route and its supporting component, service, and
model files to /checkin to match the "Meeting Check-in" wording now
used in the UI (nav link, page heading, localStorage keys). Speaker
signup stays SpeakerSignupComponent since registering to speak is a
distinct action from checking in to the meeting.
```

```
Add CLAUDE.md project context

Documents the stack, directory structure, and the split between the
two independent state services (agenda editor vs check-in page).
Calls out the check-in page's localStorage persistence as a
deliberate stand-in for Firestore — not an oversight — and records
why Firestore was chosen over a custom backend when that swap
happens, plus the DOCX layout constraints and current known gaps.
```

The body should explain what a reader can't get from the diff alone: why
this approach, what alternative was rejected and why, what stays the same
on purpose. Skip the body entirely only for genuinely self-explanatory
changes.

## Before committing

`git status` and `git diff --stat` first — confirm the staged set matches
intent, no stray files. Run `ng build` and `ng test` and confirm both
pass before committing, not after.

## Opening a PR

`gh` (GitHub CLI) is not installed in this environment as of this
writing — check `gh auth status` before assuming otherwise. Without it,
push the branch and hand back the direct compare-and-create link:
```
https://github.com/<org>/<repo>/compare/main...<branch>?expand=1
```
along with a drafted title and description in this format (used
consistently so far in this project):

```markdown
## Summary
- Bullet list of what changed, one line per meaningful change

## Notes
- Anything a reviewer needs but isn't obvious from the diff — deliberate
  scope limits, known follow-up work, naming rationale

## Test plan
- [x] `ng build` succeeds with no new errors
- [x] `ng test` passes (N/N tests)
- [x] Manual browser checks performed (list them specifically — e.g.
      "claimed a role from two simulated identities, confirmed locking")
```

Never fabricate the checked items — only check what was actually run and
verified in this session.

## After merge

If the local branch is now stale relative to `origin/main`, offer to
switch the local checkout to `main` and fast-forward pull, and to clean
up the merged feature branch (local + remote) — but only after confirming
with the user, don't do it unprompted.
