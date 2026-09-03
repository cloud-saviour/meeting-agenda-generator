# Agora Agenda Generator

An Angular app for a public speaking club (originally "King's Speakers" Club #12,
an Agora Speakers club) to build meeting agendas, export them as pixel-matched
Word documents, and let members check in / claim roles / sign up to speak
before a meeting.

See [`docs/architecture/2. angular-migration-plan.html`](docs/architecture/2.%20angular-migration-plan.html)
for the full migration status record (phase-by-phase build history, what was
planned vs. what actually got built, component tree) — open it directly in a
browser, it's a formatted page, not plain markdown.

## Stack

- Angular 20, standalone components, signals for state (no NgRx)
- Bootstrap 5 (`bootstrap` + `@ng-bootstrap/ng-bootstrap`) for styling —
  see `src/styles.css` for the brand-color theme-variable overrides
- `docx` npm package for Word export, `file-saver` for downloads
- `@angular/cdk` drag-drop for agenda item reordering
- Firestore (via the `firebase` npm package, modular SDK) for check-in,
  role-definition, published-agenda, committee-roster, and saved-agenda
  state; `localStorage` for everything else — see Persistence below for
  exactly which services use which and why

## Structure

`src/app/` is organized **by feature**, not by artifact type. Each feature
folder mirrors a `pages/components/services/models/utils` shape; `core/`
holds everything 2+ features depend on; `layout/` holds shared app-shell
chrome.

```
src/app/
  core/
    services/   storage.service.ts, role-definition.service.ts (Firestore-
                backed — see Persistence below) (+ specs)
    models/     role-definition.models.ts
    firebase/   firestore.provider.ts — FIRESTORE injection token +
                provideAppFirestore(), reads src/environments/environment.ts
    utils/      locale.ts (APP_LOCALE)

  layout/
    navbar/     NavbarComponent — shared nav bar used by agenda-editor,
                checkin, and admin-roles (title/links/action-buttons via
                @Input + <ng-content>); home has no navbar

  features/
    agenda-editor/    Route "/admin" — the agenda-building tool
      pages/           agenda-editor.component.ts
      components/      meeting-form, agenda-items, speakers-form,
                        committee-form, agenda-preview
      services/        agenda-state.service.ts (AgendaStateService),
                        agenda-import-export.service.ts, docx.service.ts
                        (DocxService — all DOCX generation logic),
                        saved-agenda.service.ts (SavedAgendaService — the
                        agenda library, Firestore-backed, see below),
                        default-agenda.ts, published-agenda.service.ts
                        (PublishedAgendaService — also Firestore-backed),
                        committee-roster.service.ts (CommitteeRosterService —
                        also Firestore-backed), committee-role-definition.service.ts
      models/          agenda.models.ts
      utils/           agenda-timeline.ts

    admin-agendas/    Route "/admin/agendas" — "My Agendas" library:
                      list/open/delete saved agendas, "+ New Agenda"
      pages/           admin-agendas.component.ts

    checkin/          Route "/checkin" — member-facing check-in page
      pages/           checkin.component.ts
      components/      attendance-list, role-board, speaker-signup,
                        evaluator-slots
      services/        checkin-state.service.ts (CheckinStateService)
      models/          checkin.models.ts

    admin-roles/      Route "/admin/roles" — manage role definitions
      pages/           admin-roles.component.ts

    home/             Route "/" — tile picker linking to the 3 pages above.
                      Its "Meeting Check-in" tile is the one non-admin,
                      no-session entry point into check-in, so it can't rely
                      on AgendaStateService (nothing's been loaded yet) — it
                      links to PublishedAgendaService.nearestEntry() instead
                      (nearest upcoming published meeting by date, or the
                      most recent past one if none is upcoming, or a bare
                      `/checkin` — the 'default' bucket — if nothing's ever
                      been published). Every other check-in link in the app
                      (editor navbar, admin-roles/-hub/-agendas navbars) DOES
                      have an admin session, so those pass
                      `queryParams: { meeting: state.meeting().no } }`
                      instead — `CheckinComponent`/`AgendaViewerComponent`
                      resolve an empty-but-present `?meeting=` (e.g. before
                      any meeting number is set) to `'default'` via `||`,
                      not `??`, precisely so a blank session number degrades
                      safely instead of resolving to a broken `''` id.
      pages/           home.component.ts
```

