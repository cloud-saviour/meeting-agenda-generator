import { Injectable, computed, inject, signal } from '@angular/core';
import { RoleDefinition } from '../models/role-definition.models';
import { StorageService } from './storage.service';

const STORAGE_KEY = 'agora-role-definitions';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function seedRoles(): RoleDefinition[] {
  return [
    { id: 'toastmaster',        label: 'Evening Chairman',         order: 0, active: true },
    { id: 'generalEvaluator',   label: 'Meeting Evaluator',        order: 1, active: true },
    { id: 'grammarian',         label: 'Grammarian',               order: 2, active: true },
    { id: 'timer',              label: 'Timekeeper',               order: 3, active: true },
    { id: 'ahCounter',          label: 'Filler Word Counter',      order: 4, active: true },
    { id: 'evaluationChairman', label: 'Evaluation Chairman',      order: 5, active: true },
  ];
}

@Injectable({ providedIn: 'root' })
export class RoleDefinitionService {
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
