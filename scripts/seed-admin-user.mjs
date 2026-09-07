// One-time dev bootstrap: creates a known local admin account in the Auth
// emulator, with the `admin` custom claim firestore.rules' isAdmin() checks,
// for development/testing. Run with `npm run seed:admin` against a running
// emulator (`npm run emulators`). Safe to re-run — idempotent on both the
// Auth account and the claim.
//
// Uses firebase-admin, not the client SDK used elsewhere in scripts/ —
// setCustomUserClaims() is an Admin-SDK-only operation, unavailable to any
// client for the obvious reason that a client must never be able to grant
// itself admin access. Pointing the Admin SDK at the emulators (via the env
// vars below) needs no real service-account credentials — this is the
// standard way to use firebase-admin for local emulator-only tooling.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const EMAIL = 'admin@example.com';
const PASSWORD = 'password123'; // local emulator only — never a real credential
const DISPLAY_NAME = 'Admin';

async function main() {
  const app = initializeApp({ projectId: 'meeting-agenda-generator' });
  const auth = getAuth(app);

  let uid;
  try {
    const user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: DISPLAY_NAME });
    uid = user.uid;
    console.log(`Created admin account: ${EMAIL} / ${PASSWORD}`);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      uid = (await auth.getUserByEmail(EMAIL)).uid;
      console.log(`Admin account already exists: ${EMAIL} / ${PASSWORD}`);
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
