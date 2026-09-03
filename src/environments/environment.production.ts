/**
 * Production environment — swapped in via angular.json's `production` build
 * configuration fileReplacements. Placeholder: no real Firebase project exists yet,
 * so this still points at the local emulator, identical to environment.ts. Once a
 * real project is created (firebase login + project setup), only the values in this
 * file need to change — no code changes required.
 */
export const environment = {
  firebase: {
    projectId: 'meeting-agenda-generator',
  },
  useFirestoreEmulator: true,
  firestoreEmulatorHost: '127.0.0.1',
  firestoreEmulatorPort: 8080, // must match firebase.json's emulators.firestore.port
};