## Two independent features, two independent state services

**Agenda editor** (`/admin`) — single-user authoring tool. Build an agenda, preview
it as a live A4 page, export to DOCX or print. Live state is `AgendaStateService`
(in memory), but every edit is **auto-saved** to a per-meeting-number library —
`SavedAgendaService` (`agenda-editor/services/saved-agenda.service.ts`,
Firestore-backed) persists a full `AgendaSnapshot` (via the existing
`AgendaImportExportService.getSnapshot()`, the same serialization
Export/Import JSON already uses) to one document per meeting number at
`savedAgendas/{meetingId}`. No hand-maintained index needed for the
"📋 My Agendas" list at `/admin/agendas`
(`admin-agendas/pages/admin-agendas.component.ts`) — unlike the old
`localStorage` version (`StorageService` has no key-enumeration API, which
is why that index existed at all), `entries()` is derived live from
`onSnapshot()` on the whole collection, same as `PublishedAgendaService`/
`RoleDefinitionService`. Auto-save is driven by an untracked-free `effect()`
in `AgendaEditorComponent`'s constructor that calls `getSnapshot()`
directly — since that reads every relevant signal, the effect naturally
re-runs on any edit anywhere in the agenda, with no manual dependency list
— but is now **debounced** (500ms), since a Firestore write per keystroke
is a real network call, not the free in-memory write it used to be. A blank
meeting number is never saved (`SavedAgendaService.save()` no-ops), which
is also why "🆕 New Agenda" (`AgendaStateService.resetAll()`) blanks
`meeting.no` rather than reusing a default — it keeps a fresh agenda
un-addressable, and safe from colliding with another saved meeting, until
the admin types a real number into the existing Meeting Details field.
"New"/"Open" never need an unsaved-changes warning, since whatever was open
is already persisted under its own meeting number the moment it had one.
`SavedAgendaService.load(no)` is a one-time `getDoc()`, not a live
subscription — `AdminAgendasComponent.open()` is `async` and `await`s it —
opening a draft hydrates the editor once, it doesn't keep watching
Firestore afterward (the live-editing session is `AgendaStateService`'s own
in-memory state from then on, same as ever). See Persistence below for why
this migrated despite being a genuinely single-admin workload.

**Check-in page** (`/checkin`) — meant to be a *shared* sheet multiple members
check simultaneously before a meeting: check in, claim one of 6 standard roles
(Toastmaster, General Evaluator, Grammarian, Timer, Ah-Counter, Evaluation
Chairman), sign up to speak, claim an evaluator slot for someone else's speech.
Role/evaluator claims are first-come-first-served — `CheckinStateService`
enforces "only the current claimant can release their own claim" and blocks
self-evaluation.

These two pages are now linked both ways, via the agenda's own meeting
number. Editor → check-in: a "🔗 Share Check-in Link" button copies
`/checkin?meeting=<no>` to the clipboard — check-in data is isolated per
meeting number (`CheckinStateService.loadMeeting()`, keyed by `?meeting=`),
so different meetings don't share a sheet. A separate, always-on `effect()`
in `AgendaEditorComponent` also pushes the agenda's `date`/`theme`/`word`/`st`
into `CheckinStateService.updateMeeting()` on any change (guarded on a
non-blank meeting number, same as auto-save below) — `CheckinMeeting` is its
own independent record (id/date/theme/word/start/maxSpeakers), not a
reference to the agenda, so without this push the header members see at
`/checkin` would just show `CheckinMeeting`'s own untouched defaults
regardless of what the admin set. One-way only — check-in's `maxSpeakers`
and nothing else agenda-side ever reads from `CheckinMeeting` back.

