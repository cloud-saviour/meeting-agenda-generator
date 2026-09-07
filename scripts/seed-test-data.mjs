// One-time dev convenience: seeds a single, fully connected demo meeting
// ("TEST-1") into the Firestore + Auth emulators for MANUAL browser QA —
// this is NOT fixture data for the automated suite. Every *.emulator.spec.ts
// file already carries its own inline fixtures/rules and clears the
// emulator between tests (see testEnv.clearFirestore() in each); this
// script is never imported by, and must never be run as part of,
// `npm run test:emulator`.
//
// Collections touched: savedAgendas, publishedAgendas, committeeRoster,
// checkins (all admin-write-only except checkins, which is public), plus
// Auth + members/{uid} for 3 non-admin member accounts, and memberHistory
// records tying those members to the seeded meeting.
//
// Soft dependency: assumes `npm run seed:roles` and `npm run seed:admin`
// have already been run — the committee roster below references committee
// role ids from seed-role-definitions.mjs, and the checkins attendee list
// includes the admin account if (and only if) it already exists.
//
// Uses firebase-admin, not the client SDK — bypasses firestore.rules,
// required for the admin-write-only collections (savedAgendas,
// publishedAgendas, committeeRoster, memberHistory), same reasoning as
// seed-role-definitions.mjs / seed-admin-user.mjs.
//
// Idempotent and safe to re-run: every doc write checks existence first and
// skips (logging why) rather than overwriting, and Auth user creation
// follows seed-admin-user.mjs's create-or-look-up pattern. Per the
// safe-debugging-practices skill, this script NEVER deletes or clears
// anything — the Auth emulator does not isolate by projectId, so a
// clear-then-recreate step here could wipe real interactive accounts
// (e.g. admin@example.com) in addition to its own.
//
// Run with `npm run seed:test-data` against a running `npm run emulators`.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const MEETING_ID = 'TEST-1';

const MEMBERS = [
  { email: 'member1@example.com', password: 'password123', displayName: 'Naledi Mokoena' },
  { email: 'member2@example.com', password: 'password123', displayName: 'Thabo Nkosi' },
  { email: 'member3@example.com', password: 'password123', displayName: 'Priya Naidoo' },
];

// roleIds below must match COMMITTEE_ROLES in scripts/seed-role-definitions.mjs.
// Reuses 3 of the 7 slots for the seeded members themselves (secretary/
// vpEducation/communityManager), so the same people who can sign in also
// show up as officers — there's no uid field on CommitteeMember, so this is
// a match-by-name/email convention only, not a real foreign key.
const COMMITTEE = [
  { roleId: 'president', name: 'Grace Adeyemi', email: 'grace.adeyemi@example.com', phone: '071 000 0001' },
  { roleId: 'secretary', name: 'Naledi Mokoena', email: 'member1@example.com', phone: '071 000 0002' },
  { roleId: 'vpEducation', name: 'Thabo Nkosi', email: 'member2@example.com', phone: '071 000 0003' },
  { roleId: 'communityManager', name: 'Priya Naidoo', email: 'member3@example.com', phone: '071 000 0004' },
  { roleId: 'vpMembership', name: 'Sipho Dlamini', email: 'sipho.dlamini@example.com', phone: '071 000 0005' },
  { roleId: 'rsaAmbassador', name: 'Lerato Khumalo', email: 'lerato.khumalo@example.com', phone: '071 000 0006' },
  { roleId: 'treasurer', name: 'Johan van der Merwe', email: 'johan.vdm@example.com', phone: '071 000 0007' },
];

const MEETING = {
  no: MEETING_ID,
  date: '2026-09-12',
  arr: '18:30',
  st: '18:45',
  theme: 'Storytelling That Sticks',
  word: 'resonate',
  club: "King's Speakers Club #12",
  sub: 'Agora Speakers',
  addr: '123 Main Street, Johannesburg',
  mission:
    'To provide a supportive and positive learning experience in which members are empowered to develop communication and leadership skills.',
  vpe: 'Thabo Nkosi',
  hotSeat: 'Priya Naidoo',
  reserve: 'Naledi Mokoena',
  apologies: 'None',
  period: 'Term 3',
  web: 'https://example.com',
  fb: 'https://facebook.com/example',
};

