/**
 * Production environment — swapped in via angular.json's `production` build
 * configuration fileReplacements. Points at the real Firebase project
 * (agenda-planner-101c4). These values (apiKey included) are safe to commit —
 * Firebase web API keys aren't secrets, security is enforced by firestore.rules,
 * not by hiding this config.
 */
export const environment = {
  firebase: {
    apiKey: 'AIzaSyCpHVaAEbCDS6sFRXQcpCaVGT5bU_HtFHY',
    authDomain: 'agenda-planner-101c4.firebaseapp.com',
    projectId: 'agenda-planner-101c4',
    storageBucket: 'agenda-planner-101c4.firebasestorage.app',
    messagingSenderId: '795918635364',
    appId: '1:795918635364:web:09eac34fc8e4192480ea71',
  },
  useFirestoreEmulator: false,
  firestoreEmulatorHost: '',
  firestoreEmulatorPort: 8080,
  useAuthEmulator: false,
  authEmulatorHost: '',
  authEmulatorPort: 9099,
};
