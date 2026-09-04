import { InjectionToken, Provider } from '@angular/core';
import { Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { environment } from '../../../environments/environment';

export const FIRESTORE = new InjectionToken<Firestore>('FIRESTORE');

function getOrCreateApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(environment.firebase);
}

export function provideAppFirestore(): Provider {
  return {
    provide: FIRESTORE,
    useFactory: (): Firestore => {
      const app = getOrCreateApp();
      const firestore = getFirestore(app);
      if (environment.useFirestoreEmulator) {
        connectFirestoreEmulator(
          firestore,
          environment.firestoreEmulatorHost,
          environment.firestoreEmulatorPort
        );
      }
      return firestore;
    },
  };
}
