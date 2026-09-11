# Meeting Agenda Generator

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.3.3.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Deployment

The app is a static Angular SPA that talks directly to Firestore/Auth from
the browser — there's no backend server and no CI/CD. Every deploy is a
manual, explicit step.

**Two independent pieces, deployed separately:**

- **The app** (Firebase Hosting) — `npm run deploy` builds the production
  bundle (`ng build --configuration production`, which bakes the real
  Firebase project config from `src/environments/environment.production.ts`
  into the compiled JS) and uploads it to the `agora-agenda-planner`
  Hosting site (`https://agora-agenda-planner.web.app`). This is what you
  run after any code change that should go live.
- **Firestore security rules** (`firestore.rules`) — `npm run deploy:rules`
  uploads the rules file on its own, no build needed. Only run this when
  `firestore.rules` itself actually changes; rules and app code deploy
  independently.

```bash
npm run deploy          # build + deploy the app (the common case)
npm run deploy:rules    # deploy firestore.rules only
npm run deploy:hosting  # deploy the app without rebuilding (uses whatever's already in dist/)
```

**Why security still holds even though the client-side code is public**:
the compiled JS ships the real `apiKey`/`projectId` (Firebase web API keys
aren't secrets), so `firestore.rules` — not hiding the config — is the
actual gatekeeper for who can read/write each collection.

**First-time project setup** (already done for the current
`agenda-planner-101c4` project, documented here for standing up a new one):
create the Firebase project and enable Firestore + Email/Password Auth in
the [Firebase Console](https://console.firebase.google.com), add a
`"production"` alias to `.firebaserc` pointing at the real project id,
copy the real web config into `environment.production.ts`, then run
`npm run seed:roles:prod` and `npm run seed:admin:prod` (the latter needs
`GOOGLE_APPLICATION_CREDENTIALS` pointing at a downloaded service-account
key, plus `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars — see the script's own
header comment for details) to provision the standard role definitions
and a real admin account before the first deploy.

**Rolling back a bad deploy**: Firebase Hosting keeps a version history —
use the [Console](https://console.firebase.google.com/project/agenda-planner-101c4/hosting/sites)
to roll back to a previous release without needing to rebuild or redeploy.

## Managing admin access

Accounts are provisioned by self-service sign-up at `/signup` — nobody
starts as an admin. To grant or remove admin access for one or more
existing members, use `scripts/promote-to-admin.mjs`. It only ever sets
the `admin` custom claim on their Firebase Auth account; it never
creates or deletes an account, never touches their password, and never
touches their `members/{uid}` profile in Firestore.

```bash
# one email
npm run promote:admin -- their-email@example.com          # emulator
npm run promote:admin:prod -- their-email@example.com      # real project

# a list of emails, space-separated — each is processed independently
npm run promote:admin -- a@example.com b@example.com c@example.com
npm run promote:admin:prod -- a@example.com b@example.com c@example.com

npm run revoke:admin -- their-email@example.com            # emulator
npm run revoke:admin:prod -- their-email@example.com        # real project
npm run revoke:admin -- a@example.com b@example.com c@example.com
```

The `--` before the email list is npm's own separator for "pass these
through to the script" — it's required, not optional. Against `--prod`,
set `GOOGLE_APPLICATION_CREDENTIALS` to a downloaded service-account key
first (never commit that file).

With a batch, one email that has no account (or otherwise fails) is
reported and skipped — it doesn't stop the rest of the list — but the
command still exits non-zero afterward if anything failed, so a script
calling this can detect a partial failure. Both commands are safe to
re-run: promoting an existing admin, or revoking someone who isn't one,
just logs that there's nothing to do instead of erroring. A claim only
takes effect in a freshly issued ID token, so each person needs to sign
out and back in (or wait for their session to silently refresh) before
the app recognizes the change.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
