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
    audit/      audit-log.models.ts (AuditAction, AuditLogEntry — lives
                here, not the admin-audit-log feature, since several
                core/services and other features' services need the type to
                call appendAuditEntry() and core must not depend on a
                feature), audit-log.util.ts (appendAuditEntry() — the only
                writer to the `auditLog` collection, always called inside
                the same writeBatch() as the change being audited) — see
                "Audit log" under Authentication below
    firebase/   firestore.provider.ts — FIRESTORE injection token +
                provideAppFirestore(); auth.provider.ts — AUTH injection
                token + provideAppAuth(), same getOrCreateApp()-shares-one-
                FirebaseApp pattern as firestore.provider.ts. Both read
                src/environments/environment.ts
    auth/       auth.service.ts (AuthService — currentUser/isAdmin/
                isAppAdmin/ready signals, signIn()/signUp()/signOut()/
                resetPassword()/updateDisplayName()), auth.guard.ts
                (authGuard — CanActivateFn gating most /admin* routes on
                isAppAdmin(), not just currentUser()), super-admin.guard.ts
                (superAdminGuard — same shape, but checks isAdmin()
                specifically; guards only /admin/audit-log),
                member.guard.ts (memberGuard — gates /member on
                currentUser() alone, since any signed-in account counts as
                a member) — see Authentication below
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
                a way out too. Home has no navbar.

                **`[fixed]="true"` uses `position: sticky` (Bootstrap's
                `.sticky-top`), not `position: fixed`.** It used to be
                `fixed`, which removes the nav from document flow entirely
                — every one of the ~9 consuming pages had to hardcode a
                matching `margin-top`/`padding-top` (64px/80px/96px,
                whichever the page happened to need) on its own content to
                avoid the nav covering it. That broke for real the moment
                the nav's own row of links wrapped to more than one line —
                e.g. an admin's extra nav links (Agenda Editor, Manage
                Roles, Sign Out, ...) not fitting on one row at phone
                width — since the hardcoded offset only ever accounted for
                a single-row nav height. The nav would then render taller
                than the page's guessed offset and silently cover whatever
                content sat right below it (caught on `/checkin`: the
                meeting-info card's top was hidden behind the nav).
                `sticky` keeps the nav in normal document flow — content
                after it is pushed down by whatever the nav's real
                rendered height is, at any width, with nothing to keep in
                sync. Every consuming page's hardcoded top offset was
                removed for the same reason (a couple of hub pages kept a
                small intentional `margin-top` for visual breathing room
                beyond mere nav-clearance, just shrunk down since clearing
                the nav itself is no longer their job).

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
                        also Firestore-backed), committee-role-definition.service.ts,
                        checkin-agenda-sync.service.ts
                        (CheckinAgendaSyncService — the check-in → agenda
                        merge, shared by the editor AND the /preview viewer,
                        see "Check-in → agenda is automatic" below)
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

    admin-admins/     Route "/admin/manage-admins" — guarded by `authGuard`:
                      any app-admin (real claim or Firestore-granted) can
                      reach it and grant/revoke another member's access, not
                      just a true claim-holder — see "App-admin grants"
                      under Authentication below for the full design. The
                      one thing the UI itself still blocks is granting
                      yourself (`AdminAdminsComponent.isSelf()`, mirroring
                      firestore.rules' own restriction) — shows "Already an
                      admin" instead of a Grant button on your own row.
                      Lists every member (via MemberProfileService.listAll())
                      with a Grant/Revoke control per row backed by
                      AppAdminService, which also writes a matching
                      core/audit/audit-log.util.ts entry for every
                      grant/revoke — see "Audit log" under Authentication
                      below. Doesn't create accounts; that's still /signup
                      or scripts/create-member-accounts.mjs.
      pages/           admin-admins.component.ts
      services/        app-admin.service.ts (AppAdminService)
      models/          app-admin.models.ts

    admin-audit-log/  Route "/admin/audit-log" — guarded by
                      `superAdminGuard`, not `authGuard`: unlike every other
                      admin-gated route, a Firestore-granted admin cannot
                      reach this one, only a true claim-holder — see "Audit
                      log" under Authentication below for why. Read-only
                      list of every logged action, most recent first
                      (AuditLogService, a live `onSnapshot` capped at the
                      200 most recent entries).
      pages/           audit-log.component.ts
      services/        audit-log.service.ts (AuditLogService)

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
                      The "Meeting Check-in" tile only appears when
                      `PublishedAgendaService.nearestEntry()` is non-null —
                      omitted entirely (not shown-disabled) when nothing's
                      currently published, since there's nothing for a
                      visitor to check into yet. It's the one non-admin,
                      no-session entry point into check-in, so it can't
                      rely on AgendaStateService (nothing's been loaded
                      yet) — when shown, the heading reads "Meeting #<no>
                      Check-in", using the app's `#<no>` convention (see
                      checkin.component.html), with an inline
                      `isSignedIn() ? '' : ' As Guest'` suffix so an
                      anonymous visitor knows up front they're checking in
                      as a guest, not their own account. `tileCount()`
                      drives the grid's column count accordingly:
                      `(isAdmin()?2:1) + (nextMeeting()?1:0) + (isSignedIn()?1:0)`
                      — the middle term only counts the Meeting Check-in
                      tile when it's actually rendered. Every other check-in link in the app
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
(in memory); persisting it to a per-meeting-number library —
`SavedAgendaService` (`agenda-editor/services/saved-agenda.service.ts`,
Firestore-backed, `AgendaSnapshot` via the existing
`AgendaImportExportService.getSnapshot()`, the same serialization
Export/Import JSON already uses) to one document per meeting number at
`savedAgendas/{meetingId}` — is an **explicit action** (`AgendaEditorComponent.save()`,
bound to the navbar's Save button), not automatic. No hand-maintained index needed for the
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
without a trip through the editor. A blank meeting number is never saved
(`SavedAgendaService.save()` no-ops), which is also why "🆕 New Agenda"
(`AgendaStateService.resetAll()`) blanks `meeting.no` rather than reusing
a default — it keeps a fresh agenda un-addressable, and safe from
colliding with another saved meeting, until the admin types a real number
into the existing Meeting Details field. `SavedAgendaService.load(no)` is
a one-time `getDoc()`, not a live subscription — `AdminAgendasComponent.open()`
is `async` and `await`s it — opening a draft hydrates the editor once, it
doesn't keep watching Firestore afterward (the live-editing session is
`AgendaStateService`'s own in-memory state from then on, same as ever).

**Saving used to be automatic (a debounced `effect()` re-saving on every
edit) — it's explicit now, on purpose.** `AgendaEditorComponent` tracks
`isDirty` (a plain field, kept current by an untracked-free `effect()`
over `getSnapshot()` — same "reads every relevant signal, no manual
dependency list" shape the old auto-save effect had, just without any
Firestore write or debounce, since it's now a cheap in-memory comparison
against the JSON last actually written by `save()`). The Save button
reflects it directly: solid red with a `*` while dirty, outlined once
saved, `Saving…` mid-flight. `save()` does both halves of what the old
effect did in one action — `SavedAgendaService.save()`, and, if this
meeting is already the published one, `PublishedAgendaService.publish()`
too (checked fresh at click time, not tracked reactively) — so a live
meeting's published copy never goes stale behind an editor session the
way it would if Save only touched the draft. Both of those now **rethrow**
on failure (they used to swallow and just `console.error`) — that was
fine for a fire-and-forget auto-save no one was watching, but an explicit
button needs to tell the admin it didn't work (`save()` `alert()`s on
failure, `AdminAgendasComponent.publish()` sets its own `publishError`).
Since navigating away no longer implies "already saved," three things
now guard against silently losing work: `newAgenda()` `confirm()`s first
if `isDirty`; a `canDeactivate` guard on the `/admin` route
(`agenda-editor-can-deactivate.guard.ts`) catches every other in-app way
of leaving (Home/My Agendas/Manage Roles nav links, browser back inside
the SPA); and a `beforeunload` listener catches an actual tab close/
refresh/external navigation, which `canDeactivate` can't. See Persistence below for why
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

