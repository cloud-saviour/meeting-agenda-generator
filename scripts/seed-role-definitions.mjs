// One-time bootstrap: populates the roleDefinitions collection with this
// club's standard meeting-role and committee-role lists — both kinds now
// live in this one collection, discriminated by `kind: 'meeting' |
// 'committee'` (see RoleDefinitionService). Two modes:
//
//   npm run seed:roles        — local emulator (default).
//   npm run seed:roles:prod   — the real project (agenda-planner-101c4),
//                                via Application Default Credentials (set
//                                GOOGLE_APPLICATION_CREDENTIALS to the
//                                downloaded service-account key JSON
//                                first — never commit that file).
//
// Safe to re-run in either mode — skips a kind entirely if any document of
// that kind already exists, so it never clobbers roles you've since edited
// via the admin UI. Checked PER KIND, not per collection — now that both
// kinds share one collection, "the collection already has documents" would
// otherwise wrongly skip seeding committee roles just because meeting
// roles (or vice versa) already exist. This is the only place these role
// lists exist now; the app itself has no hardcoded fallback.
//
// Uses firebase-admin, not the client SDK — firestore.rules requires
// isAdmin() to write this collection (see scripts/seed-admin-user.mjs),
// and the Admin SDK bypasses security rules by design, same reasoning as
// that script.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const isProd = process.argv.includes('--prod');

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';
const COLLECTION = 'roleDefinitions';

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

async function seedKind(firestore, kind, roles) {
  const ref = firestore.collection(COLLECTION);
  const existing = await ref.where('kind', '==', kind).limit(1).get();
  if (!existing.empty) {
    console.log(`Skipping kind "${kind}" — "${COLLECTION}" already has at least one document of this kind.`);
    return;
  }
  for (const role of roles) {
    const { id, ...data } = role;
    await ref.doc(id).set({ ...data, kind });
  }
  console.log(`Seeded ${roles.length} "${kind}" role(s) into "${COLLECTION}".`);
}

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID });
  const firestore = getFirestore(app);

  await seedKind(firestore, 'meeting', MEETING_ROLES);
  await seedKind(firestore, 'committee', COMMITTEE_ROLES);

  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
