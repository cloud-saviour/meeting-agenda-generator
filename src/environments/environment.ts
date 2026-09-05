/**
 * Default environment — used by plain `ng serve`/`npm start` (no --configuration flag)
 * and by `ng build --configuration development`. Currently emulator-only: no real
 * Firebase project exists yet, so `firebase.projectId` just needs to match `.firebaserc`
 * and `firebase.json`'s emulator config, not a real cloud project.
 */
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
  firestoreEmulatorHost: '127.0.0.1',
  firestoreEmulatorPort: 8080, // must match firebase.json's emulators.firestore.port
  useAuthEmulator: true,
  authEmulatorHost: '127.0.0.1',
  authEmulatorPort: 9099, // must match firebase.json's emulators.auth.port
};
