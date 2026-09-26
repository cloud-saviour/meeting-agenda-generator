// Multi-club groundwork: provisions the club scripts/seed-*.mjs and the app
// itself now assume exists, and copies every existing flat, top-level
// collection forward into that club's own `clubs/{clubId}/<name>/{same id}`
// subcollections — see CLAUDE.md's multi-club groundwork section and
// firestore.rules' header comment for the full design.
//
//   npm run migrate:to-clubs        — local emulator (default). Run this
//                                      BEFORE npm run seed:roles/seed:test-data
//                                      on a fresh emulator — those scripts
//                                      now write under clubs/{clubId}/...,
//                                      which doesn't exist until this runs
//                                      at least once.
//   npm run migrate:to-clubs:prod   — the real project (agenda-planner-101c4),
//                                      via Application Default Credentials
//                                      (set GOOGLE_APPLICATION_CREDENTIALS to
//                                      the downloaded service-account key
//                                      JSON first — never commit that file).
//
// Idempotent and non-destructive, same convention as
// scripts/migrate-role-definitions.mjs: every write is a plain id-keyed
// upsert, and the OLD flat collections are never deleted or mutated — only
// ever read from. Safe to re-run any time; a re-run on an already-migrated
// environment just re-copies whatever's currently in the flat collections
// (harmless — the app itself no longer reads from them once the club-scoped
// bundle is deployed) and leaves the club/slug docs untouched if they
// already exist (never overwrites branding you've since edited via a
// future admin UI).
//
// `members/{uid}` is deliberately NOT copied — it stays global, one
// Firebase account independent of any club (see AuthService's class doc).
// `appAdmins`, `memberHistory`, and `auditLog` DO move under the club (see
// firestore.rules) since a grant/confirmed-history/audit-trail is
// genuinely club-scoped data, unlike a login identity.
//
// Uses firebase-admin, not the client SDK — bypasses firestore.rules,
// required since the destination clubs/{clubId}/... paths are
// isAppAdmin(clubId)-write-only and clubs/{clubId} itself has no client
// write path at all in this pass (see firestore.rules).

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const isProd = process.argv.includes('--prod');

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

const PROJECT_ID = isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator';

// The one club this migration provisions — its slug must match
// environment.ts/environment.production.ts's `defaultClubSlug`, since that's
// what bare `/` and the legacy /checkin, /preview redirects resolve to.
// Branding values are exactly what used to be hardcoded directly in
// agenda-state.service.ts's defaultMeeting() before this migration — this
// script is now the one place that content lives, for a fresh environment.
const CLUB_SLUG = 'kings-speakers-12';
const CLUB_BRANDING = {
  slug: CLUB_SLUG,
  name: '"King\'s Speakers" Club #12',
  subLine: 'Phobians,',
  addressLine: '378 Queen\'s Cres, Lynnwood, Pretoria, 0001',
  logoLeft: 'logo.png',
  logoRight: 'crown.png',
  missionStatement:
    'Agora empowers you to become a brilliant communicator and a confident leader who will actively build a better world.',
  website: 'http://www.agoraspeakers.org/',
  facebookPage: 'Agora Speakers South Africa',
  active: true,
};

// Collections copied verbatim (same doc id) from the flat top level into
// clubs/{clubId}/<name>/... — every one of these was already club-scoped
// data in spirit, just not in path, before this pass.
const COPIED_COLLECTIONS = ['checkins', 'roleDefinitions', 'committeeRoster', 'publishedAgendas', 'savedAgendas', 'appAdmins', 'memberHistory', 'checkinContacts', 'auditLog'];

const BATCH_LIMIT = 450; // stay comfortably under Firestore's hard 500-writes-per-batch cap

async function ensureClub(firestore) {
  const slugRef = firestore.collection('clubSlugs').doc(CLUB_SLUG);
  const existingPointer = await slugRef.get();
  if (existingPointer.exists) {
    const clubId = existingPointer.data().clubId;
    console.log(`Club "${CLUB_SLUG}" already provisioned (clubId ${clubId}) — branding left untouched.`);
    return clubId;
  }

  const clubRef = firestore.collection('clubs').doc();
  const clubId = clubRef.id;
  const batch = firestore.batch();
  batch.set(clubRef, { ...CLUB_BRANDING, createdAt: new Date().toISOString() });
  batch.set(slugRef, { clubId });
  await batch.commit();
  console.log(`Provisioned club "${CLUB_SLUG}" (clubId ${clubId}).`);
  return clubId;
}

async function copyCollection(firestore, clubId, name) {
  const source = await firestore.collection(name).get();
  if (source.empty) {
    console.log(`No documents in "${name}" — nothing to copy.`);
    return;
  }

  const destCollection = firestore.collection('clubs').doc(clubId).collection(name);
  let batch = firestore.batch();
  let count = 0;
  for (const docSnap of source.docs) {
    batch.set(destCollection.doc(docSnap.id), docSnap.data());
    count++;
    if (count % BATCH_LIMIT === 0) {
      await batch.commit();
      batch = firestore.batch();
    }
  }
  await batch.commit();
  console.log(`Copied ${source.size} document(s) from "${name}" into "clubs/${clubId}/${name}".`);
}

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID });
  const firestore = getFirestore(app);

  const clubId = await ensureClub(firestore);

  for (const name of COPIED_COLLECTIONS) {
    await copyCollection(firestore, clubId, name);
  }

  console.log(
    `\nDone. clubId=${clubId}, slug=${CLUB_SLUG}. Old flat collections were left untouched — safe to delete later, once the club-scoped bundle is confirmed working, via a separate cleanup pass (see CLAUDE.md).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
