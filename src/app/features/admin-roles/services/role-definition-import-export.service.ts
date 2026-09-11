import { Injectable, inject } from '@angular/core';
import { saveAs } from 'file-saver';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { RoleDefinition } from '../../../core/models/role-definition.models';

/**
 * JSON export/import for the meeting-roles admin page — same shape as
 * AgendaImportExportService (agenda-editor/services/agenda-import-export.service.ts):
 * reads and writes only through RoleDefinitionService's public methods,
 * never the reverse.
 *
 * Import writes each role at its exact given id via setDefinition(), not
 * create() — role ids are stable keys referenced elsewhere (default-agenda.ts,
 * docx.service.ts, agenda-preview.component.ts, see CLAUDE.md), so a
 * restored role must land back on the same id it was exported with. This
 * also makes the export a genuine backup/migration file — e.g. moving the
 * standard role list from one Firebase project to another, the same job
 * scripts/seed-role-definitions.mjs does at the command line, now
 * available from the admin UI too.
 */
@Injectable({ providedIn: 'root' })
export class RoleDefinitionImportExportService {
  private readonly roleDefs = inject(RoleDefinitionService);

  getSnapshot(): RoleDefinition[] {
    return JSON.parse(JSON.stringify(this.roleDefs.all()));
  }

  saveJSON(): void {
    const blob = new Blob([JSON.stringify(this.getSnapshot(), null, 2)], {
      type: 'application/json',
    });
    saveAs(blob, 'meeting-roles.json');
  }

  /** Validates the whole payload before writing anything — a bad entry must never leave a partial import in Firestore. */
  async loadSnapshot(data: RoleDefinition[]): Promise<void> {
    if (!Array.isArray(data)) {
      throw new Error('Expected a JSON array of role definitions.');
    }
    for (const role of data) {
      if (!role.id || !role.label) {
        throw new Error('Each role needs at least an "id" and a "label".');
      }
    }
    for (const role of data) {
      await this.roleDefs.setDefinition({
        id: role.id,
        label: role.label,
        order: role.order ?? 0,
        active: role.active ?? true,
        ...(role.description ? { description: role.description } : {}),
      });
    }
  }
}