**Taking part requires being checked in first.** `claimRole()`,
`addSpeakerSignup()` and `claimEvaluatorSlot()` all reject anyone not
present in `attendees` — checked inside each one's own `mutate()`
transaction (via the private `isAttending(s)` helper) against the
freshly-read snapshot, never against the `onSnapshot()`-driven
`isCheckedIn()` signal, which lags and would let a member who withdrew on
their phone still claim from a stale tab. The three boards also disable
their Claim / Sign Up / Evaluate buttons and the page shows a prompt
banner, but that's convenience — the transaction is the actual rule, same
split as `lockedRoles`.

These three guards used to check only `currentName()`, which **was a real
hole**: a signed-in member or admin has `currentName` seeded from their
Firebase `displayName` the moment the service constructs (see
`syncIdentity()`), so they could claim roles and sign up to speak without
ever tapping "I'm Attending" — only anonymous guests were actually gated,
since their name is set by `checkIn()` itself. Releases
(`releaseRole()`/`removeSpeakerSignup()`/`releaseEvaluatorSlot()`)
deliberately carry **no** such guard: `uncheckIn()` already releases
everything the person held, so requiring attendance to release would be
both redundant and a trap. Covered by two regression tests in
`checkin-state.service.emulator.spec.ts` — the signed-in-member case, and
claiming again after `uncheckIn()`.

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
non-blank meeting number) — `CheckinMeeting` is its
own independent record (id/date/theme/word/start/maxSpeakers), not a
reference to the agenda, so without this push the header members see at
`/checkin` would just show `CheckinMeeting`'s own untouched defaults
regardless of what the admin set. One-way only — check-in's `maxSpeakers`
and nothing else agenda-side ever reads from `CheckinMeeting` back. Debounced
(500ms) — this is a real Firestore write per call, not a free
in-memory one — and skips the write
entirely when none of the 7 pushed fields actually changed since the last
push for that meeting number (`lastPushedMeetingJsonByNo`) — **this guard
was missing for a while and caused a real, self-sustaining bug**, back
when saving the agenda itself was also still automatic (see below): any
change to `state.meeting()` at all (including `apologySyncUids` being
updated by the check-in→editor apology sync below, part of the same
signal) re-triggered this push unconditionally; that write's own
`runTransaction()` round-trip re-fired `checkins/{no}`'s `onSnapshot`
listener with fresh object references for `roles`/`speakers`/`apologies`,
which re-ran the check-in→editor sync effect below, which could touch
`state.meeting()` again — sustaining a loop through real Firestore
round-trips (roughly one cycle every few seconds) for as long as the
Agenda Editor stayed open on a currently-published meeting. Caught via the
audit log: ~100 redundant `agenda.publish` entries for one meeting inside
an hour, all identical content, once `PublishedAgendaService.publish()`
started logging every call. Keeping a currently-published meeting's
`publishedAgendas` copy current is no longer tied to this effect at
all — see "Saving used to be automatic" above; it's now part of the
explicit Save button's own `save()` action instead.

