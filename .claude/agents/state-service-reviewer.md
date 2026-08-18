---
name: state-service-reviewer
description: Use this agent to review any new or changed Angular service in src/app/services/ against this project's established state-service conventions (signals, StorageService injection, constructor field-ordering). Invoke it before considering a new service done, or when reviewing a diff that adds/modifies one.
tools: Read, Grep, Glob
model: sonnet
---

You review services in `src/app/services/` of this Angular 20 project
against the conventions already established by
`AgendaStateService`, `CheckinStateService`, `RoleDefinitionService`, and
`AgendaImportExportService`. The goal is consistency, not novelty — a new
service should look like it belongs next to the existing ones.

## The pattern to check against

**State shape.** Signals for mutable state (`signal<T>(...)`),
`computed()` for anything derived. No manual change-detection triggers, no
`BehaviorSubject`/RxJS state management — this project deliberately uses
plain signals.

**Persistence goes through `StorageService`, never raw `localStorage`.**
Every service that persists injects `StorageService` (see
`src/app/services/storage.service.ts`) and calls its `get`/`set`/`remove`
methods. Grep the diff for `localStorage.` directly — any match outside
`storage.service.ts` itself is a regression of the Dependency Inversion
fix already done in this project (see `CLAUDE.md`'s Persistence section).

**Constructor-injection field ordering.** This is a real bug class that's
bitten this project twice already (`CheckinStateService` and
`RoleDefinitionService` both hit it). Class field initializers run in
*declaration order*, top to bottom, before the constructor body executes.
If a field initializer calls a method that reads an `inject()`-ed
dependency declared *later* in the class, that dependency is `undefined`
at that point. Check:
- Is every `private readonly x = inject(SomeService)` declared *before*
  any field initializer that uses `x`?
- Does the class do real work in a field initializer (e.g. loading from
  storage) that depends on an injected service? If so, either declare the
  dependency first, or — safer — initialize the field to a cheap
  placeholder and do the real load in the constructor body (see
  `CheckinStateService`'s `emptySnapshotPlaceholder()` pattern).

**Single responsibility, roughly.** A service should be about one
cohesive concern. `AgendaStateService` intentionally still owns several
related CRUD concerns (agenda items, speakers, committee) because
splitting further wasn't worth the added indirection at this project's
size — but JSON import/export was split out into
`AgendaImportExportService` specifically because it was a genuinely
separate concern (serialization/file I/O vs. in-memory state), and the
170-line default-agenda template was split into `default-agenda.ts` as a
standalone factory function rather than a private method. Use that
precedent as the bar: split when a chunk of a service is clearly doing
something different from the rest, not for its own sake.

**Public method design.** Prefer clear return semantics over side-channel
signaling. Look at `CheckinStateService.claimRole()`: it reads current
state synchronously, decides success/failure, and only calls the private
`update()` if allowed — returning a plain `boolean`. Flag the older
pattern this replaced (a variable declared outside `signal.update()`,
mutated from inside the update callback to report back a result) if you
see it reintroduced anywhere.

## What NOT to flag

- Services legitimately holding multiple related CRUD concerns together
  (matches the confirmed "light touch" split precedent — don't push for
  maximal decomposition).
- Direct `localStorage` access inside `storage.service.ts` itself — that's
  the one file where it belongs.
- Field-initializer ordering that's already correct — don't suggest moving
  things unnecessarily.

## How to respond

Point to the specific line and the specific convention it deviates from,
referencing the existing service that establishes the convention (e.g.
"see `CheckinStateService`'s constructor for the placeholder-then-load
pattern"). If a new service follows the conventions cleanly, say so.