// Ported from src/app/features/agenda-editor/services/default-agenda.ts —
// same running order/roleIds/durations a real "New Agenda" would generate,
// plus one extra `notes` item at the end (the one AgendaItem variant
// defaultAgenda() doesn't exercise).
function buildAgendaItems(cmt) {
  const president = cmt.find((m) => m.roleId === 'president');
  const secretary = cmt.find((m) => m.roleId === 'secretary');
  const vpEducation = cmt.find((m) => m.roleId === 'vpEducation');
  let id = 0;
  const nextId = () => ++id;

  return [
    { id: nextId(), type: 'row', title: 'Call to order', person: secretary?.name || '', roleId: 'secretary', roleVisible: true, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Welcome', person: president?.name || '', roleId: 'president', roleVisible: true, customRoleLabel: null, duration: 3 },
    { id: nextId(), type: 'row', title: 'Meeting Leader (Evening Chairman)', person: '', roleId: 'toastmaster', roleVisible: false, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Programme Information', person: vpEducation?.name || '', roleId: 'vpEducation', roleVisible: true, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Timekeeper (explain role)', person: '', roleId: 'timer', roleVisible: false, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Grammarian (explain role)', person: '', roleId: 'grammarian', roleVisible: false, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Filler Word Counter (explain role)', person: '', roleId: 'ahCounter', roleVisible: false, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Introductions', person: '', roleId: 'toastmaster', roleVisible: true, customRoleLabel: null, duration: 16 },
    {
      id: nextId(),
      type: 'dual',
      durationA: 10,
      items: [
        { title: 'Impromptu Session', person: '', roleId: 'impromptuMaster', roleVisible: true, customRoleLabel: null },
        { title: 'Prepared Speaking Session', person: '', roleId: 'toastmaster', roleVisible: true, customRoleLabel: null },
      ],
    },
    { id: nextId(), type: 'speakers' },
    { id: nextId(), type: 'recess', title: 'Recess', duration: 15 },
    { id: nextId(), type: 'row', title: 'Call to order', person: secretary?.name || '', roleId: 'secretary', roleVisible: true, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Evaluation Session', person: '', roleId: 'toastmaster', roleVisible: true, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'evaluators' },
    { id: nextId(), type: 'row', title: "Timekeeper's Report", person: '', roleId: 'timer', roleVisible: false, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: "Grammarian's Report", person: '', roleId: 'grammarian', roleVisible: false, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: "Filler Word Counter's Report", person: '', roleId: 'ahCounter', roleVisible: false, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Meeting Evaluator', person: '', roleId: 'generalEvaluator', roleVisible: false, customRoleLabel: null, duration: 5 },
    { id: nextId(), type: 'row', title: 'Educational', person: '', roleId: 'toastmaster', roleVisible: false, customRoleLabel: null, duration: 10 },
    { id: nextId(), type: 'row', title: 'Planning for Next Meeting', person: vpEducation?.name || '', roleId: 'vpEducation', roleVisible: true, customRoleLabel: null, duration: 2 },
    { id: nextId(), type: 'row', title: 'Awards/Open Discussion', person: president?.name || '', roleId: 'president', roleVisible: true, customRoleLabel: null, duration: 4 },
    { id: nextId(), type: 'row', title: 'Meeting Adjourned', person: president?.name || '', roleId: 'president', roleVisible: true, customRoleLabel: null, duration: 0 },
    { id: nextId(), type: 'notes', text: 'Seeded via scripts/seed-test-data.mjs for manual QA — safe to delete.' },
  ];
}

function buildSpeakers() {
  return [
    { id: 1, name: 'Thabo Nkosi', level: 'CC 4', timeLo: 5, timeHi: 7, title: 'Finding Your Voice', evaluator: 'Priya Naidoo', roleId: 'evaluator', roleVisible: true },
    { id: 2, name: 'Priya Naidoo', level: 'CC 6', timeLo: 6, timeHi: 8, title: 'The Art of the Pause', evaluator: 'Naledi Mokoena', roleId: 'evaluator', roleVisible: true },
  ];
}

// roleIds below must match MEETING_ROLES in scripts/seed-role-definitions.mjs.
function buildCheckinSnapshot(members, adminUid) {
  const [m1, m2, m3] = members; // Naledi, Thabo, Priya, in MEMBERS order
  const now = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

  const attendees = [
    { uid: m1.uid, name: m1.displayName, joinedAt: now },
    { uid: m2.uid, name: m2.displayName, joinedAt: now },
    { uid: m3.uid, name: m3.displayName, joinedAt: now },
  ];
  if (adminUid) attendees.push({ uid: adminUid, name: 'Admin', joinedAt: now });

  return {
    meeting: {
      id: MEETING_ID,
      date: MEETING.date,
      theme: MEETING.theme,
      word: MEETING.word,
      start: MEETING.st,
      maxSpeakers: 2,
      club: MEETING.club,
      sub: MEETING.sub,
      addr: MEETING.addr,
    },
    attendees,
    roles: {
      toastmaster: { name: '', uid: '' },
      generalEvaluator: { name: '', uid: '' },
      grammarian: { name: m1.displayName, uid: m1.uid },
      timer: { name: m3.displayName, uid: m3.uid },
      ahCounter: { name: '', uid: '' },
      evaluationChairman: { name: '', uid: '' },
      impromptuMaster: { name: '', uid: '' },
      evaluator: { name: '', uid: '' },
    },
    speakers: [
      { id: 'seed-spk-1', name: m2.displayName, uid: m2.uid, title: 'Finding Your Voice', level: 'CC 4', timePref: '5-7 min', evaluator: { name: m3.displayName, uid: m3.uid } },
      { id: 'seed-spk-2', name: m3.displayName, uid: m3.uid, title: 'The Art of the Pause', level: 'CC 6', timePref: '6-8 min', evaluator: { name: m1.displayName, uid: m1.uid } },
    ],
    lockedRoles: [],
  };
}

function buildMemberHistoryRecords(members) {
  const [m1, m2, m3] = members;
  const updatedAt = new Date().toISOString();
  const base = { meetingId: MEETING_ID, date: MEETING.date, theme: MEETING.theme, updatedAt };
  return [
    { ...base, uid: m1.uid, attended: true, rolesConfirmed: ['grammarian'], spoke: false, evaluatedSpeakerId: null },
    { ...base, uid: m2.uid, attended: true, rolesConfirmed: ['toastmaster'], spoke: true, evaluatedSpeakerId: null },
    { ...base, uid: m3.uid, attended: true, rolesConfirmed: ['timer'], spoke: true, evaluatedSpeakerId: 'seed-spk-1' },
  ];
}

// ── Idempotency helpers ─────────────────────────────────────────────────
async function seedNamedDoc(firestore, collectionName, docId, data) {
  const ref = firestore.collection(collectionName).doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    console.log(`Skipping "${collectionName}/${docId}" — already exists.`);
    return;
  }
  await ref.set(data);
  console.log(`Seeded "${collectionName}/${docId}".`);
}

async function ensureAuthUser(auth, email, password, displayName) {
  let uid;
  try {
    const user = await auth.createUser({ email, password, displayName });
    uid = user.uid;
    console.log(`Created member account: ${email} / ${password}`);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      uid = (await auth.getUserByEmail(email)).uid;
      console.log(`Member account already exists: ${email}`);
    } else {
      throw err;
    }
  }
  await auth.updateUser(uid, { displayName }); // backfill-safe on every re-run, same as seed-admin-user.mjs
  return uid;
}

async function seedMembers(auth, firestore) {
  const members = [];
  for (const m of MEMBERS) {
    const uid = await ensureAuthUser(auth, m.email, m.password, m.displayName);
    await seedNamedDoc(firestore, 'members', uid, {
      uid,
      email: m.email,
      displayName: m.displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    members.push({ uid, email: m.email, displayName: m.displayName });
  }
  return members;
}

async function lookupAdminUid(auth) {
  try {
    return (await auth.getUserByEmail('admin@example.com')).uid;
  } catch {
    console.warn(`No admin@example.com account found — run "npm run seed:admin" first to include the admin in checkins attendees.`);
    return null;
  }
}

async function main() {
  const app = initializeApp({ projectId: 'meeting-agenda-generator' });
  const firestore = getFirestore(app);
  const auth = getAuth(app);

  const members = await seedMembers(auth, firestore); // members first — everything below references their uids
  const adminUid = await lookupAdminUid(auth);

  await seedNamedDoc(firestore, 'committeeRoster', 'current', { members: COMMITTEE });

  const agendaSnapshot = { ...MEETING, agItems: buildAgendaItems(COMMITTEE), spks: buildSpeakers(), cmt: COMMITTEE };
  await seedNamedDoc(firestore, 'savedAgendas', MEETING_ID, { ...agendaSnapshot, updatedAt: new Date().toISOString() });
  // Bypasses PublishedAgendaService.publish()'s exclusive-publish batch (it
  // deletes every other published doc) since this is a raw Admin SDK write
  // — if another meeting is already published, both will show as published
  // afterward. Fine for QA data; use the app's own Publish button if you
  // need the single-published-meeting invariant preserved.
  await seedNamedDoc(firestore, 'publishedAgendas', MEETING_ID, { ...agendaSnapshot, publishedAt: new Date().toISOString() });

  const checkinSnapshot = buildCheckinSnapshot(members, adminUid);
  await seedNamedDoc(firestore, 'checkins', MEETING_ID, checkinSnapshot);

  for (const record of buildMemberHistoryRecords(members)) {
    await seedNamedDoc(firestore, 'memberHistory', `${MEETING_ID}_${record.uid}`, record);
  }

  console.log('\nDone. Demo meeting seeded:');
  console.log(`  Meeting: ${MEETING_ID} — "${MEETING.theme}"`);
  console.log(`  Members: ${MEMBERS.map((m) => `${m.email} / ${m.password}`).join(', ')}`);
  console.log(`  Admin flow:  http://localhost:4300/admin/agendas  (open meeting ${MEETING_ID})`);
  console.log(`  Check-in:    http://localhost:4300/checkin?meeting=${MEETING_ID}`);
  console.log(`  Preview:     http://localhost:4300/preview?meeting=${MEETING_ID}`);
  console.log(`  Member view: http://localhost:4300/member  (sign in as any member above)`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
