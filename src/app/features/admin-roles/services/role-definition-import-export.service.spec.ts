import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RoleDefinitionImportExportService } from './role-definition-import-export.service';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { RoleDefinition } from '../../../core/models/role-definition.models';

describe('RoleDefinitionImportExportService', () => {
  let importExport: RoleDefinitionImportExportService;
  let roles: RoleDefinition[];
  let setDefinition: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    roles = [
      { id: 'toastmaster', label: 'Evening Chairman', order: 0, active: true, kind: 'meeting' },
      { id: 'timer', label: 'Timekeeper', order: 1, active: true, description: 'Keeps time', kind: 'meeting' },
    ];
    setDefinition = vi.fn().mockResolvedValue(undefined);
    const fakeRoleDefs = { meetingRoles: () => roles, setDefinition } as unknown as RoleDefinitionService;

    TestBed.configureTestingModule({
      providers: [{ provide: RoleDefinitionService, useValue: fakeRoleDefs }],
    });
    importExport = TestBed.inject(RoleDefinitionImportExportService);
  });

  it('getSnapshot() returns a deep clone of the current role list', () => {
    const snapshot = importExport.getSnapshot();
    expect(snapshot).toEqual(roles);
    expect(snapshot).not.toBe(roles);
  });

  it('loadSnapshot() calls setDefinition() once per role, preserving each role\'s exact id', async () => {
    await importExport.loadSnapshot(roles);
    expect(setDefinition).toHaveBeenCalledTimes(2);
    expect(setDefinition).toHaveBeenCalledWith(roles[0]);
    expect(setDefinition).toHaveBeenCalledWith(roles[1]);
  });

  it('loadSnapshot() defaults a missing order/active rather than writing undefined', async () => {
    await importExport.loadSnapshot([{ id: 'grammarian', label: 'Grammarian' } as RoleDefinition]);
    expect(setDefinition).toHaveBeenCalledWith({ id: 'grammarian', label: 'Grammarian', order: 0, active: true, kind: 'meeting' });
  });

  it('loadSnapshot() always tags imported roles kind: \'meeting\', regardless of what the imported file itself claims', async () => {
    await importExport.loadSnapshot([{ id: 'grammarian', label: 'Grammarian', kind: 'committee' } as RoleDefinition]);
    expect(setDefinition).toHaveBeenCalledWith(expect.objectContaining({ kind: 'meeting' }));
  });

  it('loadSnapshot() rejects a non-array payload without writing anything', async () => {
    await expect(importExport.loadSnapshot({ not: 'an array' } as unknown as RoleDefinition[])).rejects.toThrow();
    expect(setDefinition).not.toHaveBeenCalled();
  });

  it('loadSnapshot() rejects an entry missing id or label, and writes nothing at all — not even the valid entries before it', async () => {
    await expect(
      importExport.loadSnapshot([roles[0], { label: 'No id' } as RoleDefinition])
    ).rejects.toThrow();
    expect(setDefinition).not.toHaveBeenCalled();
  });
});
