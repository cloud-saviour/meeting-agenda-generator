// One-time dev bootstrap: populates the Firestore emulator's roleDefinitions
// and committeeRoleDefinitions collections with this club's standard role
// list. Run with `npm run seed:roles` against a running emulator
// (`npm run emulators`). Safe to re-run — skips any collection that already
// has documents, so it never clobbers roles you've since edited via the
// admin UI. This is the only place these role lists exist now; the app
// itself has no hardcoded fallback.

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  getDocs,
  doc,
  setDoc,
} from 'firebase/firestore';

const MEETING_ROLES = [
  { id: 'toastmaster', label: 'Evening Chairman', order: 0, active: true },
  { id: 'generalEvaluator', label: 'Meeting Evaluator', order: 1, active: true },
  { id: 'grammarian', label: 'Grammarian', order: 2, active: true },
  { id: 'timer', label: 'Timekeeper', order: 3, active: true },
  { id: 'ahCounter', label: 'Filler Word Counter', order: 4, active: true },
  { id: 'evaluationChairman', label: 'Evaluation Chairman', order: 5, active: true },
  { id: 'impromptuMaster', label: 'Impromptu Master', order: 6, active: true },
  { id: 'evaluator', label: 'Evaluator', order: 7, active: true },
];

const COMMITTEE_ROLES = [
  { id: 'president', label: 'President', order: 0, active: true },
  { id: 'secretary', label: 'Secretary', order: 1, active: true },
  { id: 'vpEducation', label: 'VP Education', order: 2, active: true },
  { id: 'communityManager', label: 'Community Manager', order: 3, active: true },
  { id: 'vpMembership', label: 'VP Membership', order: 4, active: true },
  { id: 'rsaAmbassador', label: 'RSA Ambassador', order: 5, active: true },
  { id: 'treasurer', label: 'Treasurer', order: 6, active: true },
];

async function seedCollection(firestore, collectionName, roles) {
  const ref = collection(firestore, collectionName);
  const existing = await getDocs(ref);
  if (!existing.empty) {
    console.log(`Skipping "${collectionName}" — already has ${existing.size} document(s).`);
    return;
  }
  for (const role of roles) {
    const { id, ...data } = role;
    await setDoc(doc(ref, id), data);
  }
  console.log(`Seeded "${collectionName}" with ${roles.length} role(s).`);
}

async function main() {
  const app = initializeApp({ projectId: 'meeting-agenda-generator' });
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);

  await seedCollection(firestore, 'roleDefinitions', MEETING_ROLES);
  await seedCollection(firestore, 'committeeRoleDefinitions', COMMITTEE_ROLES);

  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
