import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { RoleDefinition, RoleKind } from '../models/role-definition.models';
import { FIRESTORE } from '../firebase/firestore.provider';
import { AuthService } from '../auth/auth.service';
import { appendAuditEntry } from '../audit/audit-log.util';

const COLLECTION = 'roleDefinitions';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const KIND_LABEL: Record<RoleKind, string> = { meeting: 'meeting role', committee: 'committee role' };

/**
 * Both meeting role titles (Evening Chairman, Grammarian, etc. — claimed
 * live by members via check-in) and committee/governance titles (President,
 * Secretary, etc. — assigned only by an admin on /admin/committee-roles),
 * discriminated by `RoleDefinition.kind`. These used to be two entirely
 * separate collections/services (`roleDefinitions` +
 * `CommitteeRoleDefinitionService`/`committeeRoleDefinitions`) with
 * copy-pasted CRUD on an identical shape — merged into one, since the
 * distinction was never really about the *data*, only about which admin
 * page manages it and which check-in surface can see it (the check-in role
 * board must never show committee titles — see `activeMeetingRoles` below).
 *
 * The full role list lives in Firestore's `roleDefinitions` collection;
 * there is no hardcoded fallback, so a fresh environment needs
 * `npm run seed:roles` (see scripts/seed-role-definitions.mjs) before this
 * collection has anything in it. A doc with no `kind` field (any role
 * created before this merge, if the one-time migration script hasn't run
 * yet) is treated as `'meeting'` on read — the same default the migration
 * script itself backfills, kept here too so a delayed/partial migration
 * degrades safely instead of silently hiding a role.
 */
@Injectable({ providedIn: 'root' })
export class RoleDefinitionService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private readonly definitions = signal<RoleDefinition[]>([]);
  private readonly unsubscribe: () => void;

  /** Every role, both kinds, sorted by order — for lookups that don't care which kind a given id belongs to (agenda-preview, docx). */
  readonly all = computed(() => [...this.definitions()].sort((a, b) => a.order - b.order));

  readonly meetingRoles = computed(() => this.all().filter((r) => r.kind === 'meeting'));
  readonly activeMeetingRoles = computed(() => this.meetingRoles().filter((r) => r.active));

  readonly committeeRoles = computed(() => this.all().filter((r) => r.kind === 'committee'));
  readonly activeCommitteeRoles = computed(() => this.committeeRoles().filter((r) => r.active));

  constructor() {
    this.unsubscribe = onSnapshot(
      collection(this.firestore, COLLECTION),
      (snap) =>
        this.zone.run(() => {
          this.definitions.set(
            snap.docs.map((d) => {
              const data = d.data() as Omit<RoleDefinition, 'id' | 'kind'> & { kind?: RoleKind };
              return { id: d.id, ...data, kind: data.kind ?? 'meeting' } as RoleDefinition;
            })
          );
        }),
      (err) => this.zone.run(() => console.error('roleDefinitions snapshot listener failed', err))
    );
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }

  async create(kind: RoleKind, label: string, description?: string): Promise<RoleDefinition> {
    const trimmed = label.trim();
    // Order is scoped to the same kind — a meeting role's position among
    // other meeting roles shouldn't be pushed out by however many committee
    // roles happen to exist (each kind is sorted and rendered as its own
    // independent list, so the two numbering spaces are otherwise unrelated).
    const maxOrder = this.definitions()
      .filter((r) => r.kind === kind)
      .reduce((max, r) => Math.max(max, r.order), -1);
    const role: RoleDefinition = {
      id: makeId(),
      label: trimmed,
      order: maxOrder + 1,
      active: true,
      kind,
      ...(description?.trim() ? { description: description.trim() } : {}),
    };
    const { id, ...data } = role;

    const batch = writeBatch(this.firestore);
    batch.set(doc(this.firestore, COLLECTION, id), data);
    appendAuditEntry(
      this.firestore,
      batch,
      kind === 'committee' ? 'committeeRole.create' : 'role.create',
      `Created ${KIND_LABEL[kind]} "${trimmed}"`,
      this.auth.currentUser()
    );
    await batch.commit().catch((err) => {
      console.error('roleDefinitions create failed', err);
      throw err;
    });
    return role;
  }

  /**
   * Upserts a role at its exact given id, overwriting whatever's there —
   * unlike create(), which always generates a fresh id. For JSON import:
   * a restored role must land back on the same id it was exported with,
   * since role ids are stable keys referenced elsewhere (default-agenda.ts,
   * docx.service.ts, agenda-preview.component.ts — see CLAUDE.md). Callers
   * set `kind` explicitly rather than trusting whatever's in an imported
   * file, since a file imported via the meeting-roles page should always
   * land as `kind: 'meeting'` regardless of what it claims to be.
   */
  async setDefinition(role: RoleDefinition): Promise<void> {
    const { id, ...data } = role;
    await setDoc(doc(this.firestore, COLLECTION, id), data).catch((err) => {
      console.error('roleDefinitions setDefinition failed', err);
      throw err;
    });
  }

  async update(id: string, patch: Partial<Pick<RoleDefinition, 'label' | 'description'>>): Promise<void> {
    await updateDoc(doc(this.firestore, COLLECTION, id), patch).catch((err) =>
      console.error('roleDefinitions update failed', err)
    );
  }

  async archive(id: string): Promise<void> {
    const role = this.definitions().find((r) => r.id === id);
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, COLLECTION, id), { active: false });
    appendAuditEntry(
      this.firestore,
      batch,
      role?.kind === 'committee' ? 'committeeRole.archive' : 'role.archive',
      `Archived ${KIND_LABEL[role?.kind ?? 'meeting']} "${role?.label ?? id}"`,
      this.auth.currentUser()
    );
    await batch.commit().catch((err) => console.error('roleDefinitions archive failed', err));
  }

  async restore(id: string): Promise<void> {
    const role = this.definitions().find((r) => r.id === id);
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, COLLECTION, id), { active: true });
    appendAuditEntry(
      this.firestore,
      batch,
      role?.kind === 'committee' ? 'committeeRole.restore' : 'role.restore',
      `Restored ${KIND_LABEL[role?.kind ?? 'meeting']} "${role?.label ?? id}"`,
      this.auth.currentUser()
    );
    await batch.commit().catch((err) => console.error('roleDefinitions restore failed', err));
  }
}
