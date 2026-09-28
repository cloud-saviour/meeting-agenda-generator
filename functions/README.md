# Cloud Functions

One function: `sendAnnouncementEmail`, in `index.mjs`. It fires whenever an
admin posts a club announcement (`clubs/{clubId}/announcements/{id}` is
created — see `features/club-subscription/` in the main app) and emails that
club's subscriber list.

**The code is ready to deploy, but sending is switched off until you
configure it.** Without the secrets below, the function deploys and runs
safely — it logs a warning and does nothing — instead of throwing or
pretending to send. Nothing about this is broken; it's the deliberate state
until you're ready to turn sending on.

## What this needs before it can actually send an email

1. **Upgrade the Firebase project to the Blaze (pay-as-you-go) plan.**
   Cloud Functions cannot run on the free Spark plan. Blaze still has a
   generous free monthly quota for Functions — set a budget alert in the
   Console so you're not surprised, but a small club's traffic here is very
   unlikely to cost anything.
   `firebase projects:list` / the Firebase Console → Project settings →
   Usage and billing.

2. **Create a [Resend](https://resend.com) account** (or swap in a different
   provider — see "Swapping providers" below) and verify a sending domain
   under Resend's Domains page. You cannot send from an unverified domain;
   free-tier "onboarding@resend.dev" only lets you email your own Resend
   account's address, which is fine for testing but not for real subscribers.

3. **Set the secrets** (Cloud Functions v2 native secrets — never put these
   in a committed file):
   ```bash
   firebase functions:secrets:set RESEND_API_KEY --project production
   firebase functions:secrets:set MAIL_FROM_ADDRESS --project production
   # optional — used only to build the "manage your subscription" footer line:
   firebase functions:secrets:set APP_BASE_URL --project production
   ```
   `MAIL_FROM_ADDRESS` must be an address on the domain you verified in
   step 2 (e.g. `club@yourdomain.com`), not a free Gmail/Outlook address.

4. **Install dependencies and deploy**:
   ```bash
   cd functions && npm install && cd ..
   npm run deploy:functions
   ```
   (`deploy:functions` is intentionally NOT part of `npm run deploy:all` —
   see the root `package.json` — so existing hosting/rules deploys are never
   blocked by Functions not being set up yet.)

5. **Test it**: post an announcement on `/c/<slug>/admin/announcements` with
   at least one subscribed email, then check
   `firebase functions:log --project production` (or `npm run logs` from
   this folder) for `sendAnnouncementEmail`'s log lines.

## Local development

`firebase emulators:start` does not include the Functions emulator by
default in this project (`npm run emulators` deliberately passes
`--only firestore,auth` — see CLAUDE.md's "A real gotcha" note on why).
To test this function locally, run `firebase emulators:start --only
functions,firestore,auth` instead, with `RESEND_API_KEY`/`MAIL_FROM_ADDRESS`
either unset (to exercise the safe no-op path) or set via a local
`.secret.local` file per the Firebase CLI's own docs — never commit that
file.

## Swapping mail providers

The Resend-specific code is isolated to one `import('resend')` call and one
`resend.emails.send(...)` call inside `sendAnnouncementEmail`. Swapping to
SendGrid, Mailgun, AWS SES, or the "Trigger Email" Firebase Extension means
replacing just that one block — the idempotency guard, the subscriber
lookup, and the per-recipient loop all stay the same.

## Idempotency

Cloud Functions triggers are at-least-once, not exactly-once — a retry is
rare but real. `sendAnnouncementEmail` guards against double-sending by
checking (then setting) `emailedAt` on the announcement doc itself before
sending. `emailRecipientCount` is also written back, so the admin
announcements page could show "Emailed to N people" in a future pass (the
field isn't read by the UI yet — this is groundwork, not wired up).
