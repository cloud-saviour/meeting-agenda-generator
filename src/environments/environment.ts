/**
 * Default environment — used by plain `ng serve`/`npm start` (no --configuration flag)
 * and by `ng build --configuration development`. Currently emulator-only: no real
 * Firebase project exists yet, so `firebase.projectId` just needs to match `.firebaserc`
 * and `firebase.json`'s emulator config, not a real cloud project.
 */

// The emulator host is derived from whatever host the browser actually used
// to load this app, not hardcoded to '127.0.0.1' — that only ever means
// "the emulator, from this same machine's dev session". Reached from a
// phone over LAN (`npm run serve:mobile`, which serves on the machine's LAN
// IP), '127.0.0.1' would resolve to the PHONE itself, not this machine, and
// every Firestore/Auth call would silently fail even though the page loads
// fine. `window.location.hostname` is 'localhost' for a normal `ng serve`
// session and the LAN IP (e.g. 192.168.x.x) when opened from another
// device — either way it's the same machine running the emulators, reached
// however the browser itself got here. Falls back to '127.0.0.1' when
// `window` doesn't exist yet (this module can be evaluated during a
// server-side/build-time context before a browser is involved).
const emulatorHost = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';

export const environment = {
  firebase: {
    projectId: 'meeting-agenda-generator',
    // Firebase Auth's SDK requires an apiKey to be present even against the
    // emulator (Firestore's SDK has no such check) — this placeholder is
    // never sent anywhere real, since connectAuthEmulator() redirects all
    // Auth traffic to the local emulator regardless of this value.
    apiKey: 'emulator-placeholder-api-key',
  },
  useFirestoreEmulator: true,
  firestoreEmulatorHost: emulatorHost,
  firestoreEmulatorPort: 8080, // must match firebase.json's emulators.firestore.port
  useAuthEmulator: true,
  authEmulatorHost: emulatorHost,
  authEmulatorPort: 9099, // must match firebase.json's emulators.auth.port
};
