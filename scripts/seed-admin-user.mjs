// One-time dev bootstrap: creates a known local admin account in the Auth
// emulator for development/testing. Run with `npm run seed:admin` against a
// running emulator (`npm run emulators`). Safe to re-run — the Auth emulator
// returns auth/email-already-in-use for an existing account, which this
// script treats as success rather than an error.

import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';

const EMAIL = 'admin@example.com';
const PASSWORD = 'password123'; // local emulator only — never a real credential

async function main() {
  // apiKey is a placeholder — Firebase Auth's SDK requires one to be present
  // even against the emulator, but connectAuthEmulator() below redirects all
  // Auth traffic locally regardless of its value.
  const app = initializeApp({ projectId: 'meeting-agenda-generator', apiKey: 'emulator-placeholder-api-key' });
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

  try {
    await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
    console.log(`Created admin account: ${EMAIL} / ${PASSWORD}`);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      console.log(`Admin account already exists: ${EMAIL} / ${PASSWORD}`);
    } else {
      throw err;
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
