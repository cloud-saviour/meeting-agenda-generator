// One-time backfill for the shared `meetings/{meetingNo}` header collection
// (Phase 1 of the data-model cleanup — see CLAUDE.md). For every meeting
// number that already exists, writes the 7 header fields the agenda editor
// and check-in page both display (date/theme/word/start/club/sub/addr).
//
// Source of truth, in order of preference:
//   1. savedAgendas/{no}   — the agenda itself (its `st` becomes `start`).
//   2. checkins/{no}.meeting — the legacy duplicate the editor used to push;
//      used only for meeting numbers that have no saved agenda.
//
//   npm run migrate:meetings        — local emulator (default).
//   npm run migrate:meetings:prod   — the real project, via Application
//                                     Default Credentials (`gcloud auth
//                                     application-default login`, or
//                                     GOOGLE_APPLICATION_CREDENTIALS — never
//                                     commit a key).
//
// Idempotent and non-destructive: plain id-keyed set() upserts, never
// deletes, and never touches savedAgendas/checkins. Safe to re-run; a re-run
// only re-copies whatever those sources currently hold.
//
// Not strictly required for the app to work — CheckinStateService falls back
// to the legacy `checkins/{no}.meeting` fields when no meetings doc exists —
// but run it BEFORE deploying so every existing meeting has its header
// stored in the new place, which is what lets a later deploy drop the legacy
// duplicate fields safely.
//
// Uses firebase-admin (bypasses firestore.rules by design).

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const isProd = process.argv.includes('--prod');

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';

const str = (v) => (typeof v === 'string' ? v : '');

function fromSavedAgenda(d) {
  return { date: str(d.date), theme: str(d.theme), word: str(d.word), start: str(d.st), club: str(d.club), sub: str(d.sub), addr: str(d.addr) };
}

function fromCheckinMeeting(m) {
  return { date: str(m.date), theme: str(m.theme), word: str(m.word), start: str(m.start), club: str(m.club), sub: str(m.sub), addr: str(m.addr) };
}

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID });
  const firestore = getFirestore(app);

  const saved = await firestore.collection('savedAgendas').get();
  const fromAgendas = new Set();
  for (const d of saved.docs) {
    await firestore.collection('meetings').doc(d.id).set(fromSavedAgenda(d.data()));
    fromAgendas.add(d.id);
  }
  console.log(`Wrote ${saved.size} meetings doc(s) from savedAgendas.`);

  const checkins = await firestore.collection('checkins').get();
  let fromCheckins = 0;
  for (const d of checkins.docs) {
    if (fromAgendas.has(d.id)) continue;
    const meeting = d.data().meeting;
    if (!meeting) continue;
    await firestore.collection('meetings').doc(d.id).set(fromCheckinMeeting(meeting));
    fromCheckins++;
  }
  console.log(`Wrote ${fromCheckins} meetings doc(s) from legacy checkins.meeting (no saved agenda).`);

  console.log('Done. savedAgendas and checkins were left untouched.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
