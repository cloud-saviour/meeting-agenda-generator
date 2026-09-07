import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { AttendanceConfirmationService } from './attendance-confirmation.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * Admin-only "mark register"/confirm actions — run against the real
 * Firestore emulator, per this project's convention that transactional/
 * rules-sensitive Firestore logic is never tested against a hand-rolled
 * mock. isAdmin() requires the `admin` custom claim, not just an
 * authenticated uid (see firestore.rules) — authenticatedContext()'s
 * second argument simulates that claim directly, same pattern as
 * role-definition.service.emulator.spec.ts.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /memberHistory/{recordId} {
      allow read: if request.auth != null && (isAdmin() || request.auth.uid == resource.data.uid);
      allow write: if isAdmin();
    }
  }
}
`;

const META = { date: '2026-01-01', theme: 'Test Meeting' };

describe('AttendanceConfirmationService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let adminFirestore: Firestore;
  let parentInjector: Injector;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-attendance-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    adminFirestore = testEnv.authenticatedContext('admin-uid', { admin: true }).firestore() as unknown as Firestore;
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  function createService(firestore: Firestore): AttendanceConfirmationService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [AttendanceConfirmationService, { provide: FIRESTORE, useValue: firestore }],
    });
    return child.get(AttendanceConfirmationService);
  }

  it('confirmAttendance() then unconfirmAttendance() round-trips attended on the {meetingId}_{uid} doc', async () => {
    const service = createService(adminFirestore);
    await service.confirmAttendance('m1', 'member-1', META);

    let snap = await getDoc(doc(adminFirestore, 'memberHistory', 'm1_member-1'));
    expect(snap.data()?.['attended']).toBe(true);

    await service.unconfirmAttendance('m1', 'member-1');
    snap = await getDoc(doc(adminFirestore, 'memberHistory', 'm1_member-1'));
    expect(snap.data()?.['attended']).toBe(false);
  });

  it('confirmRole()/unconfirmRole() add/remove one role id without disturbing sibling fields', async () => {
    const service = createService(adminFirestore);
    await service.confirmAttendance('m1', 'member-1', META);
    await service.confirmRole('m1', 'member-1', 'toastmaster', META);
    await service.confirmRole('m1', 'member-1', 'grammarian', META);

    let snap = await getDoc(doc(adminFirestore, 'memberHistory', 'm1_member-1'));
    expect(snap.data()?.['rolesConfirmed']).toEqual(expect.arrayContaining(['toastmaster', 'grammarian']));
    expect(snap.data()?.['attended']).toBe(true); // untouched by the role confirms

    await service.unconfirmRole('m1', 'member-1', 'toastmaster');
    snap = await getDoc(doc(adminFirestore, 'memberHistory', 'm1_member-1'));
    expect(snap.data()?.['rolesConfirmed']).toEqual(['grammarian']);
  });

  it('confirmEvaluation() keys the record by the evaluator uid, not the speaker uid', async () => {
    const service = createService(adminFirestore);
    await service.confirmEvaluation('m1', 'evaluator-uid', 'speaker-1', META);

    const evaluatorSnap = await getDoc(doc(adminFirestore, 'memberHistory', 'm1_evaluator-uid'));
    expect(evaluatorSnap.data()?.['evaluatedSpeakerId']).toBe('speaker-1');

    const speakerSnap = await getDoc(doc(adminFirestore, 'memberHistory', 'm1_speaker-1'));
    expect(speakerSnap.exists()).toBe(false);
  });

  it('loadForMeeting() returns exactly the records for that meeting, keyed by uid', async () => {
    const service = createService(adminFirestore);
    await service.confirmAttendance('m1', 'member-1', META);
    await service.confirmAttendance('m1', 'member-2', META);
    await service.confirmAttendance('m2', 'member-1', META); // different meeting — must be excluded

    await service.loadForMeeting('m1');
    const map = service.confirmationsForCurrentMeeting();
    expect([...map.keys()].sort()).toEqual(['member-1', 'member-2']);
    expect(map.get('member-1')?.meetingId).toBe('m1');
  });

  it('rejects a non-admin authenticated write, but allows read of their own record and admin read of any record', async () => {
    // seed as admin first
    const adminService = createService(adminFirestore);
    await adminService.confirmAttendance('m1', 'member-1', META);

    const memberFirestore = testEnv.authenticatedContext('member-1').firestore() as unknown as Firestore;
    await expect(
      setDoc(doc(memberFirestore, 'memberHistory', 'm1_member-1'), { meetingId: 'm1', uid: 'member-1', attended: true })
    ).rejects.toThrow();

    // the member CAN read their own record
    const ownSnap = await getDoc(doc(memberFirestore, 'memberHistory', 'm1_member-1'));
    expect(ownSnap.data()?.['attended']).toBe(true);

    // a different signed-in member cannot read someone else's record
    const strangerFirestore = testEnv.authenticatedContext('stranger-uid').firestore() as unknown as Firestore;
    await expect(getDoc(doc(strangerFirestore, 'memberHistory', 'm1_member-1'))).rejects.toThrow();
  });
});