Check-in → editor is automatic, not a button: `AgendaEditorComponent`
calls `checkinState.loadMeeting(no)` (a) on load and whenever the meeting
number field changes (an `effect()` over a `computed(() => state.meeting().no)`,
so it only fires on an actual number change, not on every unrelated
meeting-details edit), which subscribes to that meeting's `checkins/{no}`
Firestore document. A separate `effect()` depends on
`checkinState.roles()`/`checkinState.speakers()` directly and re-applies
the snapshot every time either changes — which happens on that initial
load AND every time Firestore's live listener delivers a claim/signup made
from **any device**, not just another tab of the same browser. Applying a
snapshot overwrites the `person` field on every agenda row/dual-sub-item
whose `roleId` has a current check-in claim (via
`AgendaStateService.applyRolePerson()`, reusing the same role/person
group-sync mechanism agenda items already use internally), leaving a
role's existing value untouched if check-in has no claim for it yet, and
imports any check-in speaker signup not already present in the Prepared
Speakers list by name. The admin can mark any role as **overridden** (a
checkbox in the Agenda Items edit panel, per role) to take it over
entirely: an overridden role is skipped by future syncs and disappears
from the check-in role board (`CheckinStateService.lockedRoles`/
`setRoleLocked()` — enforced in `claimRole()`/`releaseRole()`, not just the
UI), so members can no longer claim or release it. `AgendaStateService.overriddenRoles`
round-trips through Export/Import JSON (`AgendaSnapshot.overriddenRoles`).

**This sync is genuinely cross-device now** — a member checking in on their
own phone reaches the admin's laptop live, no reload needed, because both
sides are Firestore `onSnapshot()` listeners on the same document rather
than a browser-local `storage` event. See Persistence below for the data
model and what's still emulator-only.

## Persistence — Firestore for shared/live state, localStorage for the rest

**Firestore-backed (emulator-only — no real Firebase project exists yet):**

- `CheckinStateService` — one document per meeting at `checkins/{meetingId}`,
  holding the full `CheckinSnapshot` (meeting/attendees/roles/speakers/lockedRoles)
  as nested fields. `loadMeeting(id)` subscribes via `onSnapshot()`
  (idempotent — calling it again with the same id is a cheap no-op, since
  `AgendaEditorComponent`'s meeting-sync effect calls it on every
  meeting-details edit, not just when the number changes). Every mutator
  (`checkIn()`, `claimRole()`, `releaseRole()`, `addSpeakerSignup()`,
  `claimEvaluatorSlot()`, `releaseEvaluatorSlot()`, `updateMeeting()`,
  `setRoleLocked()`, `resetAll()`) runs inside `runTransaction()` via a
  shared private `mutate()` helper — read-decide-write in one atomic
  round-trip, so two people claiming the same role at the same instant
  can't both win. This is why `claimRole()`/`addSpeakerSignup()`/
  `claimEvaluatorSlot()` return `Promise<boolean>` now instead of a
  synchronous `boolean` — the 3 call sites that use the result
  (`role-board`/`speaker-signup`/`evaluator-slots` components) `await` it.
  A role id absent from the `roles` map means the same thing as one present
  with an empty claim everywhere it's read — the service doesn't need to
  know the full set of role definitions, so it has **no dependency on
  `RoleDefinitionService`**.
- `RoleDefinitionService` (meeting roles) and `CommitteeRoleDefinitionService`
  (committee/governance titles) — one Firestore document per role, at
  `roleDefinitions/{roleId}` and `committeeRoleDefinitions/{roleId}`
  respectively, kept live via `onSnapshot()` on the whole collection.
  **No hardcoded fallback list exists in either service anymore** — a fresh
  environment (or a wiped emulator) needs `npm run seed:roles`
  (`scripts/seed-role-definitions.mjs`) to populate this club's standard
  8 meeting roles / 7 committee roles before either admin page or the
  check-in role board shows anything. The script is idempotent — it skips
  any collection that already has documents, so re-running it never
  clobbers roles you've since edited or archived via the admin UI. Role ids
  (`toastmaster`, `president`, etc.) are used as literal Firestore document
  IDs, not auto-generated — `default-agenda.ts`, `docx.service.ts`, and
  `agenda-preview.component.ts` all reference these exact strings as stable
  keys, so they must never change.
- `PublishedAgendaService` — one document per meeting at
  `publishedAgendas/{meetingId}`, holding the full published `AgendaSnapshot`
  plus `publishedAt`. Migrated specifically because — unlike `SavedAgendaService`,
  a genuinely single-admin workload — this service's entire purpose is being
  read on a *different device* than the one that published it (`/preview`,
  reached from check-in's
  "Preview Agenda" link) — on `localStorage` that literally couldn't work
  cross-device, the same gap check-in had before its own migration. No
  separate index collection needed the way the old `localStorage` version
  needed a hand-rolled one (`agora-agenda-published-index`) — Firestore's
  `onSnapshot()` on the whole collection *is* "enumerate the keys," for
  free, which is exactly what `entries()`/`nearestEntry()` are built on.
  `AgendaViewerComponent` reflects this reactively (an `effect()` over
  `current()`, not a one-time synchronous read), so it also updates live if
  the admin re-publishes while someone's viewing — its "🔄 Refresh" button
  is now just a reassurance affordance, not a real refetch.
