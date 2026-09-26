import { Injectable, inject } from '@angular/core';
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firestore.provider';
import { AuthService } from '../auth/auth.service';
import { appendAuditEntry } from '../audit/audit-log.util';
import { Club } from '../models/club.models';

/** A club plus its internal document id, which is what every club-scoped path is keyed by. */
export interface ClubRecord extends Club {
  id: string;
}

/**
 * The fields a platform admin may change. `slug` and `createdAt` are
 * immutable (firestore.rules enforces it). `active: false` closes the club
 * to everyone but platform admins (see ClubContextService.unavailable).
 */
export type ClubEditableFields = ClubDetailFields & Pick<Club, 'active'>;

/** The branding fields a club's OWN admins may change (firestore.rules allows exactly these, never `active`). */
export type ClubDetailFields = Pick<
  Club,
  'name' | 'subLine' | 'addressLine' | 'missionStatement' | 'website' | 'facebookPage' | 'logoLeft' | 'logoRight'
>;

/**
 * Read and edit side of club management for platform admins (creation is
 * ClubProvisioningService). One-time reads, not live listeners: this is an
 * occasional admin screen. Deleting a club is deliberately not offered — a
 * club owns many subcollections, and firestore.rules gives no client a
 * delete on `clubs/{clubId}`.
 */
@Injectable({ providedIn: 'root' })
export class ClubDirectoryService {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  async listClubs(): Promise<ClubRecord[]> {
    const snap = await getDocs(collection(this.firestore, 'clubs'));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Club) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Only clubs that are switched on, for the public club picker — works signed out, since `clubs` is public-read. */
  async listActiveClubs(): Promise<ClubRecord[]> {
    const snap = await getDocs(query(collection(this.firestore, 'clubs'), where('active', '==', true)));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Club) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getClubBySlug(slug: string): Promise<ClubRecord | null> {
    const pointer = await getDoc(doc(this.firestore, 'clubSlugs', slug));
    if (!pointer.exists()) return null;
    const clubId = (pointer.data() as { clubId: string }).clubId;
    const club = await getDoc(doc(this.firestore, 'clubs', clubId));
    return club.exists() ? { id: club.id, ...(club.data() as Club) } : null;
  }

  /** Updates the club and writes a `club.update` audit entry in the same batch. */
  async updateClub(clubId: string, slug: string, fields: ClubEditableFields, wasActive = true): Promise<void> {
    const name = fields.name.trim();
    if (!name) throw new Error('Club name is required.');

    const clubRef = doc(this.firestore, 'clubs', clubId);
    const batch = writeBatch(this.firestore);
    batch.update(clubRef, {
      name,
      subLine: fields.subLine.trim(),
      addressLine: fields.addressLine.trim(),
      missionStatement: fields.missionStatement.trim(),
      website: fields.website.trim(),
      facebookPage: fields.facebookPage.trim(),
      logoLeft: fields.logoLeft,
      logoRight: fields.logoRight,
      active: fields.active,
    });
    const change = wasActive === fields.active ? 'Edited' : fields.active ? 'Reactivated' : 'Deactivated';
    appendAuditEntry(this.firestore, batch, 'club.update', `${change} club "${name}" (${slug})`, this.auth.currentUser(), clubId);
    await batch.commit();
  }

  /**
   * The club-admin edit: branding only, never `active` (rules enforce it, and
   * a plain `update` of just these keys is what lets a non-platform admin
   * through). Writes a `club.update` audit entry in the same batch.
   */
  async updateClubDetails(clubId: string, slug: string, fields: ClubDetailFields): Promise<void> {
    const name = fields.name.trim();
    if (!name) throw new Error('Club name is required.');

    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, 'clubs', clubId), {
      name,
      subLine: fields.subLine.trim(),
      addressLine: fields.addressLine.trim(),
      missionStatement: fields.missionStatement.trim(),
      website: fields.website.trim(),
      facebookPage: fields.facebookPage.trim(),
      logoLeft: fields.logoLeft,
      logoRight: fields.logoRight,
    });
    appendAuditEntry(this.firestore, batch, 'club.update', `Edited club "${name}" (${slug})`, this.auth.currentUser(), clubId);
    await batch.commit();
  }
}
