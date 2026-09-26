import { Injectable, inject } from '@angular/core';
import { collection, doc, getDoc, writeBatch } from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firestore.provider';
import { AuthService } from '../auth/auth.service';
import { appendAuditEntry } from '../audit/audit-log.util';
import { Club } from '../models/club.models';
import { RoleDefinition } from '../models/role-definition.models';
import { isValidClubSlug } from './club-slug.util';
import standardRoles from './standard-roles.json';

export interface NewClubInput {
  slug: string;
  name: string;
  subLine: string;
  addressLine: string;
  /** Optional first club admin — must be an existing account. */
  firstAdmin?: { uid: string; email: string; displayName: string };
}

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`The slug "${slug}" is already taken.`);
  }
}

/**
 * Creates a whole club in one atomic batch: the `clubs/{clubId}` doc, its
 * `clubSlugs/{slug}` pointer, the standard meeting/committee role lists, an
 * optional first club admin, and an audit entry. Platform admins only (the
 * real global claim) — enforced by firestore.rules, not just the screen's
 * route guard. Every write is authorised by that claim, so granting the
 * first admin inside the same batch works even though the new club's own
 * `appAdmins` list is empty at that moment.
 */
@Injectable({ providedIn: 'root' })
export class ClubProvisioningService {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  async isSlugTaken(slug: string): Promise<boolean> {
    return (await getDoc(doc(this.firestore, 'clubSlugs', slug))).exists();
  }

  /** Returns the new club's slug. Throws SlugTakenError for a taken slug; the rules remain the real guard against a race. */
  async createClub(input: NewClubInput): Promise<string> {
    const slug = input.slug.trim();
    const name = input.name.trim();
    if (!isValidClubSlug(slug)) throw new Error('Slug must be lowercase letters, digits and single hyphens.');
    if (!name) throw new Error('Club name is required.');
    if (await this.isSlugTaken(slug)) throw new SlugTakenError(slug);

    const now = new Date().toISOString();
    const actor = this.auth.currentUser();
    const clubRef = doc(collection(this.firestore, 'clubs'));
    const club: Club = {
      slug,
      name,
      subLine: input.subLine.trim(),
      addressLine: input.addressLine.trim(),
      logoLeft: 'logo.png',
      logoRight: 'crown.png',
      missionStatement: '',
      website: '',
      facebookPage: '',
      createdAt: now,
      active: true,
    };

    const batch = writeBatch(this.firestore);
    batch.set(clubRef, club);
    batch.set(doc(this.firestore, 'clubSlugs', slug), { clubId: clubRef.id });

    const rolesRef = collection(clubRef, 'roleDefinitions');
    for (const kind of ['meeting', 'committee'] as const) {
      for (const role of standardRoles[kind]) {
        const { id, ...data } = role;
        const value: Omit<RoleDefinition, 'id'> = { ...data, kind };
        batch.set(doc(rolesRef, id), value);
      }
    }

    if (input.firstAdmin) {
      const a = input.firstAdmin;
      batch.set(doc(collection(clubRef, 'appAdmins'), a.uid), {
        uid: a.uid,
        email: a.email,
        displayName: a.displayName,
        grantedAt: now,
        grantedByEmail: actor?.email ?? '',
      });
    }

    appendAuditEntry(this.firestore, batch, 'club.create', `Created club "${name}" (${slug})`, actor, clubRef.id);
    await batch.commit();
    return slug;
  }
}
