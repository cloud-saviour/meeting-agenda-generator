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
                        default-agenda.ts
      models/          agenda.models.ts
      utils/           agenda-timeline.ts

    checkin/          Route "/checkin" — member-facing check-in page
      pages/           checkin.component.ts
      components/      attendance-list, role-board, speaker-signup,
                        evaluator-slots
      services/        checkin-state.service.ts (CheckinStateService)
      models/          checkin.models.ts

    admin-roles/      Route "/admin/roles" — manage role definitions
      pages/           admin-roles.component.ts

    home/             Route "/" — tile picker linking to the 3 pages above
      pages/           home.component.ts
```

## Two independent features, two independent state services

**Agenda editor** (`/admin`) — single-user authoring tool. Build an agenda, preview
it as a live A4 page, export to DOCX or print. State lives only in memory
(`AgendaStateService`); nothing persists on reload except via manual
Export/Import JSON.

**Check-in page** (`/checkin`) — meant to be a *shared* sheet multiple members
check simultaneously before a meeting: check in, claim one of 6 standard roles
(Toastmaster, General Evaluator, Grammarian, Timer, Ah-Counter, Evaluation
Chairman), sign up to speak, claim an evaluator slot for someone else's speech.
Role/evaluator claims are first-come-first-served — `CheckinStateService`
enforces "only the current claimant can release their own claim" and blocks
self-evaluation.

These two pages are linked one way: the agenda editor has a "🔗 Share
Check-in Link" button that copies `/checkin?meeting=<no>` (using the
agenda's own meeting number) to the clipboard — check-in data is isolated
per meeting number (`CheckinStateService.loadMeeting()`, keyed by
`?meeting=`), so different meetings don't share a sheet. What's still
missing is the other direction: pushing confirmed check-in data (who's
speaking, who claimed what) back into the agenda editor's form fields is
planned but not built.

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
3. Push confirmed check-in data (roles claimed, speakers signed up) back into
   the agenda editor's form fields — the other half of wiring the two features
   together. ("Share check-in link" from the editor, and per-meeting check-in
   isolation via `?meeting=<no>`, are done — see above.)
4. Admin console for the check-in page: reset a role, cap speaker slots,
   lock the sheet once the meeting starts

## Local dev

```bash
npm install
ng serve --port 4300
```

Four routes: `http://localhost:4300/` (home tile picker),
`http://localhost:4300/admin` (agenda editor),
`http://localhost:4300/checkin` (check-in page), and
`http://localhost:4300/admin/roles` (manage role definitions).
