// One-off cleanup: archives the generic "Evaluator" MEETING role
// (roleId 'evaluator') in every club. This role duplicates
// "Meeting Evaluator" (roleId 'generalEvaluator') but has no agenda row or
// DOCX table of its own — see CLAUDE.md / the standard-roles.json comment.
// The per-speech evaluator claimed via "Evaluate this speech" on the
// check-in page is unrelated and untouched by this script.
//
// Sets active:false (Archive, not delete) so it can be restored from
// /admin/roles if this was ever relied on. Idempotent: skips a club whose
// role is already inactive or missing.
//
//   npm run archive:generic-evaluator          — local emulator
//   npm run archive:generic-evaluator:prod     — real project, via ADC

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const isProd = process.argv.includes('--prod');
if (!isProd) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';
initializeApp({ projectId: PROJECT_ID });
const firestore = getFirestore();

async function main() {
  const clubs = await firestore.collection('clubs').get();
  for (const club of clubs.docs) {
    const ref = firestore.collection('clubs').doc(club.id).collection('roleDefinitions').doc('evaluator');
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`${club.data().slug}: no "evaluator" role — skipped`);
      continue;
    }
    if (snap.data().active === false) {
      console.log(`${club.data().slug}: already archived`);
      continue;
    }
    await ref.update({ active: false });
    console.log(`${club.data().slug}: archived "evaluator"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
