import { InjectionToken, Provider } from '@angular/core';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { environment } from '../../../environments/environment';

export const AUTH = new InjectionToken<Auth>('AUTH');

function getOrCreateApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(environment.firebase);
}

export function provideAppAuth(): Provider {
  return {
    provide: AUTH,
    useFactory: (): Auth => {
      const app = getOrCreateApp();
      const auth = getAuth(app);
      if (environment.useAuthEmulator) {
        connectAuthEmulator(
          auth,
          `http://${environment.authEmulatorHost}:${environment.authEmulatorPort}`,
          { disableWarnings: true }
        );
      }
      return auth;
    },
  };
}
