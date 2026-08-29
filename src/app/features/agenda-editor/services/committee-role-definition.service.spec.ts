import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CommitteeRoleDefinitionService } from './committee-role-definition.service';
import { StorageService } from '../../../core/services/storage.service';

class FakeStorage {
  private store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}

function makeService(): CommitteeRoleDefinitionService {
  TestBed.configureTestingModule({
    providers: [{ provide: StorageService, useClass: FakeStorage }],
  });
  return TestBed.inject(CommitteeRoleDefinitionService);
}

describe('CommitteeRoleDefinitionService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('seeds the 7 default committee roles when storage is empty', () => {
    const service = makeService();
    expect(service.all().length).toBe(7);
    expect(service.all().map((r) => r.id)).toContain('president');
  });

  it('create() adds a role with the next order index and persists it', () => {
    const service = makeService();
    const role = service.create('Sergeant at Arms');
    expect(role.order).toBe(7);
    expect(service.all().some((r) => r.id === role.id)).toBe(true);
  });

  it('archive() sets active=false without removing the entry; restore() reverses it', () => {
    const service = makeService();
    const id = service.all()[0].id;

    service.archive(id);
    expect(service.activeRoles().some((r) => r.id === id)).toBe(false);
    expect(service.all().some((r) => r.id === id)).toBe(true);

    service.restore(id);
    expect(service.activeRoles().some((r) => r.id === id)).toBe(true);
  });

  it('loads persisted roles from storage instead of reseeding when present', () => {
    const fake = new FakeStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: StorageService, useClass: FakeStorage }],
    });
    fake.set(
      'agora-committee-role-definitions',
      JSON.stringify([{ id: 'custom', label: 'Custom Role', order: 0, active: true }])
    );

    // Re-provide the same fake instance so the service reads what we just seeded
    TestBed.overrideProvider(StorageService, { useValue: fake });
    const service = TestBed.inject(CommitteeRoleDefinitionService);

    expect(service.all().length).toBe(1);
    expect(service.all()[0].id).toBe('custom');
  });
});
