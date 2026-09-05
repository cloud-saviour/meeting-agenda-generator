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
- Firebase Auth (same `firebase` package, emulator-only) gates every
  `/admin*` route behind email/password sign-in — see Authentication below

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
                provideAppFirestore(); auth.provider.ts — AUTH injection
                token + provideAppAuth(), same getOrCreateApp()-shares-one-
                FirebaseApp pattern as firestore.provider.ts. Both read
                src/environments/environment.ts
    auth/       auth.service.ts (AuthService — currentUser/ready signals,
                signIn()/signOut()), auth.guard.ts (authGuard — CanActivateFn
                gating every /admin* route) — see Authentication below
    utils/      locale.ts (APP_LOCALE)

  layout/
    navbar/     NavbarComponent — shared nav bar used by agenda-editor,
                checkin, admin-roles, and every admin hub page (title/links/
                action-buttons via @Input + <ng-content>); injects
                AuthService directly (not via @Input) to conditionally show
                a Sign Out button whenever currentUser() is set — this means
                it can render on /checkin or /preview too, for an admin who
                happens to have those open while signed in. Home has no navbar

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

    admin-agendas/    Route "/admin/agendas" (guarded) — "My Agendas" library:
                      list/open/delete saved agendas, "+ New Agenda"
      pages/           admin-agendas.component.ts

    admin-agendas-hub/  Route "/admin/manage-agendas" (guarded) — Home's
                      "Manage Agendas" tile lands here first: a 2-tile choice
                      between "Agenda Editor" (/admin) and "My Agendas"
                      (/admin/agendas). Mirrors admin-roles-hub below exactly.
      pages/           admin-agendas-hub.component.ts

    admin-roles-hub/  Route "/admin/manage-roles" (guarded) — Home's
                      "Manage Roles" tile lands here first: a 2-tile choice
                      between "Manage Meeting Roles" (/admin/roles) and
                      "Manage Committee Roles" (/admin/committee-roles)
      pages/           admin-roles-hub.component.ts

    checkin/          Route "/checkin" — member-facing check-in page, no
                      auth guard — stays fully anonymous by design, see
                      Authentication below
      pages/           checkin.component.ts
      components/      attendance-list, role-board, speaker-signup,
                        evaluator-slots
      services/        checkin-state.service.ts (CheckinStateService)
      models/          checkin.models.ts

    admin-roles/      Route "/admin/roles" (guarded) — manage role definitions
      pages/           admin-roles.component.ts

    login/            Route "/login", the only route the auth guard doesn't
                      protect — email/password sign-in form. On success,
                      navigates to ?returnUrl= (defaulting to "/") — see
                      Authentication below
      pages/           login.component.ts

    home/             Route "/" — tile picker: "Manage Agendas"
                      (→ admin-agendas-hub), "Meeting Check-in", "Manage
                      Roles" (→ admin-roles-hub). Its "Meeting Check-in" tile
                      is the one non-admin, no-session entry point into
                      check-in, so it can't rely on AgendaStateService
                      (nothing's been loaded yet) — it links to
                      PublishedAgendaService.nearestEntry() instead (nearest
                      upcoming published meeting by date, or the most recent
                      past one if none is upcoming, or a bare `/checkin` —
                      the 'default' bucket — if nothing's ever been
                      published). Every other check-in link in the app
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
Firebase Auth now exists in this app (see Authentication below), but only
for the admin side — check-in is deliberately kept outside that system, so
"who you are" at check-in is still just a random id your browser remembers,
not an account. This is the only thing left that isn't a candidate for
Firestore migration at all — everything else that was localStorage-based in
this app has now migrated.

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

## Authentication — admin-only Firebase Auth

Every `/admin*` route (6 total: `admin`, `admin/agendas`, `admin/manage-agendas`,
`admin/manage-roles`, `admin/roles`, `admin/committee-roles`) is gated by
`authGuard` (`core/auth/auth.guard.ts`) in `app.routes.ts`. `/checkin` and
`/preview` are deliberately **not** guarded — check-in stays exactly as it
always has been: anonymous, name-based, no account, first-come-first-served
claims (`CheckinStateService`'s local/spoofable `uid` is completely
untouched by this feature). This is a permanent split, not a stepping stone
toward member accounts — see Known gaps below for that separate, later item.

**Admin model: any signed-in Firebase user is an admin.** There is no public
sign-up page anywhere in the app — accounts are provisioned manually, via
`npm run seed:admin` (`scripts/seed-admin-user.mjs`, idempotent, same
convention as `seed-role-definitions.mjs`) against the local emulator, or via
the Firebase Console once a real project exists. Since nobody can
self-register, "authenticated" and "admin" are equivalent at this club's
scale — `firestore.rules`' `isAdmin()` helper is just `request.auth != null`.
If the admin set ever needs finer-grained roles, that helper is the one
place to change, to a lookup against an `admins/{uid}` allowlist collection
instead.

**`AuthService`** (`core/auth/auth.service.ts`) exposes `currentUser`
(a `User | null` signal, via `onAuthStateChanged` wrapped in `NgZone.run()`,
same pattern as every Firestore listener in this app) and `ready` (`false`
until that listener's first callback fires). `ready` matters because
`onAuthStateChanged` is async — on a cold page load, `currentUser()` briefly
reads `null` even for an already-signed-in admin while Firebase restores the
cached session. **`authGuard` waits for `ready()` before deciding** —
without this, a hard refresh on any admin page would flash-redirect a
signed-in admin to `/login` before the session resolved.

**Firestore rules are now per-collection, not a single blanket `allow read,
write: if true`** (`firestore.rules`):
- `checkins/**` — untouched, fully open (see above).
- `roleDefinitions`, `committeeRoleDefinitions`, `committeeRoster`,
  `publishedAgendas` — **public read, admin-only write**. All four are
  public-read for a non-obvious reason worth remembering before tightening
  any of them further: every migrated Firestore-backed service subscribes
  via `onSnapshot()` **eagerly in its constructor**, so a collection is
  exposed to whoever the *service* is transitively injected by, not just
  whoever the *page* visibly renders. `AgendaPreviewComponent` (used on the
  public `/preview`) injects `AgendaStateService`, which itself injects
  `CommitteeRosterService` — so `/preview` fires a live `committeeRoster`
  read on load even though nothing in `/preview`'s own template displays
  roster data directly. `RoleDefinitionService` is the same story via
  `RoleBoardComponent` on `/checkin`. Making any of these four admin-only
  would break the corresponding public page with a silent permission-denied,
  not a build error — trace real injection chains before ever tightening a
  rule here, don't assume from what a page's template shows.
- `savedAgendas` — **admin-only for both read and write**. Confirmed safe
  because `SavedAgendaService` is only ever injected by `AgendaEditorComponent`
  and `AdminAgendasComponent`, both already behind the guard — nothing on
  `/preview` or `/checkin` transitively touches it.

**Test impact**: the 5 `*.emulator.spec.ts` files for the
public-read-admin-write and admin-only collections
(`role-definition`, `committee-role-definition`, `committee-roster`,
`published-agenda`, `saved-agenda`) each embed their own `FIRESTORE_RULES`
string (they don't load the real `firestore.rules` file — the unit-test
builder bundles for the browser, so `node:fs` can't read it at runtime) —
these were updated to the real per-collection rule and switched from
`testEnv.unauthenticatedContext()` to `testEnv.authenticatedContext('test-admin-uid')`
for their write-path assertions. `checkin-state.service.emulator.spec.ts` is
untouched, since `checkins` rules didn't change.

**Emulator-only, same as Firestore** — `firebase.json` now also configures
an `auth` emulator (port 9099, alongside Firestore's 8080), and both
`environment.ts`/`environment.production.ts` carry matching
`useAuthEmulator`/`authEmulatorHost`/`authEmulatorPort` fields plus a real
gotcha worth knowing: **Firebase Auth's SDK requires an `apiKey` to be
present in the app config even against the emulator** (Firestore's SDK has
no such check, which is why this wasn't caught until Auth was added) —
`environment.firebase.apiKey` is a clearly-commented placeholder string,
never sent anywhere real, since `connectAuthEmulator()` redirects all Auth
traffic locally regardless of its value.

**Production bundle budget was raised** (`angular.json`, initial budget
500kB→600kB warning, 1MB→1.2MB error) — the Auth SDK adds real weight to the
eagerly-loaded bundle (`provideAppAuth()` lives in `app.config.ts`, which
`bootstrapApplication` always loads eagerly, unlike the lazy-loaded route
components). This is a legitimate cost of the feature, not a regression to
route around.

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
   currently emulator-only (see Persistence and Authentication above); this
   needs `firebase login` and project creation. Security rules are already
   scoped per-collection with real admin-write enforcement (see
   Authentication above) — what's still missing is just a real project to
   point them at, and manually creating real admin accounts via the Firebase
   Console (the local `seed:admin` script only works against the emulator).
2. Multi-tenant support — multiple clubs, real **member-facing** accounts
   (today's Firebase Auth is admin-only — see Authentication above; check-in
   is still anonymous by design, not just not-yet-migrated), admin-managed
   yearly subscriptions (manually flagged for now, modeled to slot in real
   payments later without a schema rewrite)
3. Admin console for the check-in page: reset a role, cap speaker slots,
   lock the sheet once the meeting starts (role-locking now exists per-role
   via the editor's override toggle — see above — but there's no bulk
   "lock everything" or "reset this role" control yet)

## Local dev

Two processes, both from the repo root:

```bash
npm install
npm run emulators   # terminal 1 — Firestore (127.0.0.1:8080) + Auth (127.0.0.1:9099) emulators, UI at :4000
npm start           # terminal 2 — ng serve on :4300
```

First time only (or after wiping `.emulator-data/`): `npm run seed:roles`
to populate the standard meeting/committee role lists (see Persistence
above), and `npm run seed:admin` to create a local admin account
(`admin@example.com` / `password123`, see Authentication above) so you can
actually reach any `/admin*` route. `npm start` already points at the
emulator by default (no flags needed), since `environment.ts` is what plain
`ng serve` uses.

Routes: `http://localhost:4300/` (home tile picker),
`http://localhost:4300/login` (admin sign-in — every route below except
`/checkin` and `/preview` redirects here first if you're not signed in),
`http://localhost:4300/admin` (agenda editor),
`http://localhost:4300/admin/agendas` (My Agendas — list/open/delete saved agendas),
`http://localhost:4300/admin/manage-agendas` (hub: Agenda Editor / My Agendas),
`http://localhost:4300/checkin` (check-in page, no sign-in needed),
`http://localhost:4300/preview` (read-only published-agenda view, no sign-in needed), and
`http://localhost:4300/admin/roles` / `/admin/committee-roles` / `/admin/manage-roles`
(manage role definitions).
