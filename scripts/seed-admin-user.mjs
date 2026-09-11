// One-time bootstrap: creates a known admin account with the `admin`
// custom claim firestore.rules' isAdmin() checks. Two modes:
//
//   npm run seed:admin        — local emulator (default), idempotent,
//                                safe to re-run any time.
//   npm run seed:admin:prod   — the real project (agenda-planner-101c4),
//                                via Application Default Credentials
//                                (set GOOGLE_APPLICATION_CREDENTIALS to
//                                the downloaded service-account key JSON
//                                before running — never commit that file).
//                                Reads ADMIN_EMAIL/ADMIN_PASSWORD from the
//                                environment instead of using the
//                                dev-only defaults below, since a real
//                                admin credential must never be hardcoded
//                                into a script committed to the repo.
//
// Uses firebase-admin, not the client SDK used elsewhere in scripts/ —
// setCustomUserClaims() is an Admin-SDK-only operation, unavailable to any
// client for the obvious reason that a client must never be able to grant
// itself admin access.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const isProd = process.argv.includes('--prod');

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';

if (isProd && !process.env.ADMIN_EMAIL) {
  console.error('--prod requires ADMIN_EMAIL and ADMIN_PASSWORD env vars — refusing to fall back to the dev defaults for a real account.');
  process.exit(1);
}

const EMAIL = isProd ? process.env.ADMIN_EMAIL : 'admin@example.com';
const PASSWORD = isProd ? process.env.ADMIN_PASSWORD : 'password123'; // dev default — local emulator only, never a real credential
const DISPLAY_NAME = isProd ? (process.env.ADMIN_DISPLAY_NAME || 'Admin') : 'Admin';

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);

  // Never echo the real password to the console/logs in --prod mode —
  // it's already in the caller's own env var, no need to duplicate it
  // into terminal scrollback. The dev default is a throwaway value, so
  // printing it back is harmless and convenient there.
  const credentialSuffix = isProd ? '' : ` / ${PASSWORD}`;

  let uid;
  try {
    const user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: DISPLAY_NAME });
    uid = user.uid;
    console.log(`Created admin account: ${EMAIL}${credentialSuffix}`);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      uid = (await auth.getUserByEmail(EMAIL)).uid;
      console.log(`Admin account already exists: ${EMAIL}${credentialSuffix}`);
    } else {
      throw err;
    }
  }

  // Backfills displayName on a re-run too — earlier versions of this script
  // never set one, so an account seeded before this line existed would
  // otherwise stay permanently nameless (see MemberProfileService's
  // requireDisplayName(), which every UI-driven name write goes through —
  // this is the one path that bypasses it, since it edits the Auth record
  // directly via the Admin SDK, not through the app).
  await auth.updateUser(uid, { displayName: DISPLAY_NAME });

  await auth.setCustomUserClaims(uid, { admin: true });
  console.log(`Ensured the 'admin' custom claim is set for ${uid}.`);
  console.log(`If this account is already signed in anywhere, it must sign out and back in to pick up the claim.`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
