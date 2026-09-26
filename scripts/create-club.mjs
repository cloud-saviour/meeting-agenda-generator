// Provisions a NEW club (multi-club groundwork has no self-service "create a
// club" UI yet — this script is the provisioning path). Creates
// `clubs/{clubId}` and its `clubSlugs/{slug}` pointer atomically, and can
// optionally make an existing Firebase Auth account a granted admin of the
// new club (`clubs/{clubId}/appAdmins/{uid}`), so the club is usable at once.
//
//   npm run create:club -- --slug=my-club --name="My Club" [--admin-email=a@b.c] [--sub-line=..] [--address=..]
//   npm run create:club:prod -- --slug=... (real project, via ADC)
//
// Refuses to run if the slug is already taken — never overwrites an existing
// club. Follow with `npm run seed:roles -- --club=<slug>` to give the new club
// its standard role lists (roles are per-club data).

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const isProd = args.includes('--prod');
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}

const slug = flag('slug');
const name = flag('name');
const adminEmail = flag('admin-email');

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !name) {
  console.error('Usage: create-club --slug=<lowercase-hyphenated> --name="Club Name" [--admin-email=..] [--sub-line=..] [--address=..] [--prod]');
  process.exit(1);
}

initializeApp({ projectId: isProd ? 'agenda-planner-101c4' : 'meeting-agenda-generator' });
const firestore = getFirestore();

async function main() {
  const slugRef = firestore.collection('clubSlugs').doc(slug);
  if ((await slugRef.get()).exists) {
    console.error(`Slug "${slug}" is already taken — pick another. Nothing was changed.`);
    process.exit(1);
  }

  let adminUser;
  if (adminEmail) {
    try {
      adminUser = await getAuth().getUserByEmail(adminEmail);
    } catch {
      console.error(`No Firebase Auth account for "${adminEmail}" — have them sign up at /signup first. Nothing was changed.`);
      process.exit(1);
    }
  }

  const clubRef = firestore.collection('clubs').doc();
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.set(clubRef, {
    slug,
    name,
    subLine: flag('sub-line') ?? '',
    addressLine: flag('address') ?? '',
    logoLeft: 'logo.png',
    logoRight: 'crown.png',
    missionStatement: '',
    website: '',
    facebookPage: '',
    createdAt: now,
    active: true,
  });
  batch.set(slugRef, { clubId: clubRef.id });
  if (adminUser) {
    batch.set(clubRef.collection('appAdmins').doc(adminUser.uid), {
      uid: adminUser.uid,
      email: adminUser.email ?? adminEmail,
      displayName: adminUser.displayName ?? adminEmail,
      grantedAt: now,
      grantedByEmail: 'scripts/create-club.mjs',
    });
  }
  await batch.commit();

  console.log(`Created club "${name}" — slug "${slug}", clubId ${clubRef.id}.`);
  if (adminUser) console.log(`Granted club admin to ${adminEmail}.`);
  console.log(`Next: npm run seed:roles${isProd ? ':prod' : ''} -- --club=${slug}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
