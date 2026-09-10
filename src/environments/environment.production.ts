/**
 * Production environment — swapped in via angular.json's `production` build
 * configuration fileReplacements. Placeholder: no real Firebase project exists yet,
 * so this still points at the local emulator, identical to environment.ts. Once a
 * real project is created (firebase login + project setup), only the values in this
 * file need to change — no code changes required.
 */

// See environment.ts's identical comment: derived from the browser's own
// hostname (LAN IP included) rather than hardcoded, so this still works
// when reached from another device over LAN, not just from this machine.
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
