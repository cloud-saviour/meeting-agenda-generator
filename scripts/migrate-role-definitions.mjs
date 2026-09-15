// One-time migration: merges the standalone `committeeRoleDefinitions`
// collection into `roleDefinitions` (tagging each copied doc
// `kind: 'committee'`, preserving its exact id — role ids are stable keys
// referenced elsewhere, see CLAUDE.md), and backfills `kind: 'meeting'`
// onto any existing `roleDefinitions` doc that predates this merge and
// has no `kind` field yet. RoleDefinitionService's own read path already
// defaults a missing `kind` to 'meeting', so this backfill isn't required
// for the app to work correctly — it's here so the stored data is honest
// (not silently relying on that fallback forever) and so anything that
// ever queries `where('kind','==','meeting')` directly (e.g.
// seed-role-definitions.mjs's own idempotency check) sees the real count.
//
//   npm run migrate:role-definitions        — local emulator (default).
//   npm run migrate:role-definitions:prod   — the real project, via
//                                              Application Default
//                                              Credentials (set
//                                              GOOGLE_APPLICATION_CREDENTIALS
//                                              first — never commit that key).
//
// Idempotent and safe to re-run: every write is a plain upsert (set(),
// not create()) keyed by the role's own stable id, so re-running just
// re-copies/re-tags the same current state — it can never duplicate a
// role or clobber an edit made through the admin UI after a previous run,
// since the source of truth for each field is always whatever
// committeeRoleDefinitions/roleDefinitions itself currently holds, not
// anything cached by this script between runs.
//
// The OLD `committeeRoleDefinitions` collection is left in place,
// untouched, after this runs — this script only ever reads from it, never
// deletes from it. Deleting it is a deliberate later step, once the merge
// is confirmed working in production, not part of this pass (see
// CLAUDE.md's Phase 0 notes).
//
// Uses firebase-admin, not the client SDK — same reasoning as every other
// script here that writes roleDefinitions: firestore.rules requires
// isAppAdmin(), and the Admin SDK bypasses security rules by design.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const isProd = process.argv.includes('--prod');

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';

async function copyCommitteeRoles(firestore) {
  const source = await firestore.collection('committeeRoleDefinitions').get();
  if (source.empty) {
    console.log('No documents in "committeeRoleDefinitions" — nothing to copy.');
    return;
  }
  for (const docSnap of source.docs) {
    await firestore
      .collection('roleDefinitions')
      .doc(docSnap.id)
      .set({ ...docSnap.data(), kind: 'committee' });
  }
  console.log(`Copied ${source.size} committee role(s) into "roleDefinitions" (kind: 'committee').`);
}

async function backfillMeetingKind(firestore) {
  const all = await firestore.collection('roleDefinitions').get();
  const missingKind = all.docs.filter((d) => !d.data().kind);
  if (missingKind.length === 0) {
    console.log('No "roleDefinitions" documents missing "kind" — nothing to backfill.');
    return;
  }
  for (const docSnap of missingKind) {
    await docSnap.ref.set({ kind: 'meeting' }, { merge: true });
  }
  console.log(`Backfilled kind: 'meeting' onto ${missingKind.length} pre-existing "roleDefinitions" document(s).`);
}

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID });
  const firestore = getFirestore(app);

  await copyCommitteeRoles(firestore);
  await backfillMeetingKind(firestore);

  console.log('Done. "committeeRoleDefinitions" was left untouched — safe to delete later once the merge is confirmed working.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
