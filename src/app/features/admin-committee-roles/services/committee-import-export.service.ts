import { Injectable, inject } from '@angular/core';
import { saveAs } from 'file-saver';
import { CommitteeRoleDefinitionService } from '../../agenda-editor/services/committee-role-definition.service';
import { CommitteeRosterService } from '../../agenda-editor/services/committee-roster.service';
import { RoleDefinition } from '../../../core/models/role-definition.models';
import { CommitteeMember } from '../../agenda-editor/models/agenda.models';

export interface CommitteeSnapshot {
  roleDefinitions: RoleDefinition[];
  roster: CommitteeMember[];
}

/**
 * JSON export/import for the committee-roles admin page — same shape as
 * AgendaImportExportService, but covers two collections at once
 * (committeeRoleDefinitions + committeeRoster), since this page manages
 * both together and a roster entry's roleId is only meaningful alongside
 * its definition.
 *
 * Import upserts each role definition at its exact given id (setDefinition,
 * not create — see RoleDefinitionImportExportService's identical reasoning
 * in admin-roles/services/), then replaces the whole roster in one atomic
 * write (replaceAll) — the imported file is the new source of truth for
 * "who holds what," not a merge into whoever's currently assigned.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeImportExportService {
  private readonly roleDefs = inject(CommitteeRoleDefinitionService);
  private readonly roster = inject(CommitteeRosterService);

  getSnapshot(): CommitteeSnapshot {
    return {
      roleDefinitions: JSON.parse(JSON.stringify(this.roleDefs.all())),
      roster: JSON.parse(JSON.stringify(this.roster.all())),
    };
  }

  saveJSON(): void {
    const blob = new Blob([JSON.stringify(this.getSnapshot(), null, 2)], {
      type: 'application/json',
    });
    saveAs(blob, 'committee-roles.json');
  }

  /** Validates the whole payload before writing anything — a bad entry must never leave a partial import in Firestore. */
  async loadSnapshot(data: CommitteeSnapshot): Promise<void> {
    if (!data || !Array.isArray(data.roleDefinitions) || !Array.isArray(data.roster)) {
      throw new Error('Expected an object with "roleDefinitions" and "roster" arrays.');
    }
    for (const role of data.roleDefinitions) {
      if (!role.id || !role.label) {
        throw new Error('Each role needs at least an "id" and a "label".');
      }
    }
    for (const member of data.roster) {
      if (!member.roleId || !member.name) {
        throw new Error('Each roster entry needs at least a "roleId" and a "name".');
      }
    }

    for (const role of data.roleDefinitions) {
      await this.roleDefs.setDefinition({
        id: role.id,
        label: role.label,
        order: role.order ?? 0,
        active: role.active ?? true,
        ...(role.description ? { description: role.description } : {}),
      });
    }
    await this.roster.replaceAll(
      data.roster.map((m) => ({ roleId: m.roleId, name: m.name, email: m.email ?? '', phone: m.phone ?? '' }))
    );
  }
}
