import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { RoleDefinition } from '../../../core/models/role-definition.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'committeeRoleDefinitions';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Committee (governance) role titles — deliberately kept separate from
 * RoleDefinitionService's meeting roles. Meeting roles are claimed live by
 * members via check-in and are read by the check-in role board; committee
 * titles are assigned only by the admin and must never appear there.
 *
 * Firestore-backed, in its own `committeeRoleDefinitions` collection — no
 * hardcoded fallback, so a fresh environment needs `npm run seed:roles`
 * (see scripts/seed-role-definitions.mjs) before this collection has
 * anything in it.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeRoleDefinitionService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);

  private readonly definitions = signal<RoleDefinition[]>([]);
  private readonly unsubscribe: () => void;

  readonly all = computed(() => [...this.definitions()].sort((a, b) => a.order - b.order));
  readonly activeRoles = computed(() => this.all().filter((r) => r.active));

  constructor() {
    this.unsubscribe = onSnapshot(
      collection(this.firestore, COLLECTION),
      (snap) =>
        this.zone.run(() => {
          this.definitions.set(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RoleDefinition)
          );
        }),
      (err) =>
        this.zone.run(() => console.error('committeeRoleDefinitions snapshot listener failed', err))
    );
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }

  async create(label: string, description?: string): Promise<RoleDefinition> {
    const trimmed = label.trim();
    const maxOrder = this.definitions().reduce((max, r) => Math.max(max, r.order), -1);
    const role: RoleDefinition = {
      id: makeId(),
      label: trimmed,
      order: maxOrder + 1,
      active: true,
      ...(description?.trim() ? { description: description.trim() } : {}),
    };
    const { id, ...data } = role;
    await setDoc(doc(this.firestore, COLLECTION, id), data).catch((err) => {
      console.error('committeeRoleDefinitions create failed', err);
      throw err;
    });
    return role;
  }

  async update(id: string, patch: Partial<Pick<RoleDefinition, 'label' | 'description'>>): Promise<void> {
    await updateDoc(doc(this.firestore, COLLECTION, id), patch).catch((err) =>
      console.error('committeeRoleDefinitions update failed', err)
    );
  }

  async archive(id: string): Promise<void> {
    await updateDoc(doc(this.firestore, COLLECTION, id), { active: false }).catch((err) =>
      console.error('committeeRoleDefinitions archive failed', err)
    );
  }

  async restore(id: string): Promise<void> {
    await updateDoc(doc(this.firestore, COLLECTION, id), { active: true }).catch((err) =>
      console.error('committeeRoleDefinitions restore failed', err)
    );
  }
}