- `CommitteeRosterService` — a **single** document at `committeeRoster/current`
  holding the whole roster array, not one-per-role like `RoleDefinitionService`.
  This is deliberate: `roleId` isn't a unique key on a committee slot (several
  slots legitimately share the same blank `roleId` until assigned — see
  `AgendaStateService.updateCommitteeMember`'s own comment on addressing by
  array position, not `roleId`), and `replaceAll()` already treated the whole
  roster as one atomic unit before the migration, so one document matches
  the existing access pattern exactly. Also normalizes any stored roster
  shorter than 7 slots back up to 7 on every load, padding with blanks —
  needed because the app itself never removes a slot, but the Firestore
  document can still end up short some other way (an admin manually deleting
  one array element via the Emulator UI, which happened in practice —
  without this, that slot and the ability to re-enter anyone into it would
  be gone for good).
- `SavedAgendaService` — one document per meeting at `savedAgendas/{meetingId}`,
  the "My Agendas" draft library. Migrated for cross-device admin convenience
  (start on your laptop, finish on your phone), not to fix a correctness bug
  the way check-in/published-agenda were — this is a genuinely single-admin
  workload, migrated anyway once the pattern was well-established. `load()`
  is a one-time `getDoc()`, not a live subscription (see the Agenda editor
  section above); the auto-save effect that calls `save()` is debounced for
  the same reason as check-in's meeting-fields push.

**Still `localStorage` (deliberately, not a migration backlog item):**
`StorageService`'s one remaining direct consumer — `CheckinStateService`'s
own per-browser identity (`agora-checkin-uid`/`agora-checkin-name`,
unrelated to the Firestore-backed meeting data it now writes) — stays on
`localStorage`. This is deliberately *not* meant to sync across devices:
there's no Firebase Auth in this app, so "who you are" is still just a
random id your browser remembers, not an account. This is the only thing
left that isn't a candidate for Firestore migration at all — everything
else that was localStorage-based in this app has now migrated.