Check-in → agenda is automatic, not a button — and it applies on **both**
the editor (`/admin`) and the read-only published-agenda viewer
(`/preview`). The merge itself lives in one place,
`CheckinAgendaSyncService.apply(meetingNo, state, checkin)`; both pages just
call it from their own effects. `AgendaEditorComponent`
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
in the Prepared Speakers list by name — and, matched by that same name,
keeps an already-imported speaker's `evaluator` field synced too (a
check-in evaluator claim/release almost always happens *after* the
speaker themselves was already imported, since an evaluator claims a slot
on an existing signup — **this was a real bug** until this field-sync
pass was added: the loop used to only check a `Set<string>` of existing
names to decide "skip vs. add new," with no path to ever update a
speaker already in the set, so an evaluator claim made post-import was
silently dropped forever, even though the effect itself was correctly
re-firing on the change. Fixed by keying off a `Map` of name → existing
`Speaker` instead, so an already-present speaker still gets
`state.updateSpeaker(id, 'evaluator', ...)` called when check-in's value
differs — verified live against the emulator, no dedicated spec file
since `AgendaEditorComponent` has none, per this repo's convention of
verifying page-level effect wiring in the browser, not with a unit
test), and keeps the agenda's own
free-text `MeetingData.apologies` field synced with check-in's `apologies`
list (populated by a member's Not Attending action, see above) in both
directions: a name is appended **once, the first time that uid appears** in
check-in's list (comma-split, case-insensitive comparison against whatever
the admin has already typed, never rewriting the admin's own prose), and a
name is removed again once
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
ever contains uids the sync itself added.

**`apologySyncUids` is also what makes the field clearable** — the import
skips any uid already in it, so once a person has been imported the text is
the admin's to edit, including deleting a name or emptying the field
outright. That's why the import is once-per-uid rather than the more
obvious "append whenever the name isn't in the text": the latter meant
clearing the Apologies field silently undid itself, because the very next
sync (they fire on every check-in change) saw the name missing and put it
straight back. Someone who apologizes *after* the admin clears is still
imported normally — only already-seen uids are skipped. This is a
deliberate difference from the role/person sync, which is intentionally
always-on and does keep overwriting; apologies are free-form prose the
admin composes, so a manual edit wins there. See
`checkin-agenda-sync.service.spec.ts`, which pins down all of this
(clear-stays-cleared, a later different person still imported, retraction,
and re-apologizing after re-attending).

This is still a heuristic over
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

**`/preview` runs the same merge, which is what makes check-in activity
visible to everyone else.** `publishedAgendas/{meetingId}` is frozen at
publish time, so on its own the viewer would show whatever was published and
nothing since — every role claim, signup and apology would stay invisible
until an admin happened to reopen the Editor and hit Save. So
`AgendaViewerComponent` also calls `checkinState.loadMeeting(meetingId)` and
runs `CheckinAgendaSyncService.apply()` over the loaded snapshot, in two
effects: one inside the `publishedAgenda.current()` effect (re-merging right
after `loadSnapshot()`, which resets the agenda to exactly what was
published and would otherwise discard the merge), and a second driven by
check-in's own signals for live updates. The first is needed because
nothing orders the two Firestore listeners — check-in data legitimately
arrives either before or after the published snapshot — so waiting for
check-in's *next* change could mean waiting forever.

This is display-only: **nothing is written back to `publishedAgendas`**, which
stays app-admin-write-only per `firestore.rules`. That's deliberate — a
check-in client is usually anonymous, so letting check-in actions write the
published document would mean opening an admin-controlled collection to
public writes (or adding Cloud Functions, which this emulator-only project
doesn't have). Reading `checkins/{meetingId}` needs no rule change: it's
already public-read. The stored published document therefore still only
changes when an admin re-publishes; what a viewer *sees* is the published
snapshot plus live check-in merged on top.

One inherited limitation, unchanged by this and shared with the editor: the
speaker merge only adds and updates, never removes. A member who cancels a
signup after it was imported stays on the agenda until an admin deletes the
row by hand.

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
  section above); `save()` itself is a plain, undebounced write now that
  it's called explicitly from the navbar's Save button rather than from an
  effect reacting to every keystroke.
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
check-in form required. **This last part was a real bug for a while**:
`identifyAsGuest()` derived the right uid (so claims/attendance already
matched correctly, since those all key off `currentUid` directly against
live Firestore data), but never touched `currentName` — that signal only
ever got reset by `syncIdentity()`, which watches `AuthService.currentUser()`
and therefore never fires for an anonymous guest at all. So a returning
guest's name field stayed blank, forcing them to retype it before they
could do anything ("Update", claim a role, etc. all require a non-blank
name). Fixed by having `identifyAsGuest()` look up the existing attendee
record for the newly-derived uid (if any) and seed `currentName` from it
— see `checkin-state.service.emulator.spec.ts`'s "restores a returning
guest's name" test. `checkIn(name, email?)` also calls
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

**Local dev is emulator-backed; production is a real Firebase project.**
`.firebaserc` holds both: `default` = `meeting-agenda-generator`, which is
*not* a real project at all — just a label the local emulator answers to —
and `production` = `agenda-planner-101c4`, the real one, with hosting target
`main` → site `agora-agenda-planner` (so the app is live at
`https://agora-agenda-planner.web.app`). **Because `default` is the fake id,
every `firebase` command aimed at production MUST pass `--project production`**
— every `deploy:*` script in `package.json` already does; a bare
`firebase deploy` would target a project that doesn't exist.

`src/environments/environment.ts` (emulator: `useFirestoreEmulator`/
`useAuthEmulator` true, hosts derived from `window.location.hostname`) and
`environment.production.ts` (real project config, both emulator flags false)
are swapped by `angular.json`'s `production` build configuration
`fileReplacements`. `src/app/core/firebase/firestore.provider.ts`'s
`provideAppFirestore()` reads `environment.useFirestoreEmulator` to decide
whether to call `connectFirestoreEmulator()` — the environments split is the
source of truth, not `isDevMode()`. The committed `apiKey` is not a secret
(Firebase web API keys ship in the JS bundle by design); `firestore.rules` is
what actually enforces access.

**Deploying — use `npm run deploy:all` for a full deploy**:
`ng build --configuration production && firebase deploy --only
hosting:main,firestore:rules,firestore:indexes --project production` — build
plus hosting plus rules plus indexes, in one command. The narrower scripts
are all still there and unchanged, for when you knowingly want just one
piece: `deploy` (build + hosting only), `deploy:hosting` (hosting only, no
build), `deploy:rules` (rules only, no build).

**Note that `deploy` is hosting-only, and that once caused a real production
bug** — reach for `deploy:all` unless you specifically want otherwise. The
`appAdmins`/`auditLog` work shipped via that hosting-only `deploy`, so the
live rules still had no `auditLog` match at all while the newly-deployed
bundle was already writing to it. A collection with no matching rule is
deny-by-default, and `appendAuditEntry()` is always batched into the *same*
`writeBatch()` as the change it audits — so the whole batch failed
atomically and the Agenda Editor's Save button reported `FirebaseError:
Missing or insufficient permissions` for a genuine admin, even though
`savedAgendas`' own rule was perfectly correct. The misleading part is that
the failing collection is never the one you're thinking about: the error
names nothing, and `savedAgendas` looks innocent. **If a write that should
be allowed returns "Missing or insufficient permissions", check whether
every collection in that batch has a deployed rule before suspecting the
caller's admin status.**

**`authDomain` vs. the email action URL — two different settings.**
`environment.production.ts`'s `authDomain` is `agora-agenda-planner.web.app`
(not the default `agenda-planner-101c4.firebaseapp.com`) purely so users
never see the raw project id during client-side auth redirects. It does
**not** affect password-reset emails: those links are generated server-side
by Firebase Auth, which never sees the client config, and use the project's
*action URL* — configured in the Firebase Console under Authentication →
Templates → (each template) → "Customize action URL", defaulting to
`https://<projectId>.firebaseapp.com/__/auth/action`. Changing the link in
reset emails is a Console change only; no code change will do it. Firebase
Hosting auto-serves the `/__/auth/*` handler on every site in the project,
and reserves `/__/*` ahead of rewrites, so `firebase.json`'s SPA catch-all
(`**` → `/index.html`) doesn't shadow it.

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
manually — or, since the app-admin grants feature below, a Firestore-
granted equivalent), **member** (any signed-in account — self-service,
provisioned via `/signup`, no claim involved), and **anonymous** (no
account at all — check-in's original, still-fully-supported mode). Every
`/admin*` route except one (8 total: `admin`, `admin/agendas`,
`admin/manage-agendas`, `admin/manage-roles`, `admin/roles`,
`admin/committee-roles`, `admin/manage-admins`, `admin/audit-log`) is
gated by `authGuard` (`core/auth/auth.guard.ts`) on `isAppAdmin()` (real
claim OR Firestore grant — see "App-admin grants" below), including
`admin/manage-admins` itself: any app-admin can grant/revoke another
member's access, not just a true claim-holder. `admin/audit-log` alone is
gated by the stricter `superAdminGuard` (`core/auth/super-admin.guard.ts`)
on `isAdmin()` specifically — who granted/revoked what should only be
visible to a true claim-holder, even though any app-admin can perform the
action itself (see "Audit log" below). `/member` is gated by the
separate `memberGuard` (`core/auth/member.guard.ts`) on `currentUser() !==
null` alone — a member account never carries the admin claim (self-service
sign-up can't grant one), so reusing `authGuard` there would wrongly reject
every member. `/preview` uses that same `memberGuard`, for the same reason
it isn't `authGuard`: a published agenda is for members to read, not only
admins. It used to be unguarded, and was closed because the agenda exposes
every role-holder's and speaker's name plus the committee footer's emails
and phone numbers; `firestore.rules` locks `publishedAgendas` read to
`request.auth != null` alongside it, since a route guard alone would leave
the same data fetchable straight from the REST API (see Persistence above
for the knock-on effects on Home's check-in tile and
`PublishedAgendaService`'s listener).

`/checkin` remains deliberately **unguarded** — it stays open to all three
tiers: an anonymous
visitor types a name+email (see "How anonymous identity works" under
Persistence above), while a signed-in member or admin uses their real
account instead (`CheckinStateService.currentUid` prefers
`auth.currentUser()?.uid`, falling back to the anonymous email-hash only
once signed out). Closing `/preview` deliberately did **not** touch this —
`checkins/**` stays fully public, and an anonymous guest still checks in,
claims roles and signs up to speak exactly as before; they just can't read
the assembled agenda. Self-service member accounts were the "real
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

**App-admin grants (`appAdmins/{uid}`)** — a second, Firestore-based way
to get admin-equivalent access, deliberately kept separate from the real
`admin` custom claim so an admin can grant it to someone else without
ever touching the Admin SDK/a service-account key (setting the real claim
still requires that — see `scripts/promote-to-admin.mjs`). A document's
mere existence at `appAdmins/{uid}` means that uid has full parity with
`isAdmin()` for every app feature (`AuthService.isAppAdmin` — a computed
`isAdmin() || grantedAdmin()`), enforced the same way everywhere in
`firestore.rules` via an `isAppAdmin()` helper that itself calls
`isAdmin() || isGrantedAdmin()`. This now extends to `appAdmins/{uid}`
itself: `allow create, update: if isAppAdmin() && request.auth.uid !=
uid` (`allow delete: if isAppAdmin()`, no such restriction) — **any**
app-admin, real claim or granted, can grant or revoke ANOTHER member's
access via `/admin/manage-admins` (`AdminAdminsComponent`,
`AppAdminService`, guarded by `authGuard` like every other admin route —
this was originally `superAdminGuard`-only, real-claim-only, loosened
deliberately so it doesn't bottleneck on one person). **The one thing
still off-limits to everyone**, real claim included, is granting or
regranting your OWN uid — see the self-grant paragraph below. This is
also why `appAdmins/{uid}` read is own-uid-scoped (`request.auth.uid ==
uid || isAppAdmin()`) rather than locked down entirely — unlike the very
first, rejected version of admin-as-a-Firestore-doc (see "Why a custom
claim..." above), a granted admin's own client needs to be able to ask "am
I one?" for its own UI, and now also needs to browse the full list to use
the manage-admins screen itself.

**A true admin cannot grant (or regrant) app-admin power to their own
uid** — `request.auth.uid != uid` on create/update, mirrored client-side
in `AdminAdminsComponent.isSelf()` (hides the Grant button and shows
"Already an admin" on the signed-in admin's own row instead, if it even
appears — it only would if that admin also has a self-service
`members/{uid}` profile, which `scripts/seed-admin-user.mjs`-provisioned
accounts don't). This isn't just pointless (`isAdmin()` already implies
`isAppAdmin()`) — it's a real footgun: a self-grant makes access outlive
the claim it was redundant with, so revoking that claim later (`npm run
revoke:admin`, or by hand) would silently fail to actually remove access.
Delete has no such restriction, so a true admin can still clean up a
self-grant that predates this rule (e.g. seeded directly, or created
before this restriction existed).

Unlike the real claim (which needs a fresh ID token — sign out and back
in, or the SDK's periodic silent refresh — to reflect a change),
`grantedAdmin` is populated by a **live** `onSnapshot` on the signed-in
user's own `appAdmins/{uid}` document, re-subscribed on every
`onAuthStateChanged` transition (the previous listener is explicitly
unsubscribed first, so a stale one never keeps running against a
signed-out or switched-away uid). `ready()` now also waits for that
listener's first result, same reasoning as it already waits for
`getIdTokenResult()` — without it, `authGuard` could flash-redirect a
granted (non-claim) admin on a hard refresh, before their grant has been
read. Net effect: revoking someone's granted access takes effect in their
already-open session immediately, no sign-out required — a genuine
usability advantage over the claim, on top of not needing the Admin SDK
to grant it in the first place.

This is deliberately unrelated to the committee roster
(`committeeRoster`/`admin/committee-roles` — see Structure and Two
independent features above), which describes what someone does at the
club (President, Secretary, ...) for agenda-printing purposes. Holding a
committee title implies nothing about app-admin access, and vice versa —
conflating the two was considered and explicitly rejected.

**Audit log (`auditLog`)** — a direct consequence of loosening
`appAdmins` grant/revoke to every app-admin: with more than one person
able to make these changes, you need a record of who actually did what.
An append-only trail of *meaningful* admin actions across the app, not
every write — `core/audit/audit-log.models.ts`'s `AuditAction` union is
the exhaustive list: `admin.grant`/`admin.revoke`, `role.create`/
`archive`/`restore` and the same three for `committeeRole`,
`committeeRoster.assign`/`unassign`, `agenda.save`/`publish`/`unpublish`/
`delete`, `attendance.confirm`/`unconfirm`. Deliberately **excluded**:
role/committee-role label edits (`update()`) and JSON-import upserts
(`setDefinition()`/`CommitteeRosterService.replaceAll()`).
`SavedAgendaService.save()` used to be excluded for the same reason as
those — it fired automatically on every keystroke (debounced ~500ms),
which would have flooded the log — but now that saving is an explicit
Save-button click (see "Saving used to be automatic" under Two
independent features above), each one is `agenda.save`, exactly as
meaningful as `agenda.publish`/`agenda.delete`. Every instrumented service
(`AppAdminService`, `RoleDefinitionService`, `CommitteeRoleDefinitionService`,
`CommitteeRosterService`, `PublishedAgendaService`, `SavedAgendaService`,
`AttendanceConfirmationService`) now also injects `AuthService` purely to
attribute the entry it writes — `core/audit/audit-log.util.ts`'s
`appendAuditEntry(firestore, batch, action, summary, actor)` is the only
way an entry is ever created, and it's never called outside a
`writeBatch()` that also contains the actual change, so the trail can
never drift out of sync with reality: either both writes land, or
neither does. `summary` is a plain human-readable string built by the
writer at write time (e.g. `Archived meeting role "Grammarian"`) —
`AuditLogComponent` just renders it directly, so a new `AuditAction`
never needs a matching change in the UI's rendering logic.
`firestore.rules`' `auditLog` rule only validates shape (`action`/
`actorUid`/`at`/`summary` all present as the right type), not the exact
`action` value — enumerating every action string there would need
updating on every new action added, for no real safety gain.

**Read is `isAdmin()`-only, not `isAppAdmin()`** — the one place in this
feature that's deliberately *not* loosened: any app-admin can perform an
audited action, but only a true claim-holder can see the trail of who did
what (`AuditLogService`, injected only by `AuditLogComponent` at
`/admin/audit-log`, guarded by `superAdminGuard`). `allow update, delete:
if false` for everyone, always — an audit trail that can be edited after
the fact isn't one; there's no admin UI or script that touches an
existing entry, only ever creates new ones. `AuditLogService` is a live
`onSnapshot` (`orderBy('at', 'desc')`, capped at the 200 most recent
entries — a small club's admin-grant/role/agenda activity will never come
close to that; the cap exists purely to bound the read, not because older
entries stop mattering).

`AuditLogComponent.rows` (a `computed`) collapses a run of *consecutive*
entries sharing the same action/summary/actor into one displayed row with
a `×N` badge and a first–latest time range, rather than rendering every
raw entry — this is what actually surfaced the republish-loop bug above
in the first place (a wall of ~100 identical "Published agenda #164"
lines was the first visible symptom) and keeps the page readable if a
similar burst ever happens again for any reason, without hiding genuinely
distinct activity (different meetings/actors/actions are never merged).

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
write: if true`** (`firestore.rules`). Everywhere below that says
"app-admin" means `isAppAdmin()` — real claim OR Firestore grant, see
"App-admin grants" above; `members` and `auditLog` read are the deliberate
exceptions that still check `isAdmin()` specifically:
- `checkins/**` — untouched, fully open (see above).
- `appAdmins/{uid}` — **own-uid-or-app-admin read, app-admin write (except
  your own uid)** — any app-admin can grant/revoke ANOTHER member's
  access; the one thing still real-claim-only nowhere in this rule at all
  is granting yourself, enforced via `request.auth.uid != uid` on
  create/update specifically, not via `isAdmin()` — see "App-admin
  grants" above.
- `auditLog/{entryId}` — **isAdmin()-only read, app-admin create, no
  update/delete for anyone** — see "Audit log" above for why read stays
  real-claim-only even though any app-admin can create an entry (by
  performing the action it describes).
- `publishedAgendas` — **signed-in read (`request.auth != null`), app-admin
  write**. The exception to the public-read group below: a published agenda
  carries real personal information — every role-holder's and speaker's
  name, plus the Executive Committee footer's emails and phone numbers — so
  `/preview` is behind `memberGuard` and the rule enforces the same thing on
  the data itself (a route guard alone would leave it fetchable straight from
  the REST API). `request.auth != null`, not `isAppAdmin()`: ordinary members
  are exactly who the page is for. Two knock-on effects, both deliberate:
  `HomeComponent` can no longer read the collection when signed out, so a
  signed-out visitor doesn't get the "Meeting Check-in" tile and reaches
  check-in via the shared `/checkin?meeting=X` link instead (check-in itself
  is untouched and still fully anonymous); and `PublishedAgendaService` opens
  its collection listener **only while signed in** (an `effect()` over
  `auth.currentUser()`, tearing the previous listener down first and clearing
  `allEntries`/`snapshot` on sign-out) rather than unconditionally in its
  constructor, so a signed-out visitor on the public Home route doesn't sit
  retrying a read the rules now deny. `CheckinComponent` also hides its
  "👁 Preview Agenda" nav link for anonymous visitors, since it would only
  bounce them to `/login`.
- `roleDefinitions`, `committeeRoleDefinitions`, `committeeRoster` —
  **public read, app-admin write**. All three are
  public-read for a non-obvious reason worth remembering before tightening
  any of them further: every migrated Firestore-backed service subscribes
  via `onSnapshot()` **eagerly in its constructor**, so a collection is
  exposed to whoever the *service* is transitively injected by, not just
  whoever the *page* visibly renders. `AgendaPreviewComponent` injects
  `AgendaStateService`, which itself injects
  `CommitteeRosterService` — so `/preview` fires a live `committeeRoster`
  read on load even though nothing in `/preview`'s own template displays
  roster data directly (`/preview` is signed-in-only now, but `/checkin`
  reaches the same service the same way and is not).
  `RoleDefinitionService` is the same story via
  `RoleBoardComponent` on `/checkin`. Making any of these four admin-only
  would break the corresponding public page with a silent permission-denied,
  not a build error — trace real injection chains before ever tightening a
  rule here, don't assume from what a page's template shows.
- `savedAgendas` — **app-admin for both read and write**. Confirmed safe
  because `SavedAgendaService` is only ever injected by `AgendaEditorComponent`
  and `AdminAgendasComponent`, both already behind the guard — nothing on
  `/preview` or `/checkin` transitively touches it.
- `members` — **own-uid read/write, plus admin read** (for a future member
  directory) — but never admin *write*, which would defeat the point of
  self-service. Deliberately stays `isAdmin()`, not `isAppAdmin()` — no
  particular reason a granted admin couldn't read it too, it just hasn't
  come up; tighten this comment if that's ever deliberately extended.
  `firestore.rules` also enforces `displayName` can never be blank
  server-side, mirroring `MemberProfileService`'s own
  `requireDisplayName()` guard client-side.
- `memberHistory` — **app-admin write, read gated to the record's own
  subject or an app-admin**. The opposite ownership split from `members`: an
  admin confirms someone ELSE'S attendance/role/speech, so there's no
  own-uid check on write, only on read.
- `checkinContacts` — **app-admin read, open write** (same accepted-risk
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

`AppAdminService`'s own `app-admin.service.emulator.spec.ts` covers the
`appAdmins` collection itself, including the key regression tests for the
loosened model: a *granted* admin (present in `appAdmins`, no real claim)
CAN grant/revoke a DIFFERENT member, but both a true admin AND a granted
admin are rejected granting THEMSELVES — the self-grant restriction
applies to both tiers equally. Six of the specs across the app
(`role-definition`, `committee-role-definition`, `committee-roster`,
`published-agenda`, `saved-agenda`, `attendance-confirmation`) each got a
"granted admin can write" test (seeding an `appAdmins/{uid}` doc for an
otherwise-unclaimed uid, confirming that uid can now write) plus a
dedicated "writes a matching auditLog entry" test asserting the exact
`action`/`summary` shape `appendAuditEntry()` produced, all via a plain
`getDocs()` against the emulator's `auditLog` collection (no
`AuditLogService` needed in these — that's exercised directly in
`audit-log.service.emulator.spec.ts`, which drives the pattern through
`AppAdminService.grant()`/`revoke()` specifically since it's the simplest
audited mutator, and covers the collection's own rules: `isAdmin()`-only
read even for a granted admin who performed the audited action, and
`allow update, delete: if false` for everyone).

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

1. ~~Stand up a real Firebase project~~ — **done**: `agenda-planner-101c4`,
   live at `https://agora-agenda-planner.web.app` (see Persistence above for
   the environments/deploy split, and the warning that `npm run deploy` ships
   hosting only, never rules). Still worth knowing: **provisioning a
   production admin is one step harder than it was under the old
   Firestore-doc allowlist** — the Console has no UI for setting a custom
   claim, so `setCustomUserClaims()` must come from the Admin SDK via
   `npm run promote:admin:prod -- someone@example.com` with
   `GOOGLE_APPLICATION_CREDENTIALS` pointed at a downloaded service-account
   key. A claim only lands in a *freshly issued* ID token, so the person must
   sign out and back in before the app sees it. The in-app alternative that
   avoids service-account keys entirely is granting `appAdmins/{uid}` from
   `/admin/manage-admins` (live, no re-sign-in needed) — see "App-admin
   grants" under Authentication.
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
(manage role definitions), and `http://localhost:4300/admin/manage-admins`
(grant/revoke app-admin access — only reachable by a true, real-claim
admin, not a Firestore-granted one).

**Reaching the app from a phone or another device on the same LAN**:
`npm run serve:mobile` (`ng serve --host 0.0.0.0 --port 4300`) instead of
`npm start` — binds the dev server to every network interface, not just
loopback. Plain HTTP, deliberately — see the mixed-content gotcha below
for why this can't be HTTPS. Can't run alongside a plain `ng serve` on the
same port; stop one before starting the other. `firebase.json`'s
`emulators.firestore`/`auth`/`ui` entries all set `"host": "0.0.0.0"` for
the same reason — a Firestore/Auth emulator bound to `127.0.0.1` only
accepts connections *from that same machine*, which a phone isn't.

**A real gotcha this setup hit — HTTPS + HTTP-only emulators = mixed
content, breaking sign-in/sign-up/check-in on a phone**: `serve:mobile`
briefly ran with `--ssl` (an auto-generated self-signed cert), specifically
because `navigator.clipboard.writeText()` (`🔗 Share Check-in Link`, in
`agenda-editor.component.ts`) only works in a secure context, and Safari on
a phone treats a plain `http://192.168.x.x` LAN address as insecure. That
broke everything else instead: neither the Firestore emulator nor the Auth
emulator supports TLS, so `auth.provider.ts`/`firestore.provider.ts` always
connect to them over plain HTTP — once the *app itself* loaded over HTTPS,
every one of those HTTP calls became mixed active content, which mobile
Safari blocks outright. Two concrete symptoms this produced, both traced
back to the same root cause: sign-in/sign-up failed with a generic network
error (the blocked Auth REST calls), and `HomeComponent`'s "Meeting
Check-in" tile disappeared entirely — not disabled, gone — because it's
coded to omit itself whenever `PublishedAgendaService.nearestEntry()` is
null, and that Firestore read was blocked too, so it never resolved.
Fixed by dropping `--ssl` from `serve:mobile` again — the whole chain (app,
Firestore, Auth) is HTTP-to-HTTP over LAN now, same as `npm start` locally,
so nothing is mixed content. `copyCheckinLink()` no longer assumes
`navigator.clipboard` is available: it tries the Clipboard API first (works
over `npm start`'s `localhost`, or any future real HTTPS deployment), and
falls back to the legacy `document.execCommand('copy')` path — a
synchronous, user-gesture-triggered DOM operation that doesn't require a
secure context — before finally falling back to the existing "here's the
link, copy it yourself" alert if both fail. An HTTPS-everywhere fix (a
TLS-terminating proxy in front of the emulator ports too) was considered
and rejected as unnecessary local-only tooling for a dev convenience
feature — not worth it against "sign-in and check-in are completely broken
on a phone."

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
`http://192.168.x.x:4300` — plain HTTP, see the mixed-content gotcha
above). Both devices must be on the same LAN/Wi-Fi network for any of this
to work.
