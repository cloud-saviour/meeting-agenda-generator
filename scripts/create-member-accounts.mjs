// Admin-provisions one or more self-service member accounts directly —
// creates the Firebase Auth account AND the matching `members/{uid}`
// Firestore profile (the same two writes SignupComponent/MemberProfileService
// do for someone signing up themselves at /signup), for onboarding an
// existing roster without asking each person to visit /signup on their own.
//
//   npm run create:members -- "a@example.com:Alice Smith" "b@example.com:Bob Jones"
//   npm run create:members:prod -- "a@example.com:Alice Smith"   (set
//     GOOGLE_APPLICATION_CREDENTIALS to a downloaded service-account key
//     first — never commit that file)
//
// Each argument is one person as `email:Display Name` (quote it so the
// space in the name stays one shell argument). The `--` before the list is
// npm's own separator for "pass these through to the script" — required,
// not optional. MEMBERS="a@b.com:Alice Smith,c@d.com:Carol Jones" (comma-
// separated pairs) also works as a fallback, for scripting/CI contexts
// where an env var is more convenient than args.
//
// No real password is ever set, printed, or logged — this script generates
// a random throwaway one internally purely because Firebase Auth requires
// createUser() to be given *some* password, then immediately generates a
// password-reset link (via the Admin SDK, not email) and prints that
// instead. You send that link to the person yourself (email/chat/however
// you'd reach them) so THEY set their own real password — nobody else,
// including whoever runs this script, ever knows or handles it.
//
// Each email is processed independently — one failure doesn't stop the
// rest of the list — but the script still exits non-zero afterward if
// anything failed, so a scripted call can detect a partial failure.
// Re-running with an email that already has an account is safe: the
// existing Auth account is left untouched (no new reset link is generated
// for them, since they may already have a password), and an existing
// `members/{uid}` profile is never overwritten, so this never clobbers a
// name someone has since edited on their own dashboard.
//
// Uses firebase-admin, not the client SDK — creating another person's
// account and writing their Firestore profile on their behalf are both
// operations an unprivileged client could never legitimately perform (see
// scripts/seed-admin-user.mjs for the same reasoning around custom claims).

import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const isProd = process.argv.includes('--prod');

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';

function parsePair(raw) {
  const idx = raw.indexOf(':');
  if (idx === -1) return null;
  const email = raw.slice(0, idx).trim();
  const name = raw.slice(idx + 1).trim();
  if (!email || !name) return null;
  return { email, name };
}

const argPairs = process.argv.slice(2).filter((arg) => !arg.startsWith('--')).map(parsePair);
const envPairs = (process.env.MEMBERS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map(parsePair);

const allPairs = [...argPairs, ...envPairs];
if (allPairs.some((p) => p === null)) {
  console.error('Every entry must be "email:Display Name", e.g.: npm run create:members -- "member@example.com:Jane Doe"');
  process.exit(1);
}

const MEMBERS = allPairs;
if (MEMBERS.length === 0) {
  console.error('At least one "email:Display Name" entry is required, e.g.: npm run create:members -- "member@example.com:Jane Doe"');
  process.exit(1);
}

async function processOne(auth, firestore, { email, name }) {
  let uid;
  let isNewAccount = false;

  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    console.log(`${email} already has an account (uid ${uid}) — leaving it untouched, no reset link generated.`);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    const throwawayPassword = randomBytes(24).toString('base64url'); // never printed, logged, or reused — see header comment
    const created = await auth.createUser({ email, password: throwawayPassword, displayName: name });
    uid = created.uid;
    isNewAccount = true;
    console.log(`Created account for ${email} (uid ${uid}).`);
  }

  const profileRef = firestore.collection('members').doc(uid);
  const profileSnap = await profileRef.get();
  if (profileSnap.exists) {
    console.log(`members/${uid} profile already exists — left untouched.`);
  } else {
    const now = new Date().toISOString();
    await profileRef.set({ uid, email, displayName: name, createdAt: now, updatedAt: now });
    console.log(`Created members/${uid} profile for ${email}.`);
  }

  if (isNewAccount) {
    const resetLink = await auth.generatePasswordResetLink(email);
    console.log(`Send this link to ${email} so they can set their own password:\n  ${resetLink}`);
  }

  return true;
}

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  let failures = 0;
  for (const member of MEMBERS) {
    try {
      await processOne(auth, firestore, member);
    } catch (err) {
      console.error(`Failed for ${member.email}:`, err.message ?? err);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`${failures} of ${MEMBERS.length} member(s) failed — see errors above.`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Account creation failed:', err);
  process.exit(1);
});
