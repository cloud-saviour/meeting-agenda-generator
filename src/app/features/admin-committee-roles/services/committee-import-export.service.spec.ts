import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CommitteeImportExportService } from './committee-import-export.service';
import { CommitteeRoleDefinitionService } from '../../agenda-editor/services/committee-role-definition.service';
import { CommitteeRosterService } from '../../agenda-editor/services/committee-roster.service';
import { RoleDefinition } from '../../../core/models/role-definition.models';
import { CommitteeMember } from '../../agenda-editor/models/agenda.models';

describe('CommitteeImportExportService', () => {
  let importExport: CommitteeImportExportService;
  let roles: RoleDefinition[];
  let roster: CommitteeMember[];
  let setDefinition: ReturnType<typeof vi.fn>;
  let replaceAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    roles = [{ id: 'president', label: 'President', order: 0, active: true }];
    roster = [{ roleId: 'president', name: 'Naledi K.', email: 'naledi@example.com', phone: '' }];
    setDefinition = vi.fn().mockResolvedValue(undefined);
    replaceAll = vi.fn().mockResolvedValue(undefined);

    const fakeRoleDefs = { all: () => roles, setDefinition } as unknown as CommitteeRoleDefinitionService;
    const fakeRoster = { all: () => roster, replaceAll } as unknown as CommitteeRosterService;

    TestBed.configureTestingModule({
      providers: [
        { provide: CommitteeRoleDefinitionService, useValue: fakeRoleDefs },
        { provide: CommitteeRosterService, useValue: fakeRoster },
      ],
    });
    importExport = TestBed.inject(CommitteeImportExportService);
  });

  it('getSnapshot() returns a deep clone of both the role list and the roster', () => {
    const snapshot = importExport.getSnapshot();
    expect(snapshot.roleDefinitions).toEqual(roles);
    expect(snapshot.roster).toEqual(roster);
    expect(snapshot.roleDefinitions).not.toBe(roles);
    expect(snapshot.roster).not.toBe(roster);
  });

  it('loadSnapshot() upserts every role definition then replaces the whole roster in one call', async () => {
    await importExport.loadSnapshot({ roleDefinitions: roles, roster });
    expect(setDefinition).toHaveBeenCalledTimes(1);
    expect(setDefinition).toHaveBeenCalledWith(roles[0]);
    expect(replaceAll).toHaveBeenCalledTimes(1);
    expect(replaceAll).toHaveBeenCalledWith(roster);
  });

  it('loadSnapshot() rejects a payload missing either array, writing nothing', async () => {
    await expect(
      importExport.loadSnapshot({ roleDefinitions: roles } as any)
    ).rejects.toThrow();
    expect(setDefinition).not.toHaveBeenCalled();
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it('loadSnapshot() rejects a roster entry missing roleId or name, writing nothing at all', async () => {
    await expect(
      importExport.loadSnapshot({ roleDefinitions: roles, roster: [{ name: 'No role id' } as CommitteeMember] })
    ).rejects.toThrow();
    expect(setDefinition).not.toHaveBeenCalled();
    expect(replaceAll).not.toHaveBeenCalled();
  });
});
