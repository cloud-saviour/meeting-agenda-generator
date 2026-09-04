/**
 * Default environment — used by plain `ng serve`/`npm start` (no --configuration flag)
 * and by `ng build --configuration development`. Currently emulator-only: no real
 * Firebase project exists yet, so `firebase.projectId` just needs to match `.firebaserc`
 * and `firebase.json`'s emulator config, not a real cloud project.
 */
export const environment = {
  firebase: {
    projectId: 'meeting-agenda-generator',
  },
  useFirestoreEmulator: true,
  firestoreEmulatorHost: '127.0.0.1',
  firestoreEmulatorPort: 8080, // must match firebase.json's emulators.firestore.port
};
