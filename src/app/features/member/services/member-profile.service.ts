import { Injectable, inject } from '@angular/core';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { MemberProfile } from '../models/member.models';
import { AuthService } from '../../../core/auth/auth.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'members';

/**
 * Self-service member profiles at `members/{uid}` — separate from the
 * admin-only accounts AuthService also handles. `displayName` exists in two
 * places (the Firebase Auth user record, and this Firestore doc); this
 * service is the one place that writes both together on an edit, so no
 * caller ever needs to know two systems are involved.
 */
@Injectable({ providedIn: 'root' })
export class MemberProfileService {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  createProfile(uid: string, email: string, displayName: string): Promise<void> {
    const now = new Date().toISOString();
    const profile: MemberProfile = { uid, email, displayName, createdAt: now, updatedAt: now };
    return setDoc(doc(this.firestore, COLLECTION, uid), profile).catch((err) => {
      console.error('members createProfile failed', err);
      throw err;
    });
  }

  /** One-time read, not a live subscription — a dashboard visit hydrates once, same as SavedAgendaService.load(). */
  async getProfile(uid: string): Promise<MemberProfile | null> {
    try {
      const snap = await getDoc(doc(this.firestore, COLLECTION, uid));
      return snap.exists() ? (snap.data() as MemberProfile) : null;
    } catch (err) {
      console.error('members getProfile failed', err);
      return null;
    }
  }

  /** Updates both the Firestore profile doc and the Auth user record's displayName in one call — see class doc. */
  async updateProfile(uid: string, patch: { displayName: string }): Promise<void> {
    await this.auth.updateDisplayName(patch.displayName);
    await updateDoc(doc(this.firestore, COLLECTION, uid), {
      displayName: patch.displayName,
      updatedAt: new Date().toISOString(),
    }).catch((err) => {
      console.error('members updateProfile failed', err);
      throw err;
    });
  }
}
