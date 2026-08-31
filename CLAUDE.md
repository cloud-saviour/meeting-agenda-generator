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
- No backend yet — all state is client-side (see Persistence below)

## Structure

`src/app/` is organized **by feature**, not by artifact type. Each feature
folder mirrors a `pages/components/services/models/utils` shape; `core/`
holds everything 2+ features depend on; `layout/` holds shared app-shell
chrome.

```
src/app/
  core/
    services/   storage.service.ts, role-definition.service.ts (+ specs)
    models/     role-definition.models.ts
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
                        agenda library, see below), default-agenda.ts
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
`SavedAgendaService` (`agenda-editor/services/saved-agenda.service.ts`)
persists a full `AgendaSnapshot` (via the existing `AgendaImportExportService.getSnapshot()`,
the same serialization Export/Import JSON already uses) to `localStorage`
under `agora-agenda-draft-<no>`, plus a small hand-maintained index
(`agora-agenda-index`) for the "📋 My Agendas" list at `/admin/agendas`
(`admin-agendas/pages/admin-agendas.component.ts`) — `StorageService` has no
key-enumeration API, so the index exists specifically to avoid needing one,
the same way a future Firestore collection would be listed via a query
instead. Auto-save is driven by an untracked-free `effect()` in
`AgendaEditorComponent`'s constructor that calls `getSnapshot()` directly —
since that reads every relevant signal, the effect naturally re-runs on any
edit anywhere in the agenda, with no manual dependency list and no debounce.
A blank meeting number is never saved (`SavedAgendaService.save()` no-ops),
which is also why "🆕 New Agenda" (`AgendaStateService.resetAll()`) blanks
`meeting.no` rather than reusing a default — it keeps a fresh agenda
un-addressable, and safe from colliding with another saved meeting, until
the admin types a real number into the existing Meeting Details field.
"New"/"Open" never need an unsaved-changes warning, since whatever was open
is already persisted under its own meeting number the moment it had one.
This was a deliberate choice, not a Firestore-first one — see Persistence
below for why this stayed on `localStorage`.

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
applies the current check-in snapshot for the agenda's meeting number (a)
on load and whenever the meeting number field changes (an `effect()` over
a `computed(() => state.meeting().no)`, so it only fires on an actual
number change, not on every unrelated meeting-details edit), and (b) live,
whenever another tab of the *same browser* writes to that meeting's
check-in `localStorage` key — via a `window.addEventListener('storage', ...)`
listener (native `storage` events only fire in *other* tabs than the one
that wrote, which is exactly what's needed here; matched against the key
using the exported `checkinStorageKey()` helper from
`checkin-state.service.ts`). Applying a snapshot (a) overwrites the
`person` field on every agenda row/dual-sub-item whose `roleId` has a
current check-in claim (via `AgendaStateService.applyRolePerson()`,
reusing the same role/person group-sync mechanism agenda items already use
internally), leaving a role's existing value untouched if check-in has no
claim for it yet, and (b) imports any check-in speaker signup not already
present in the Prepared Speakers list by name. The admin can mark any role
as **overridden** (a checkbox in the Agenda Items edit panel, per role) to
take it over entirely: an overridden role is skipped by future syncs and
disappears from the check-in role board (`CheckinStateService.lockedRoles`/
`setRoleLocked()` — enforced in `claimRole()`/`releaseRole()`, not just the
UI), so members can no longer claim or release it. `AgendaStateService.overriddenRoles`
round-trips through Export/Import JSON (`AgendaSnapshot.overriddenRoles`).

**This "live" sync is same-browser-only** — there is still no cross-device
push (a member checking in on their own phone won't reach the admin's
laptop until that admin's `/admin` tab is reloaded/revisited) — see
Persistence below on why, and on the planned Firestore swap that would
make it genuinely cross-device.

## Persistence — deliberately localStorage, not Firebase (for now)

`CheckinStateService` persists to `localStorage` under `agora-checkin-*` keys.
This was a **deliberate stand-in**, not step one of a Firebase rollout — it let
the check-in feature (role-locking logic, speaker cap, self-eval blocking) get
built and verified without needing a Firebase project, credentials, or network
access.

**The real limitation this creates:** state is per-browser. Two people on two
devices each see their own independent copy of the check-in sheet — there is
no live sync between them. This is fine for local development and demoing the
UI/logic, but the check-in page's entire purpose (a shared sheet people check
in real time before a meeting) doesn't actually work across devices yet.

**The planned fix** is Firestore, chosen over a custom MongoDB/Spring Boot/
Render/Auth0 stack specifically because:
- `runTransaction()` gives atomic check-and-set for role claims for free —
  no hand-rolled locking logic needed
- `onSnapshot()` / `docData()` gives live cross-device sync for free — no
  WebSocket server to build
- No server to deploy or keep warm (Render's free tier cold-starts after
  15 min idle, which is a bad fit for "everyone opens the link 10 minutes
  before the meeting")

**Why the agenda library (`SavedAgendaService`) stayed on `localStorage`
too**, even though it was added after Firestore was already the documented
plan: its rationale above is specific to `CheckinStateService`'s
*concurrent, multi-device* editing problem — atomic claim-and-set,
live cross-device sync. Saving/listing/reopening agendas is a single-admin,
one-browser-at-a-time workload, the same shape `AgendaStateService` already
has — it doesn't have that problem, so it didn't need to be the reason to
stand up Firebase project/emulator/Auth infrastructure that doesn't exist
in this repo yet. Its public API (`save()`/`load()`/`delete()`/`entries()`)
is still shaped the same deliberate way, so it can swap internals to a
Firestore collection later without changing callers, exactly like
`CheckinStateService` is meant to.

When implementing that swap: `CheckinStateService`'s public method signatures
(`checkIn()`, `claimRole()`, `releaseRole()`, `addSpeakerSignup()`,
`claimEvaluatorSlot()`, etc.) should stay the same — only the bodies change
from `localStorage` reads/writes to Firestore SDK calls. No component should
need to change. Testing the swapped-in transaction logic requires either the
Firebase Local Emulator Suite (`firebase emulators:start`, fully offline after
one-time `firebase init`) or a real project — a hand-rolled mock can't
faithfully reproduce Firestore's optimistic-concurrency retry behavior, so
don't try to unit-test the locking logic without one of those two.

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

1. Swap `CheckinStateService` from localStorage to Firestore (see above)
2. Multi-tenant support — multiple clubs, real user accounts (Firebase Auth),
   admin-managed yearly subscriptions (manually flagged for now, modeled to
   slot in real payments later without a schema rewrite)
3. Admin console for the check-in page: reset a role, cap speaker slots,
   lock the sheet once the meeting starts (role-locking now exists per-role
   via the editor's override toggle — see above — but there's no bulk
   "lock everything" or "reset this role" control yet)

## Local dev

```bash
npm install
ng serve --port 4300
```

Routes: `http://localhost:4300/` (home tile picker),
`http://localhost:4300/admin` (agenda editor),
`http://localhost:4300/admin/agendas` (My Agendas — list/open/delete saved agendas),
`http://localhost:4300/checkin` (check-in page),
`http://localhost:4300/preview` (read-only published-agenda view), and
`http://localhost:4300/admin/roles` / `/admin/committee-roles` / `/admin/manage-roles`
(manage role definitions).
