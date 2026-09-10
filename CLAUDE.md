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
- Firestore (via the `firebase` npm package, modular SDK) for **all** app
  state — check-in, role-definition, published-agenda, committee-roster,
  saved-agenda, self-service member profiles/history, and check-in contact
  emails; no `localStorage` anywhere in the app anymore — see Persistence
  below for what each collection holds and why
- Firebase Auth (same `firebase` package, emulator-only) gates `/admin*`
  routes behind email/password sign-in, and separately backs self-service
  `/member` accounts — see Authentication below

## Structure

`src/app/` is organized **by feature**, not by artifact type. Each feature
folder mirrors a `pages/components/services/models/utils` shape; `core/`
holds everything 2+ features depend on; `layout/` holds shared app-shell
chrome.

```
src/app/
  core/
    services/   role-definition.service.ts (Firestore-backed — see
                Persistence below) (+ specs)
    models/     role-definition.models.ts
    firebase/   firestore.provider.ts — FIRESTORE injection token +
                provideAppFirestore(); auth.provider.ts — AUTH injection
                token + provideAppAuth(), same getOrCreateApp()-shares-one-
                FirebaseApp pattern as firestore.provider.ts. Both read
                src/environments/environment.ts
    auth/       auth.service.ts (AuthService — currentUser/isAdmin/ready
                signals, signIn()/signUp()/signOut()/resetPassword()/
                updateDisplayName()), auth.guard.ts (authGuard —
                CanActivateFn gating every /admin* route on isAdmin(), not
                just currentUser()), member.guard.ts (memberGuard — gates
                /member on currentUser() alone, since any signed-in account
                counts as a member) — see Authentication below
    utils/      locale.ts (APP_LOCALE)

  layout/
    navbar/     NavbarComponent — shared nav bar used by agenda-editor,
                checkin, admin-roles, and every admin hub page (title/links/
                action-buttons via @Input + <ng-content>); injects
                AuthService directly (not via @Input) to conditionally show
                a Sign Out button whenever currentUser() is set — this means
                it can render on /checkin or /preview too, for an admin who
                happens to have those open while signed in. Deliberately
                gated on currentUser(), not isAdmin() — Sign Out should still
                appear for a signed-in-but-non-admin account, since they need
                a way out too. Home has no navbar

  features/
    agenda-editor/    Route "/admin" — the agenda-building tool
      pages/           agenda-editor.component.ts
      components/      meeting-form, agenda-items, speakers-form,
                        agenda-preview
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
                      list/open/publish/delete saved agendas, "+ New Agenda".
                      Each row has its own Publish button, highlighted
                      solid blue and reading "Published" when that row is
                      the currently-published meeting
                      (`PublishedAgendaService.entries()`, normally 0-1
                      elements now that publish() is exclusive — see
                      Persistence below) — clicking it loads the full
                      snapshot via `SavedAgendaService.load()` (the same
                      one-time `getDoc()` `open()` already uses) and calls
                      `PublishedAgendaService.publish()`, so publishing no
                      longer requires opening the agenda into the editor
                      first
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

    checkin/          Route "/checkin" — the check-in page for everyone
                      (anonymous visitors, signed-in members, and admins
                      alike), no auth guard — stays anonymous-capable by
                      design, see Authentication below. Conditionally
                      renders behind a guest-email gate
                      (`CheckinComponent.needsGuestIdentification`, no
                      separate route) — an anonymous visitor sees only the
                      meeting-header card plus an email prompt until they
                      identify; a signed-in member/admin skips it entirely.
                      See "How anonymous identity works" under Persistence
                      below
      pages/           checkin.component.ts
      components/      attendance-list, role-board, speaker-signup,
                        evaluator-slots
      services/        checkin-state.service.ts (CheckinStateService),
                        checkin-contacts.service.ts (CheckinContactsService —
                        Firestore-backed, admin-only-readable raw emails,
                        see Persistence below),
                        attendance-confirmation.service.ts
                        (AttendanceConfirmationService — admin "mark
                        register" actions, writes memberHistory, see
                        Persistence below)
      models/          checkin.models.ts

    admin-roles/      Route "/admin/roles" (guarded) — manage role definitions
      pages/           admin-roles.component.ts

    admin-committee-roles/  Route "/admin/committee-roles" (guarded) — the one
                      place both committee role *definitions* (title/
                      description CRUD, unchanged) and role *assignment*
                      (who currently holds each role) are managed. Injects
                      both CommitteeRoleDefinitionService (definitions) and
                      CommitteeRosterService (assignment — see Persistence
                      below); each active role row shows an
                      Assigned/Unassigned badge plus Assign/Reassign/
                      Unassign controls calling `roster.assign()`/
                      `unassign()` directly — no separate "save" step,
                      unlike the old embedded Agenda Editor panel this
                      replaced. Assignment here is immediately live
                      everywhere: `AgendaStateService.cmt` is a computed
                      mirroring `CommitteeRosterService.all()`, so every
                      agenda (a fresh draft, a reopened saved one, or an
                      already-published one open on /preview) always shows
                      whoever currently holds each role — no per-agenda
                      committee editing exists anymore. The DOCX/live-
                      preview "Executive Committee" footer
                      (`docx.service.ts`/`agenda-preview.component.ts`) is a
                      hand-tuned, fixed table hardcoded to exactly 7 role
                      ids (`president`, `secretary`, `vpEducation`,
                      `communityManager`, `vpMembership`, `rsaAmbassador`,
                      `treasurer`) — a role beyond those 7 is fully
                      assignable here (flagged "(not printed on agenda)" in
                      the UI) but never appears in the footer or the
                      exported DOCX. This is an accepted scope boundary,
                      not a bug — deliberately kept simple rather than
                      redesigning that fixed table to be dynamic.
      pages/           admin-committee-roles.component.ts

    login/            Route "/login", the only route the auth guard doesn't
                      protect — email/password sign-in form. On success,
                      navigates to ?returnUrl= (defaulting to "/") — see
                      Authentication below
      pages/           login.component.ts

    signup/           Route "/signup" — self-service member account
                      creation (name/email/password), no auth guard, same
                      tier as /login. On success creates the Firebase Auth
                      account AND a matching `members/{uid}` Firestore
                      profile (see Authentication below), then navigates to
                      ?returnUrl= (defaulting to "/member")
      pages/           signup.component.ts

    member/           Route "/member" — guarded by memberGuard, not
                      authGuard (any signed-in account, not just admins —
                      see Authentication below): the signed-in member's own
                      dashboard, edit display name, view confirmed
                      attendance/role/speech history
      pages/           member-dashboard.component.ts
      services/        member-profile.service.ts (MemberProfileService —
                        Firestore-backed, own-uid read/write, see
                        Persistence below), member-history.service.ts
                        (MemberHistoryService — Firestore-backed, one-time
                        query, see Persistence below)
      models/          member.models.ts

    home/             Route "/" — tile picker. Signed in as an admin:
                      "Manage Agendas" (→ admin-agendas-hub), "Meeting
                      Check-in", "Manage Roles" (→ admin-roles-hub), "Sign
                      Out". Not signed in, or signed in without the admin
                      claim: the two admin tiles collapse into a single
                      "Sign In" tile (→ /login) — gated on
                      `AuthService.isAdmin`, not just currentUser(), so a
                      real Firebase account without the admin claim still
                      sees "Sign In", not the admin tiles (see Authentication
                      below for why that distinction matters); a signed-in
                      non-admin member gets "Member Profile" (→ /member)
                      instead. "Sign Out" appears whenever any account is
                      signed in (admin or member), calling
                      `AuthService.signOut()` directly rather than
                      navigating — Home is otherwise the one page with no
                      other way to sign out.
                      The "Meeting Check-in" tile is always shown — it was
                      briefly gated on a meeting being currently published
                      (`PublishedAgendaService.nearestEntry()` non-null),
                      but that hid the app's only anonymous, no-session
                      check-in entry point whenever nothing happened to be
                      published, which defeats check-in's own
                      anonymous-by-design intent (see Authentication below);
                      reverted back to unconditional. It's the one
                      non-admin, no-session entry point into check-in, so it
                      can't rely on AgendaStateService (nothing's been
                      loaded yet) — it links to
                      `PublishedAgendaService.nearestEntry()` when non-null
                      (heading becomes "Meeting #<no> Check-in", using the
                      app's `#<no>` convention, see checkin.component.html)
                      or degrades to a bare `/checkin` link with a generic
                      "Meeting Check-in" heading otherwise. Whenever nobody
                      is signed in, `checkinTileHeading()` appends
                      " As Guest" to whichever of those two headings
                      applies, so an anonymous visitor knows up front
                      they're checking in as a guest, not their own account.
                      `tileCount()` drives the grid's column count
                      accordingly: `(isAdmin()?2:1) + 1 + (isSignedIn()?1:0)`
                      — the middle `+1` is the Meeting Check-in tile,
                      unconditional. Every other check-in link in the app
                      (editor navbar, admin-roles/-hub/-agendas navbars)
                      DOES have an admin session, so those pass
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
`RoleDefinitionService`. The same list also exposes a per-row Publish
button (mirroring the Agenda Editor's own Publish button, see Persistence
below) that calls `SavedAgendaService.load()` — the same one-time
`getDoc()` `open()` already uses — to get the full snapshot before calling
`PublishedAgendaService.publish()`, so publishing works from either page
without a trip through the editor. Auto-save is driven by an untracked-free `effect()`
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
self-evaluation. An anonymous visitor identifies themselves with an email
up front — a small gate card (`CheckinComponent`'s `needsGuestIdentification`)
shown before any of the page's interactive content (name/check-in form,
attendance list, role board, speaker signup, evaluator slots), via
`CheckinStateService.identifyAsGuest()`, distinct from and called
internally by `checkIn()` — see "How anonymous identity works" below. A
signed-in member or admin never sees this gate. Before establishing that
guest identity, `CheckinComponent.identifyAsGuest()` first checks
`AuthService.hasAccount(email)` — if the typed email already belongs to a
real account, it redirects to `/login` (email pre-filled) instead of
creating a disconnected guest identity for someone who already has one —
see `AuthService.hasAccount()` under Authentication below for the
enumeration/real-Firebase-migration tradeoffs this accepts.

