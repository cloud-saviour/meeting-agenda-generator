import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { PublishedAgendaService } from './published-agenda.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AgendaSnapshot } from '../models/agenda.models';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * PublishedAgendaService is Firestore-backed — one document per meeting at
 * `publishedAgendas/{meetingId}` — specifically because its whole purpose
 * (a non-admin viewing a published agenda on their own device) can't work
 * on localStorage. Run via `npm run test:emulator` with the emulator
 * already running.
 *
 * isAdmin() requires the `admin` custom claim, not just an authenticated uid
 * (see firestore.rules) — authenticatedContext()'s second argument simulates
 * that claim directly, no Firestore fixture document needed. isAppAdmin()
 * also recognizes a Firestore-granted appAdmins/{uid} entry (see
 * AuthService/AppAdminService) — full parity with isAdmin() for this
 * collection, per firestore.rules.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    function isGrantedAdmin() {
      return request.auth != null &&
        exists(/databases/$(database)/documents/appAdmins/$(request.auth.uid));
    }
    function isAppAdmin() {
      return isAdmin() || isGrantedAdmin();
    }
    match /appAdmins/{uid} {
      allow read: if request.auth != null && (request.auth.uid == uid || isAdmin());
      allow write: if isAdmin();
    }
    match /publishedAgendas/{meetingId} {
      allow read: if request.auth != null;
      allow write: if isAppAdmin();
    }
    match /auditLog/{entryId} {
      allow read: if isAdmin();
      allow create: if isAppAdmin();
      allow update, delete: if false;
    }
  }
}
`;

function makeSnapshot(overrides: Partial<AgendaSnapshot> = {}): AgendaSnapshot {
  return {
    no: '160',
    date: '2026-08-29',
    arr: '18:30',
    st: '19:00',
    theme: 'Resilience',
    word: 'perseverance',
    club: "King's Speakers Club #12",
    sub: 'Agora Speakers',
    addr: '123 Main Street',
    mission: 'To provide a supportive environment.',
    vpe: 'Jane Doe',
    hotSeat: 'John Smith',
    reserve: 'Reserve Speaker',
    apologies: 'None',
    period: 'Q3',
    web: 'https://example.com',
    fb: 'https://facebook.com/example',
    agItems: [],
    spks: [],
    cmt: [],
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor() timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function fakeAuth(uid: string, email: string): AuthService {
  return { currentUser: () => ({ uid, email }) } as unknown as AuthService;
}

describe('PublishedAgendaService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let firestore: Firestore;
  let parentInjector: Injector;
  const createdServices: PublishedAgendaService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-published-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    firestore = testEnv.authenticatedContext('test-admin-uid', { admin: true }).firestore() as unknown as Firestore;
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    // Fetched fresh per test, not once in beforeAll: TestBed destroys its
    // environment injector after every test, and PublishedAgendaService's
    // effect() (opening/closing the collection listener as auth changes)
    // needs a live DestroyRef from this injector's ancestor chain — a stale
    // parentInjector throws NG0205 from the second test onward. Same
    // reasoning as checkin-state.service.emulator.spec.ts.
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterEach(() => {
    for (const service of createdServices) service.ngOnDestroy();
    createdServices.length = 0;
  });

  function createService(firestoreInstance: Firestore = firestore, authUid = 'test-admin-uid', authEmail = 'test-admin@example.com'): PublishedAgendaService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        PublishedAgendaService,
        { provide: FIRESTORE, useValue: firestoreInstance },
        { provide: AuthService, useValue: fakeAuth(authUid, authEmail) },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(PublishedAgendaService);
    createdServices.push(service);
    return service;
  }

  it('publish() followed by loadMeeting() with the same meeting id round-trips the snapshot', async () => {
    const service = createService();
    const snapshot = makeSnapshot({ theme: 'Resilience' });

    await service.publish('160', snapshot);
    service.loadMeeting('160');

    await waitFor(() => service.current() !== null);
    expect(service.current()).toMatchObject(snapshot);
  });

  it('refetch() does a real one-time read and updates current() — no loadMeeting() listener needed', async () => {
    const service = createService();
    const snapshot = makeSnapshot({ no: '160', theme: 'Fetched Directly' });
    await service.publish('160', snapshot);

    // Deliberately never call loadMeeting() — current() should still be
    // populated purely from the one-time refetch() call.
    expect(service.current()).toBeNull();
    await service.refetch('160');
    expect(service.current()).toMatchObject(snapshot);
  });

  // A published agenda carries names plus the committee footer's emails and
  // phone numbers, so reading it requires being signed in — /preview is behind
  // memberGuard for the same reason. This is the rule-level half of that: the
  // guard alone would still leave the data fetchable straight from the API.
  it('rejects reads from an unauthenticated client, but allows any signed-in account', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'Members Only' }));

    const anonDb = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    await expect(getDocs(collection(anonDb, 'publishedAgendas'))).rejects.toThrow();

    // A plain member — no admin claim, no appAdmins grant — can still read.
    const memberDb = testEnv.authenticatedContext('plain-member-uid').firestore() as unknown as Firestore;
    const readable = await getDocs(collection(memberDb, 'publishedAgendas'));
    expect(readable.docs.map((d) => d.id)).toEqual(['160']);
  });

  it('refetch() for a meeting that was never published sets current() to null', async () => {
    const service = createService();
    await service.refetch('999');
    expect(service.current()).toBeNull();
  });

  it('loadMeeting() for a meeting id that was never published sets current() to null', async () => {
    const service = createService();

    service.loadMeeting('999');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.current()).toBeNull();
  });

  it('isolates two different meeting ids from each other', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160' }));
    service.loadMeeting('160');
    await waitFor(() => service.current() !== null);

    service.loadMeeting('161');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.current()).toBeNull();
  });

  it('publishing a new meeting un-publishes whatever was previously published', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', date: '2026-08-29', theme: 'Earlier' }));
    await waitFor(() => service.entries().length === 1);

    await service.publish('161', makeSnapshot({ no: '161', date: '2026-09-15', theme: 'Later' }));
    await waitFor(() => service.entries()[0]?.no === '161');

    expect(service.entries().length).toBe(1);
    expect(service.entries()[0].no).toBe('161');
  });

  it("publishing a new meeting deletes the previously-published meeting's document, not just its index entry", async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'Earlier' }));
    await service.publish('161', makeSnapshot({ no: '161', theme: 'Later' }));

    service.loadMeeting('160');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.current()).toBeNull();
  });

  it('a component still watching a meeting via loadMeeting() sees current() go to null after a different meeting is published', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'Earlier' }));
    service.loadMeeting('160');
    await waitFor(() => service.current() !== null);

    await service.publish('161', makeSnapshot({ no: '161', theme: 'Later' }));

    await waitFor(() => service.current() === null);
  });

  it('republishing the same meeting number upserts the index entry rather than duplicating', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'First' }));
    await waitFor(() => service.entries().length === 1);

    await service.publish('160', makeSnapshot({ no: '160', theme: 'Second' }));
    await waitFor(() => service.entries()[0]?.theme === 'Second');

    expect(service.entries().length).toBe(1);
  });

  it('unpublish() removes the doc, leaving entries()/nearestEntry() empty', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'First' }));
    await waitFor(() => service.entries().length === 1);

    await service.unpublish('160');
    await waitFor(() => service.entries().length === 0);

    expect(service.nearestEntry()).toBeNull();
  });

  it('unpublish() is a no-op for a meeting that was never published', async () => {
    const service = createService();
    await service.unpublish('999');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.entries().length).toBe(0);
  });

  it('nearestEntry() is null when nothing has ever been published', async () => {
    const service = createService();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.nearestEntry()).toBeNull();
  });

  it('nearestEntry() picks the published meeting when its date is upcoming (today-or-later)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // real setTimeout for waitFor() to keep polling
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = createService();
      await service.publish('160', makeSnapshot({ no: '160', date: '2026-09-05', theme: 'Near Future' }));

      await waitFor(() => service.entries().length === 1);
      expect(service.nearestEntry()?.no).toBe('160');
    } finally {
      vi.useRealTimers();
    }
  });

  it("nearestEntry() falls back to the published meeting even when its date is in the past", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // real setTimeout for waitFor() to keep polling
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = createService();
      await service.publish('159', makeSnapshot({ no: '159', date: '2026-08-01', theme: 'Past' }));

      await waitFor(() => service.entries().length === 1);
      expect(service.nearestEntry()?.no).toBe('159');
    } finally {
      vi.useRealTimers();
    }
  });

  it("nearestEntry() treats today's date as upcoming, not past", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // real setTimeout for waitFor() to keep polling
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = createService();
      await service.publish('160', makeSnapshot({ no: '160', date: '2026-08-31', theme: 'Today' }));

      await waitFor(() => service.entries().length === 1);
      expect(service.nearestEntry()?.no).toBe('160');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows writes from a Firestore-granted admin with no real claim — isAppAdmin() takes effect, not just isAdmin()', async () => {
    await setDoc(doc(firestore, 'appAdmins', 'granted-uid'), {
      uid: 'granted-uid',
      email: 'granted@example.com',
      displayName: 'Granted Admin',
      grantedAt: new Date().toISOString(),
      grantedByEmail: 'test-admin@example.com',
    });

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const service = createService(grantedFirestore, 'granted-uid', 'granted@example.com');

    await service.publish('160', makeSnapshot({ no: '160', theme: 'By Granted Admin' }));
    await waitFor(() => service.entries().length === 1);
    expect(service.entries()[0].theme).toBe('By Granted Admin');
  });

  it('publish() and unpublish() each write a matching auditLog entry', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'Resilience' }));
    await waitFor(() => service.entries().length === 1);
    await service.unpublish('160');

    const snap = await getDocs(collection(firestore, 'auditLog'));
    const entries = snap.docs.map((d) => d.data());

    expect(entries.some((e) => e['action'] === 'agenda.publish' && e['summary'].includes('#160'))).toBe(true);
    expect(entries.some((e) => e['action'] === 'agenda.unpublish' && e['summary'].includes('#160'))).toBe(true);
  });

  it('unpublish() on a meeting that was never published does not write an auditLog entry — no-op is not a meaningful action', async () => {
    const service = createService();
    await service.unpublish('999');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const snap = await getDocs(collection(firestore, 'auditLog'));
    expect(snap.docs.length).toBe(0);
  });
});
