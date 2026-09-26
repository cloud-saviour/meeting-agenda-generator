// One-time backfill: gives every existing self-service member (members/{uid})
// an ACTIVE membership in one club, so people who were already using the app
// keep landing in their club after club membership is introduced. Without it,
// all existing members would start with no club.
//
//   npm run backfill:memberships                      — local emulator, club "kings-speakers-12"
//   npm run backfill:memberships -- --club=my-club    — another club
//   npm run backfill:memberships:prod                 — the real project (Application Default Credentials)
//
// Idempotent and additive: it never overwrites a membership row that already
// exists (so a rejection or removal an admin made is respected), and never
// touches `members`. Uses firebase-admin, so it bypasses firestore.rules.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const isProd = process.argv.includes('--prod');
if (!isProd) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const SLUG = process.argv.find((a) => a.startsWith('--club='))?.slice(7) ?? 'kings-speakers-12';
initializeApp({ projectId: isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator' });
const db = getFirestore();

async function main() {
  const pointer = await db.collection('clubSlugs').doc(SLUG).get();
  if (!pointer.exists) {
    console.error(`No club with slug "${SLUG}".`);
    process.exit(1);
  }
  const club = db.collection('clubs').doc(pointer.data().clubId);
  const now = new Date().toISOString();

  let created = 0;
  let skipped = 0;
  for (const m of (await db.collection('members').get()).docs) {
    const ref = club.collection('memberships').doc(m.id);
    if ((await ref.get()).exists) {
      skipped++;
      continue;
    }
    const p = m.data();
    await ref.set({
      uid: m.id,
      email: p.email ?? '',
      displayName: p.displayName || p.email || m.id,
      status: 'active',
      requestedAt: p.createdAt ?? now,
      decidedAt: now,
      decidedByUid: null,
      decidedByEmail: 'scripts/backfill-memberships.mjs',
    });
    created++;
  }
  console.log(`Club "${SLUG}": created ${created} active membership(s), skipped ${skipped} that already existed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