A checked-in attendee (admin, member, or guest, on their own check-in only)
can also mark themselves **Not Attending** — a `confirm()`-gated button
next to "Update", since it's broader than a toggle:
`CheckinStateService.uncheckIn()` removes them from attendees, releases
any *unlocked* role claim they hold, cancels their own speaker signup,
releases any evaluator slot they hold for someone else's speech, and
records them in a new `apologies` list on the check-in snapshot — all in
one transaction. Re-attending afterward (`checkIn()` again) removes them
from that list again, for symmetry. `apologies` here is check-in's own
list, distinct from — but two-way synced into — `MeetingData.apologies`,
the agenda's free-text field; see the paragraph below.

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
`checkinState.roles()`/`checkinState.speakers()`/`checkinState.apologies()`
directly and re-applies the snapshot every time any of them changes — which
happens on that initial load AND every time Firestore's live listener
delivers a claim/signup/uncheck-in made from **any device**, not just
another tab of the same browser. Applying a snapshot overwrites the
`person` field on every agenda row/dual-sub-item whose `roleId` has a
current check-in claim (via `AgendaStateService.applyRolePerson()`, reusing
the same role/person group-sync mechanism agenda items already use
internally), leaving a role's existing value untouched if check-in has no
claim for it yet, imports any check-in speaker signup not already present
in the Prepared Speakers list by name, and keeps the agenda's own
free-text `MeetingData.apologies` field synced with check-in's `apologies`
list (populated by a member's Not Attending action, see above) in both
directions: a name not yet present is appended (comma-split,
case-insensitive comparison against whatever the admin has already typed,
never rewriting the admin's own prose), and a name is removed again once
its uid drops out of check-in's list (i.e. that person re-attended) —
**but only if the agenda's text still holds exactly the token this sync
itself added**, tracked per-uid in `MeetingData.apologySyncUids` (uid →
name). Unlike `lastSyncedPersonByRole` above — an in-memory-only `Map` on
`AgendaEditorComponent`, since a role's *current* claim/release state is
always re-derivable from `checkinState.roles()` alone — apology retraction
specifically needs to remember something no longer visible anywhere once
the person re-attends (check-in's own list has already dropped them by
then), so that tracking is persisted as part of the saved agenda itself,
not just held in component memory: an in-memory-only version was tried
first and shipped with a real bug — a fresh `AgendaEditorComponent`
instance (any Editor reload) starts with an empty map, so it could never
retract a name a *previous* instance had added, even though the text was
still sitting there. `apologySyncUids` is optional on `MeetingData` (absent
on any agenda saved before this existed; every read site treats a missing
value as `{}`) and round-trips through `getSnapshot()`/`loadSnapshot()`
automatically, same as every other `MeetingData` field — never rendered
anywhere (not in the meeting-form, DOCX, or preview), purely internal
bookkeeping. A name the admin typed in by hand (or edited after the sync
added it) is never touched by the retraction, since `apologySyncUids` only
ever contains uids the sync itself added. This is still a heuristic over
free text, not a structured list, so it has one accepted fragility: prose
without commas (e.g. "Bob and Carol") won't register "Carol" as already
present, so a later check-in apology from Carol could append a redundant
second "Carol" — not solved here, since migrating `apologies` to a
structured array was a deliberate non-goal (would touch the model, the
meeting-form input, `docx.service.ts`, and `agenda-preview.component.*`,
plus backward-compat for already-saved string-typed documents). Same
only-while-Editor-open limitation as the role/speaker sync: a re-attend
made while nobody has that meeting's Editor open won't retract the agenda
text until the Editor is next opened for that meeting — but unlike the
in-memory version, it now genuinely does catch up at that point, since the
tracking survived in the saved document the whole time. The admin can mark
any role as
**overridden** (a
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

## Persistence — everything in Firestore, no localStorage

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
- `CheckinContactsService` — one document per check-in identity at
  `checkinContacts/{uid}`, holding the *raw* `name`/`email` behind that
  hash (see "How anonymous identity works" below). The one place in the app
  raw PII is stored, which is exactly why its rule is admin-read-only while
  every other collection here is public-read (or, on `checkins/**`, public
  read *and* write). Write is intentionally open — same accepted-risk model
  as `checkins/**` itself (self-reported, unverified) —
  `CheckinStateService.checkIn()` calls `upsert()` fire-and-forget (best
  effort; a failure here must never block the actual check-in). Exists to
  back a planned reminder-email feature (email every past attendee, member
  or anonymous) without ever exposing an attendee's email on the public
  `checkins` collection.
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
  plus `publishedAt`. **At most one such document exists at a time** —
  `publish()` is exclusive: it reads the whole collection, deletes every
  other document, and sets the new one, all inside a single `writeBatch()`
  (this codebase's first use of `writeBatch()`), so publishing meeting B
  always un-publishes whatever meeting A was previously published,
  atomically — there's never a window where zero or two meetings are
  simultaneously published. Migrated specifically because — unlike
  `SavedAgendaService`, a genuinely single-admin workload — this service's
  entire purpose is being read on a *different device* than the one that
  published it (`/preview`, reached from check-in's "Preview Agenda"
  link) — on `localStorage` that literally couldn't work cross-device, the
  same gap check-in had before its own migration. No separate index
  collection needed the way the old `localStorage` version needed a
  hand-rolled one (`agora-agenda-published-index`) — Firestore's
  `onSnapshot()` on the whole collection *is* "enumerate the keys," for
  free, which is exactly what `entries()`/`nearestEntry()` are built on —
  in practice they now only ever see 0 or 1 entries, but their code is
  unchanged; it already degrades to that correctly, so it was deliberately
  left as-is rather than collapsed to a single-value shape.
  `AgendaViewerComponent` reflects this reactively (an `effect()` over
  `current()`, not a one-time synchronous read), so it also updates live if
  the admin re-publishes while someone's viewing — including flipping from
  showing an agenda to the not-published fallback if a *different* meeting
  gets published while this one's `/preview` page is still open, since the
  old document is deleted outright, not merely superseded. Its "🔄 Refresh"
  button is now just a reassurance affordance, not a real refetch.
- `CommitteeRosterService` — a **single** document at `committeeRoster/current`
  holding the whole roster as one array, one entry per *assigned* role.
  `roleId` is a genuine unique key: an unassigned role simply has no entry
  at all, not a blank placeholder — earlier this held a fixed-length,
  position-addressed array of 7 slots (padded with blanks, several
  legitimately sharing the same blank `roleId` until assigned), but that
  model was replaced when officer assignment moved from being typed inline
  per-agenda to being centrally managed on `/admin/committee-roles` (see
  that Structure entry above) — a variable-length, role-keyed array matches
  that screen's per-role assign/unassign actions directly, with no fixed
  slot count to pad to. `assign(roleId, name, email, phone)` replaces any
  existing entry for that role in one `setDoc()`; `unassign(roleId)` removes
  the entry entirely — both read the already-live `roster()` value and
  write back the whole array, no `runTransaction` (this is admin-authored,
  not a first-come-first-served identity claim — see the role-locking-
  pattern skill for when a transaction *is* warranted). On load, entries
  with a blank `roleId` are filtered out defensively, tolerating any
  leftover padded data from the old fixed-slot model still sitting in dev/
  emulator data.
- `SavedAgendaService` — one document per meeting at `savedAgendas/{meetingId}`,
  the "My Agendas" draft library. Migrated for cross-device admin convenience
  (start on your laptop, finish on your phone), not to fix a correctness bug
  the way check-in/published-agenda were — this is a genuinely single-admin
  workload, migrated anyway once the pattern was well-established. `load()`
  is a one-time `getDoc()`, not a live subscription (see the Agenda editor
  section above); the auto-save effect that calls `save()` is debounced for
  the same reason as check-in's meeting-fields push.
- `MemberProfileService` — one document per self-service member account at
  `members/{uid}` (uid/email/displayName/createdAt/updatedAt). Own-uid
  read/write only, plus admin read for a future member directory — never
  admin *write*, which would defeat the point of self-service (see
  firestore.rules). `updateProfile()` writes both this doc and the Firebase
  Auth user record's `displayName` together in one call, since the name
  exists in both places and no caller should need to know that.
- `MemberHistoryService` / `AttendanceConfirmationService` — share one
  collection, `memberHistory/{meetingId}_{uid}`, but with opposite
  read/write roles: `AttendanceConfirmationService` (an admin's "mark
  register" controls on `/checkin`) is the only writer;
  `MemberHistoryService` (`loadHistory(uid)`, a one-time filtered
  `getDocs()` on the member dashboard) only ever reads. This is
  deliberately the *official*, admin-confirmed record — unlike the public,
  unverified self-report in `checkins/**` — which is also why only
  `isAdmin()` may write it, while read is gated to the record's own subject
  or an admin.

**How anonymous identity works now (no `localStorage` anywhere)** —
`StorageService` (the last remaining consumer was `CheckinStateService`'s
own per-browser identity) has been deleted outright. An anonymous check-in
visitor's identity is now derived deterministically instead of being
remembered by the browser: `CheckinStateService.identifyAsGuest(email)`
normalizes (trim + lowercase) the email they type and SHA-256-hashes it
(`core/utils/hash.ts`'s `sha256Hex()`, Web Crypto) into their `uid` — so the
*same* person gets the *same* uid on a different device or after clearing
browser storage, with nothing client-side to lose, and without the raw
email ever touching the public `checkins` collection (see
`CheckinContactsService` above for where the raw email actually lives).
`identifyAsGuest()` is the primary entry point — called directly by
`CheckinComponent`'s guest-email gate, up front, before any name is ever
entered — so a returning guest re-establishes the *same* uid, and
therefore immediately sees their prior claims/attendance (`isCheckedIn()`,
role-board's `isMine()`, etc. all key off `currentUid`), just by retyping
the same email at the gate, with no separate resubmission of the name/
check-in form required. `checkIn(name, email?)` also calls
`identifyAsGuest()` internally, but only as a fallback when not already
identified — kept so the many existing test call sites that still pass
name+email together in one call (chiefly in
`checkin-state.service.emulator.spec.ts`) keep working unchanged.
`isGuestIdentified` (computed: true for a signed-in account, or once
`identifyAsGuest()` has set an identity) drives the gate itself. Before a
first successful identification this session, `currentUid` is a random,
in-memory-only placeholder (`sessionUid`, never written anywhere) purely so
`=== currentUid` comparisons elsewhere don't need to handle a null case. A
signed-in account (member or admin) skips all of this and always uses its
real Firebase uid instead — passing an email to `checkIn()` while signed in
is accepted but ignored.

**A real gotcha hit migrating `CommitteeRosterService`, worth knowing before
migrating anything else that follows this same shape:** `AgendaStateService`
used to copy `committeeRoster.all()` into its own `cmt`/`agItems`/`meeting.vpe`
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

**`cmt` itself is now exempt from this gotcha** — since officer assignment
moved to being centrally managed on `/admin/committee-roles` (always-live,
not per-agenda; see that Structure entry above),
`AgendaStateService.cmt` became a plain `computed(() => this.committeeRoster.all())`
with nothing to seed: it mirrors the roster's current value, placeholder or
real, with no one-time copy to get wrong. The `ready()`-gated effect still
exists and still fully needs the pattern above, just narrower now — it
only redoes the one-time `agItems`/`meeting.vpe` seed once real data
arrives, not `cmt` too.

**A second-order version of the same gotcha, caught later:** the narrowed
`agItems`/`meeting.vpe` reseed above still races against something else —
`AgendaImportExportService.loadSnapshot()` (used by `AgendaViewerComponent`
on `/preview`, `AdminAgendasComponent.open()`, and JSON import) explicitly
loads a *specific* agenda's real `agItems` via
`AgendaStateService.setAgItemsFromSnapshot()`. If `committeeRoster.ready()`
only flips true *after* that load — again, a genuine race, Firestore data
always arrives asynchronously — the one-time reseed effect fired anyway and
silently overwrote the just-loaded real agenda with a fresh
`defaultAgenda()` template. Caught by inspecting a live `/preview` tab:
`PublishedAgendaService.current()` held a snapshot with a real role claim,
but `AgendaStateService.agItems()` showed an unrelated id sequence with
blank person fields, matching `defaultAgenda()`'s output exactly — the
reseed had clobbered it moments after `loadSnapshot()` ran. The fix:
`setAgItemsFromSnapshot()` sets a `hasLoadedSnapshot` flag, and the reseed
effect's guard now also checks it — once a real agenda has been explicitly
loaded, the entire premise of "the construction-time default needs
correcting" is moot, so the reseed must never fire at all from that point
on, regardless of what `ready()` does afterward.

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
a mock. Each Firestore-backed service (`CheckinStateService`,
`CheckinContactsService`, `RoleDefinitionService`,
`CommitteeRoleDefinitionService`, `PublishedAgendaService`,
`CommitteeRosterService`, `SavedAgendaService`, `MemberProfileService`,
`MemberHistoryService`, `AttendanceConfirmationService`) has a
`*.emulator.spec.ts` sibling, plus `AuthService` itself has one covering the
Auth-emulator-backed sign-up/sign-in path (using `@firebase/rules-unit-testing`'s
`initializeTestEnvironment()`, each with its own project id distinct from
the dev project so running tests never wipes data you're interactively
poking at) — run via `npm run test:emulator` with the emulator already
running. These are excluded from the default `npm test`/`ng test` run
(`angular.json`'s `test` target `exclude`s `**/*.emulator.spec.ts`, and is
pinned to the `development` build configuration specifically so it can
never accidentally pick up real production Firestore credentials once
`environment.production.ts` has them). Their plain `*.spec.ts` files only
cover what never touches Firestore — e.g. `CheckinStateService`'s pure
identity derivation (session uid, name seeding, email-hash uid derivation —
see checkin-state.service.spec.ts) — and, for services now consumed by
`AgendaStateService` (`RoleDefinitionService`, `CommitteeRosterService`),
`agenda-state.service.spec.ts` and `agenda-import-export.service.spec.ts`
provide plain synchronous fakes rather than the real Firestore-backed
service, since neither suite is testing Firestore behavior itself.

## Authentication — admin, self-service member, and anonymous tiers

Three independent tiers share one `AuthService` / one Firebase Auth
instance: **admin** (signed in + the `admin` custom claim, provisioned
manually), **member** (any signed-in account — self-service, provisioned
via `/signup`, no claim involved), and **anonymous** (no account at all —
check-in's original, still-fully-supported mode). Every `/admin*` route (6
total: `admin`, `admin/agendas`, `admin/manage-agendas`, `admin/manage-roles`,
`admin/roles`, `admin/committee-roles`) is gated by `authGuard`
(`core/auth/auth.guard.ts`) on `isAdmin()`; `/member` is gated by the
separate `memberGuard` (`core/auth/member.guard.ts`) on `currentUser() !==
null` alone — a member account never carries the admin claim (self-service
sign-up can't grant one), so reusing `authGuard` there would wrongly reject
every member. `/checkin` and `/preview` are still deliberately **not**
guarded by either — check-in stays open to all three tiers: an anonymous
visitor types a name+email (see "How anonymous identity works" under
Persistence above), while a signed-in member or admin uses their real
account instead (`CheckinStateService.currentUid` prefers
`auth.currentUser()?.uid`, falling back to the anonymous email-hash only
once signed out). Self-service member accounts were the "real
member-facing accounts" item this file used to list under Known gaps — they
now exist alongside the admin-only auth and the anonymous check-in flow;
multi-tenant support and paid subscriptions are still open (see Known gaps
below).

**Admin model: signed in AND carrying the `admin` custom claim** — being a
signed-in Firebase user is *not* by itself enough (this was an earlier,
simpler version of the rule that got tightened after review — see the
git history around `firestore.rules` if you want the full reasoning). There
is no public sign-up page anywhere in the app — accounts are provisioned
manually, via `npm run seed:admin` (`scripts/seed-admin-user.mjs`) against
the local emulator, or via the Firebase Console + a privileged script once a
real project exists (see the Known gaps note below — the Console alone
can't set a custom claim). The script uses `firebase-admin`
(`auth.setCustomUserClaims(uid, { admin: true })`), not the client SDK used
elsewhere in `scripts/` — setting a custom claim is an Admin-SDK-only
operation, unavailable to any client for the obvious reason that a client
must never be able to grant itself admin access. `firestore.rules`'
`isAdmin()` helper reads the claim directly: `request.auth.token.admin ==
true`.

**Why a custom claim, not a Firestore `admins/{uid}` allowlist doc** (the
very first version of this fix): a Firestore doc can be locked down for
every *write*, but the moment you also lock it down for every *read* (which
you must — the whole point is that nobody, including the admin themselves,
should be able to read or spoof it from the client), the client has no way
to ask "am I an admin?" for its own UI. `HomeComponent` hit this directly —
it could correctly reject a non-admin's actual writes, but had no way to
know not to *show* them the admin tiles in the first place. A custom claim
is part of the signed-in user's own ID token, so `AuthService` can read it
via `getIdTokenResult()` — same security guarantee (still Admin-SDK-only to
set), but now also legitimately readable client-side. **One nuance**: a
claim only appears in a *freshly issued* ID token — changing it while a user
is already signed in doesn't retroactively update their current session;
they need to sign out and back in (or the SDK's periodic silent refresh) to
see it.

**`AuthService.hasAccount(email)`** — a deliberate, narrow exception to
this file's own anti-enumeration posture (see `sendReset()`'s comment in
`login.component.ts`, which goes out of its way to *never* reveal whether
an email has an account). `hasAccount()` wraps Firebase Auth's
`fetchSignInMethodsForEmail()` to do exactly that check, on purpose:
`CheckinComponent`'s guest-email gate calls it before establishing an
anonymous identity, and redirects to `/login?email=...&returnUrl=...`
(email pre-filled, `LoginComponent`'s `prefilledFromCheckin`) if the typed
email already belongs to a real account (member or admin — this checks
Auth generically, not the `members` Firestore collection, which has no
read path for an anonymous client at all per `firestore.rules`) — the goal
is to stop a real member/admin from accidentally creating a disconnected
guest identity for themselves. Fails open (`false`) on any error, so a
lookup failure never blocks a guest from checking in. **Two accepted
tradeoffs, not bugs**: it does leak account-existence, same category of
signal `sendReset()` deliberately hides elsewhere in this file — accepted
as worthwhile here since it only helps the person typing their own email,
it doesn't expose anyone else's; and `fetchSignInMethodsForEmail()` is
neutered by "email enumeration protection," on by default on real
(non-emulator) Firebase projects created after ~mid-2023 — since standing
up a real project is on this app's own roadmap (see Known gaps below),
this check could silently stop detecting matches (always falling through
to guest mode) after that migration, with nothing failing loudly. Not
solved here — just something to remember if this stops working post-migration.

**`AuthService`** (`core/auth/auth.service.ts`) exposes `currentUser`
(`User | null`), `isAdmin` (`boolean`, derived from the claim — see above),
and `ready` (`false` until the first `onAuthStateChanged` callback fires) —
all signals, set together in one `NgZone.run()` per auth-state change
(`onAuthStateChanged`'s callback is `async` specifically to `await
user.getIdTokenResult()` before that batched write). `ready` matters because
this whole sequence is async — on a cold page load, `isAdmin()` briefly
reads `false` even for an already-signed-in admin while Firebase restores
the cached session. **`authGuard` waits for `ready()`, then checks
`isAdmin()`, not just `currentUser()`** — without the `ready()` wait, a hard
refresh on any admin page would flash-redirect a signed-in admin to
`/login`; without checking `isAdmin()` specifically, a signed-in account
without the claim could still reach an admin page and only fail once it hit
an actual Firestore read/write, instead of being redirected immediately.

**Member accounts (`/signup`, `/member`)** — genuinely self-service: anyone
can create one, no admin action required, which is exactly why it carries
no privilege beyond "is signed in" (see `memberGuard` above).
`AuthService.signUp()` creates the Firebase Auth account and sets its
`displayName` in one call; `SignupComponent` then calls
`MemberProfileService.createProfile()` to create the matching
`members/{uid}` Firestore profile — two systems that must stay in sync (see
Persistence above for why `MemberProfileService.updateProfile()` writes
both together on a later edit, not just the Firestore doc). A member
account's `/checkin` identity IS their Firebase uid (see above) — this is
also why `isNameLocked` in `CheckinComponent` disables the check-in name
field for a signed-in non-admin member (name changes belong on `/member`'s
own "Edit Name" instead) but deliberately exempts admins, who need the
flexibility to type any name while running a meeting.

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
- `members` — **own-uid read/write, plus admin read** (for a future member
  directory) — but never admin *write*, which would defeat the point of
  self-service. `firestore.rules` also enforces `displayName` can never be
  blank server-side, mirroring `MemberProfileService`'s own
  `requireDisplayName()` guard client-side.
- `memberHistory` — **admin-only write, read gated to the record's own
  subject or an admin**. The opposite ownership split from `members`: an
  admin confirms someone ELSE'S attendance/role/speech, so there's no
  own-uid check on write, only on read.
- `checkinContacts` — **admin-only read, open write** (same accepted-risk
  write model as `checkins/**` itself) — see Persistence above for why this
  is the one place raw check-in email/PII is allowed to live at all.

**Test impact**: the 5 `*.emulator.spec.ts` files for the
public-read-admin-write and admin-only collections
(`role-definition`, `committee-role-definition`, `committee-roster`,
`published-agenda`, `saved-agenda`) each embed their own `FIRESTORE_RULES`
string (they don't load the real `firestore.rules` file — the unit-test
builder bundles for the browser, so `node:fs` can't read it at runtime) —
these mirror the real per-collection rules and use
`testEnv.authenticatedContext('test-admin-uid', { admin: true })` for their
write-path assertions. `@firebase/rules-unit-testing`'s
`authenticatedContext(uid, tokenOptions)` accepts arbitrary token claims
directly as its second argument, which is what makes this simple — no
Firestore fixture document or `withSecurityRulesDisabled()` needed (an
earlier version of this test setup, back when admin status lived in a
Firestore doc, did need exactly that; switching to a claim removed it).
`role-definition.service.emulator.spec.ts` additionally has the actual
regression test for the security property itself:
`testEnv.authenticatedContext('random-signed-up-uid')` with *no* claim must
be rejected on write — being signed in is not enough.
`checkin-state.service.emulator.spec.ts` is untouched, since `checkins`
rules didn't change.

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
page heading, component/service class names — not "signup," to avoid
implying payment/registration. `/signup` is a deliberate, unrelated
exception: it's the literal account-creation route for self-service member
accounts (see Authentication above), where "sign up" is the correct word
for what's happening there. `SpeakerSignupComponent` is a second, older
exception for a similar reason: registering to give a speech is a distinct
action from checking in to the meeting, so "sign up to speak" reads
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
   point them at. **Provisioning a production admin is one step harder than
   it was under the old Firestore-doc allowlist**: creating the Firebase Auth
   account is still a Console action, but the Console has no UI for setting
   a custom claim — that step needs `scripts/seed-admin-user.mjs` (or
   equivalent) run with real service-account credentials instead of pointed
   at the emulator, since `setCustomUserClaims()` is Admin-SDK-only.
   (`.emulator-data/` and the local `seed:admin` script cover dev/testing
   only.)
2. Multi-tenant support — multiple clubs under one deployment (separate
   rosters/roles/agendas) — plus admin-managed yearly subscriptions
   (manually flagged for now, modeled to slot in real payments later
   without a schema rewrite). Self-service member accounts already exist
   (see Authentication above); this item is specifically about supporting
   more than one club, and billing.
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
(`admin@example.com` / `password123`) with the `admin` custom claim set
(see Authentication above) so you can actually reach any `/admin*` route —
safe to re-run any time (e.g. after wiping `.emulator-data/`, or just to
confirm the claim is still set). `npm start` already points at the emulator
by default (no flags needed), since `environment.ts` is what plain
`ng serve` uses.

For manual QA of a fully connected scenario (one meeting — `TEST-1` — with
a saved+published agenda, a filled committee roster, check-in attendees/
role-claims/speaker-signups, and member dashboard history, all
cross-referencing the same meeting id and 3 seeded member accounts —
`member1@example.com` / `password123`, etc.), optionally also run
`npm run seed:test-data` (`scripts/seed-test-data.mjs`) after the two seeds
above. Not required for first-time setup or by any test suite — the app
works fully without it — and safe to re-run.

Routes: `http://localhost:4300/` (home tile picker),
`http://localhost:4300/login` (admin sign-in — every route below except
`/checkin`, `/preview`, and `/signup` redirects here first if you're not
signed in), `http://localhost:4300/signup` (self-service member account
creation), `http://localhost:4300/member` (signed-in member's own
dashboard), `http://localhost:4300/admin` (agenda editor),
`http://localhost:4300/admin/agendas` (My Agendas — list/open/publish/delete saved agendas),
`http://localhost:4300/admin/manage-agendas` (hub: Agenda Editor / My Agendas),
`http://localhost:4300/checkin` (check-in page, no sign-in needed),
`http://localhost:4300/preview` (read-only published-agenda view, no sign-in needed), and
`http://localhost:4300/admin/roles` / `/admin/committee-roles` / `/admin/manage-roles`
(manage role definitions).

**Reaching the app from a phone or another device on the same LAN**:
`npm run serve:mobile` (`ng serve --host 0.0.0.0 --ssl --port 4300`)
instead of `npm start` — binds the dev server to every network interface,
not just loopback, and serves over HTTPS with an auto-generated
self-signed cert (required for `navigator.clipboard.writeText()`, used by
"🔗 Share Check-in Link", which browsers only allow in a secure context or
on `localhost` itself — plain HTTP would silently break that one feature
over LAN). Can't run alongside a plain `ng serve` on the same port; stop
one before starting the other. `firebase.json`'s
`emulators.firestore`/`auth`/`ui` entries all set `"host": "0.0.0.0"` for
the same reason — a Firestore/Auth emulator bound to `127.0.0.1` only
accepts connections *from that same machine*, which a phone isn't.

**A real gotcha this setup hit, worth knowing about**: neither `start` nor
`serve:mobile` in `package.json` used to pin `--port 4300` at all — plain
`ng serve` silently falls back to Angular's own default, **4200**, not the
4300 every route in this file (and `.claude/launch.json`, used by AI
coding tools' own browser-preview tooling) assumes. This went unnoticed
because `.claude/launch.json` passes `--port 4300` explicitly, so anything
using that config (an AI assistant's own browser testing, say) always saw
4300 and never hit the mismatch — a real terminal running plain `npm start`
was quietly on 4200 the whole time, invisible until someone actually tried
to reach it by a documented "4300" URL from a second device and it simply
didn't respond. Both scripts now hardcode `--port 4300` explicitly so this
can't silently drift again — if either ever needs a different port,
change it in **both** `package.json` and `.claude/launch.json` together,
not just one.

**A real gotcha this setup hit**: `environment.ts`/`environment.production.ts`
used to hardcode `firestoreEmulatorHost`/`authEmulatorHost` to `'127.0.0.1'`
— works fine from this machine's own browser, but once the JS bundle loads
on a *different* device, `127.0.0.1` inside that bundle means "loopback on
the phone", not "this dev machine" — the page would load (served fine by
`ng serve`) but every Firestore/Auth call would silently fail, since the
phone would be trying to reach emulators running on itself. Both files now
derive the emulator host from `window.location.hostname` instead — whatever
host the browser actually used to load the page (`localhost` locally, the
LAN IP like `192.168.x.x` from another device) is the same machine running
the emulators either way, so this one change works for both cases with no
separate "LAN mode" flag. Find this machine's LAN IP with `hostname -I` (or
`ip -4 addr show`) to know what to type into the phone's browser (e.g.
`https://192.168.x.x:4300`) — the self-signed cert will trigger a browser
warning ("connection is not private"); that's expected, proceed through it.
Both devices must be on the same LAN/Wi-Fi network for any of this to work.
