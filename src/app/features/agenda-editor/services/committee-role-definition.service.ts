import { Injectable, computed, inject, signal } from '@angular/core';
import { RoleDefinition } from '../../../core/models/role-definition.models';
import { StorageService } from '../../../core/services/storage.service';

const STORAGE_KEY = 'agora-committee-role-definitions';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function seedRoles(): RoleDefinition[] {
  return [
    { id: 'president',        label: 'President',         order: 0, active: true },
    { id: 'secretary',        label: 'Secretary',         order: 1, active: true },
    { id: 'vpEducation',      label: 'VP Education',      order: 2, active: true },
    { id: 'communityManager', label: 'Community Manager', order: 3, active: true },
    { id: 'vpMembership',     label: 'VP Membership',     order: 4, active: true },
    { id: 'rsaAmbassador',    label: 'RSA Ambassador',    order: 5, active: true },
    { id: 'treasurer',        label: 'Treasurer',         order: 6, active: true },
  ];
}

/**
 * Committee (governance) role titles — deliberately kept separate from
 * RoleDefinitionService's meeting roles. Meeting roles are claimed live by
 * members via check-in and are read by the check-in role board; committee
 * titles are assigned only by the admin and must never appear there.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeRoleDefinitionService {
  // Declared before `definitions` so it's assigned before the field initializer below runs.
  private readonly storage = inject(StorageService);

  private readonly definitions = signal<RoleDefinition[]>(this.load());

  readonly all = computed(() => [...this.definitions()].sort((a, b) => a.order - b.order));
  readonly activeRoles = computed(() => this.all().filter((r) => r.active));

  create(label: string, description?: string): RoleDefinition {
    const trimmed = label.trim();
    const maxOrder = this.definitions().reduce((max, r) => Math.max(max, r.order), -1);
    const role: RoleDefinition = {
      id: makeId(),
      label: trimmed,
      description: description?.trim() || undefined,
      order: maxOrder + 1,
      active: true,
    };
    this.mutate((defs) => [...defs, role]);
    return role;
  }

  update(id: string, patch: Partial<Pick<RoleDefinition, 'label' | 'description'>>): void {
    this.mutate((defs) =>
      defs.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  archive(id: string): void {
    this.mutate((defs) => defs.map((r) => (r.id === id ? { ...r, active: false } : r)));
  }

  restore(id: string): void {
    this.mutate((defs) => defs.map((r) => (r.id === id ? { ...r, active: true } : r)));
  }

  private mutate(fn: (defs: RoleDefinition[]) => RoleDefinition[]): void {
    this.definitions.update(fn);
    this.persist();
  }

  private persist(): void {
    this.storage.set(STORAGE_KEY, JSON.stringify(this.definitions()));
  }

  private load(): RoleDefinition[] {
    try {
      const raw = this.storage.get(STORAGE_KEY);
      if (!raw) return seedRoles();
      const parsed = JSON.parse(raw) as RoleDefinition[];
      return Array.isArray(parsed) && parsed.length ? parsed : seedRoles();
    } catch {
      return seedRoles();
    }
  }
}
