// Promotes (or revokes) one or more EXISTING Firebase Auth users' admin
// status by setting the `admin` custom claim firestore.rules' isAdmin()
// checks — for turning a real member (who already signed up via /signup)
// into an admin or back, without creating/deleting an account and without
// ever touching their password.
//
//   npm run promote:admin -- a@example.com b@example.com c@example.com
//   npm run promote:admin:prod -- a@example.com b@example.com   (set
//     GOOGLE_APPLICATION_CREDENTIALS to a downloaded service-account key
//     first — never commit that file)
//
//   npm run revoke:admin -- a@example.com b@example.com
//   npm run revoke:admin:prod -- a@example.com b@example.com    (removes
//     admin access — everything else about their account is untouched,
//     they keep signing in as a normal member)
//
// Each email is processed independently — one not-found or failed email
// doesn't stop the rest of the list from being processed, but the script
// still exits non-zero afterward if anything failed, so a scripted call
// can detect a partial failure.
//
// The `--` before the emails is npm's own separator for "pass these
// arguments through to the script instead of treating them as npm flags"
// — required either way, not optional. Running the script directly works
// the same way without it: `node scripts/promote-to-admin.mjs a@b.com c@d.com [--prod] [--revoke]`.
// EMAIL=their-email@example.com (single) or EMAILS=a@b.com,c@d.com
// (comma-separated) also still work as a fallback, for scripting/CI
// contexts where an env var is more convenient than args.
//
// Optional: DISPLAY_NAME="Their Real Name" — only touches Auth display
// name if explicitly passed, and only valid with exactly one email (there's
// no sensible single name to apply across a batch). Omitting it leaves
// existing names completely untouched. Unlike scripts/seed-admin-user.mjs
// (which unconditionally overwrites displayName on every run — correct for
// its own seeded dev admin, wrong for someone else's real account), this
// script never overwrites a name you didn't explicitly ask it to set.
//
// Never touches members/{uid} in Firestore — this only ever calls
// Firebase Auth (the custom claim, and optionally displayName). Member
// profiles/history are completely unaffected either way.
//
// A claim only takes effect in a freshly issued ID token — each person
// needs to sign out and back in (or wait for the SDK's periodic silent
// refresh) before the app recognizes it.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const isProd = process.argv.includes('--prod');
const isRevoke = process.argv.includes('--revoke');

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';

// All non-flag CLI arguments, e.g. `npm run promote:admin -- a@b.com c@d.com`
// or `node scripts/promote-to-admin.mjs a@b.com c@d.com --prod`. Falls back
// to EMAILS (comma-separated) or EMAIL (single) env vars for scripting
// contexts that prefer that over args.
const argEmails = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const envEmails = (process.env.EMAILS ?? process.env.EMAIL ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
const EMAILS = [...new Set([...argEmails, ...envEmails])];

if (EMAILS.length === 0) {
  console.error('At least one email is required, e.g.: npm run promote:admin:prod -- member@example.com');
  process.exit(1);
}

const DISPLAY_NAME = process.env.DISPLAY_NAME; // optional — see header comment
if (DISPLAY_NAME && EMAILS.length > 1) {
  console.error('DISPLAY_NAME can only be used with a single email, not a batch — run it separately for that one person.');
  process.exit(1);
}

async function processOne(auth, email) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error(`No account found for ${email} — they need to sign up at /signup first, then re-run this.`);
      return false;
    }
    throw err;
  }

  const isCurrentlyAdmin = !!user.customClaims?.admin;

  if (isRevoke) {
    if (!isCurrentlyAdmin) {
      console.log(`${email} (uid ${user.uid}) is not an admin — nothing to revoke.`);
    } else {
      // Spread any existing claims so this never clobbers a future claim
      // this app doesn't know about yet — it only ever changes `admin`.
      await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: false });
      console.log(`Revoked admin access for ${email} (uid ${user.uid}). They're still a normal signed-in member.`);
    }
  } else if (isCurrentlyAdmin) {
    console.log(`${email} (uid ${user.uid}) is already an admin — no claim change needed.`);
  } else {
    await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
    console.log(`Promoted ${email} (uid ${user.uid}) to admin.`);
  }

  if (DISPLAY_NAME) {
    await auth.updateUser(user.uid, { displayName: DISPLAY_NAME });
    console.log(`Updated display name to "${DISPLAY_NAME}".`);
  }

  return true;
}

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);

  let failures = 0;
  for (const email of EMAILS) {
    const ok = await processOne(auth, email);
    if (!ok) failures++;
  }

  console.log('They must sign out and back in (or wait for their session to silently refresh) before the app recognizes any claim change.');

  if (failures > 0) {
    console.error(`${failures} of ${EMAILS.length} email(s) failed — see errors above.`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Promotion failed:', err);
  process.exit(1);
});