**A real gotcha hit migrating `CommitteeRosterService`, worth knowing before
migrating anything else that follows this same shape:** `AgendaStateService`
copies `committeeRoster.all()` into its own `cmt`/`agItems`/`meeting.vpe`
*once*, synchronously, at construction — but Firestore data always arrives
asynchronously, even on the very first read. A naive "seed once when real
data arrives" `effect()` guard is not enough, because the pre-load
placeholder value (`all()`'s default before Firestore delivers anything) is
itself a defined, normal-looking array — indistinguishable by content from
"Firestore confirmed there's genuinely nothing here." The effect's *own*
first invocation runs against that placeholder before Firestore's listener
has delivered anything, consumes it, sets the guard, and permanently locks
out the real data that arrives moments later. This was caught by hard-reloading
in the browser and inspecting live component state (`ng.getComponent(el)`)
— not by the test suite, which passed throughout with a synchronous fake
that never exercised the timing gap at all. The fix:
`CommitteeRosterService` exposes a separate `ready` signal, set `true` only
inside the `onSnapshot()` callback, and the consuming effect gates on
`ready()`, not on `all()` changing. Any future one-time-copy-at-construction
consumer of a Firestore-backed signal needs the same `ready()` pattern —
don't assume "the signal changed" means "real data arrived."

**Why emulator-only, not a real project:** no `firebase login`, no real
Firebase/GCP project, no billing — `.firebaserc` uses project id
`meeting-agenda-generator` purely as a label the local emulator answers to.
`src/environments/environment.ts` and `environment.production.ts` currently
hold **identical** values (same project id, `useFirestoreEmulator: true`,
`127.0.0.1:8080`) — wired via `angular.json`'s `production` build
configuration `fileReplacements`, so when a real project eventually exists,
only `environment.production.ts`'s values need to change, no code changes.
`src/app/core/firebase/firestore.provider.ts`'s `provideAppFirestore()`
reads `environment.useFirestoreEmulator` to decide whether to call
`connectFirestoreEmulator()` — the environments split is the source of
truth, not `isDevMode()`.

**Emulator data persists across restarts**: `npm run emulators` passes
`--import=./.emulator-data --export-on-exit=./.emulator-data`, so stopping
and restarting the emulator doesn't lose your seeded roles or check-in
data. `.emulator-data/` is gitignored — it's local dev state, not something
to commit.

**Testing the Firestore-backed services**: per the role-locking-pattern and
localStorage-to-firestore-migration skills, a hand-rolled mock can't
faithfully reproduce Firestore's optimistic-concurrency retry behavior, so
transactional logic is tested against the real Local Emulator Suite, never
a mock. Each of the six Firestore-backed services (`CheckinStateService`,
`RoleDefinitionService`, `CommitteeRoleDefinitionService`,
`PublishedAgendaService`, `CommitteeRosterService`, `SavedAgendaService`) has a
`*.emulator.spec.ts` sibling (using `@firebase/rules-unit-testing`'s
`initializeTestEnvironment()`, each with its own project id distinct from
the dev project so running tests never wipes data you're interactively
poking at) — run via `npm run test:emulator` with the emulator already
running. These are excluded from the default `npm test`/`ng test` run
(`angular.json`'s `test` target `exclude`s `**/*.emulator.spec.ts`, and is
pinned to the `development` build configuration specifically so it can
never accidentally pick up real production Firestore credentials once
`environment.production.ts` has them). Their plain `*.spec.ts` files only
cover what never touches Firestore — e.g. `CheckinStateService`'s
`loadOrCreateUid()` localStorage persistence — and, for services now
consumed by `AgendaStateService` (`RoleDefinitionService`,
`CommitteeRosterService`), `agenda-state.service.spec.ts` and
`agenda-import-export.service.spec.ts` provide plain synchronous fakes
rather than the real Firestore-backed service, since neither suite is
testing Firestore behavior itself.

## Naming

The check-in feature is named "check-in" everywhere — route (`/checkin`),
page heading, component/service class names, `localStorage` key prefix — not
"signup," to avoid implying payment/registration. The one intentional
exception is `SpeakerSignupComponent`: registering to give a speech is a
distinct action from checking in to the meeting, so "sign up to speak" reads
correctly there.

## DOCX export

`DocxService` is a direct, careful port of hand-tuned OOXML table-layout logic
(fixed DXA column widths, validated with `assertWidths()` to sum exactly to
page content width). If you touch this file: **do not "fix" a layout bug by
changing font sizes or adding manual line breaks** — the widths must be
mathematically consistent (table width === sum of column widths, on every
nested table), or Word's layout engine breaks in ways that are very hard to
debug from the rendered output alone.

## Known gaps / next planned work

1. Stand up a real Firebase project when ready to actually deploy —
   currently emulator-only (see Persistence above); this needs `firebase
   login`, project creation, and real (non-`allow if true`) security rules,
   since there's no Auth yet to scope writes to a specific user.
2. Multi-tenant support — multiple clubs, real user accounts (Firebase Auth),
   admin-managed yearly subscriptions (manually flagged for now, modeled to
   slot in real payments later without a schema rewrite)
3. Admin console for the check-in page: reset a role, cap speaker slots,
   lock the sheet once the meeting starts (role-locking now exists per-role
   via the editor's override toggle — see above — but there's no bulk
   "lock everything" or "reset this role" control yet)

## Local dev

Two processes, both from the repo root:

```bash
npm install
npm run emulators   # terminal 1 — Firestore emulator (127.0.0.1:8080), UI at :4000
npm start           # terminal 2 — ng serve on :4300
```

First time only (or after wiping `.emulator-data/`): `npm run seed:roles`
to populate the standard meeting/committee role lists — see Persistence
above. `npm start` already points at the emulator by default (no flags
needed), since `environment.ts` is what plain `ng serve` uses.

Routes: `http://localhost:4300/` (home tile picker),
`http://localhost:4300/admin` (agenda editor),
`http://localhost:4300/admin/agendas` (My Agendas — list/open/delete saved agendas),
`http://localhost:4300/checkin` (check-in page),
`http://localhost:4300/preview` (read-only published-agenda view), and
`http://localhost:4300/admin/roles` / `/admin/committee-roles` / `/admin/manage-roles`
(manage role definitions).
