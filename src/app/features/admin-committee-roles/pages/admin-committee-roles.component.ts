import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommitteeRoleDefinitionService } from '../../agenda-editor/services/committee-role-definition.service';
import { CommitteeRosterService } from '../../agenda-editor/services/committee-roster.service';
import { CommitteeImportExportService } from '../services/committee-import-export.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

/**
 * The DOCX/live-preview "Executive Committee" footer (docx.service.ts /
 * agenda-preview.component.ts) is a hand-tuned, fixed table hardcoded to
 * exactly these 7 role ids — see CLAUDE.md's admin-committee-roles Structure
 * entry. A role beyond these is fully assignable here but never prints;
 * that's an accepted scope boundary, not a bug.
 */
const PRINTED_ROLE_IDS = new Set([
  'president',
  'secretary',
  'vpEducation',
  'communityManager',
  'vpMembership',
  'rsaAmbassador',
  'treasurer',
]);

@Component({
  selector: 'app-admin-committee-roles',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './admin-committee-roles.component.html',
})
export class AdminCommitteeRolesComponent {
  readonly roleDefs = inject(CommitteeRoleDefinitionService);
  readonly roster = inject(CommitteeRosterService);
  private readonly importExport = inject(CommitteeImportExportService);

  newLabel = '';
  newDescription = '';

  editingId: string | null = null;
  editLabel = '';
  editDescription = '';

  // Assignment form state — at most one role's inline assign/reassign form is open at a time.
  assigningRoleId: string | null = null;
  assignName = '';
  assignEmail = '';
  assignPhone = '';
  assignError: string | null = null;
  private readonly pendingRoles = new Set<string>();

  get roles() {
    return this.roleDefs.all();
  }

  create() {
    const label = this.newLabel.trim();
    if (!label) return;
    this.roleDefs.create(label, this.newDescription);
    this.newLabel = '';
    this.newDescription = '';
  }

  startEdit(id: string, label: string, description: string | undefined) {
    this.editingId = id;
    this.editLabel = label;
    this.editDescription = description || '';
  }

  saveEdit() {
    if (!this.editingId) return;
    const label = this.editLabel.trim();
    if (!label) return;
    this.roleDefs.update(this.editingId, { label, description: this.editDescription });
    this.cancelEdit();
  }

  cancelEdit() {
    this.editingId = null;
    this.editLabel = '';
    this.editDescription = '';
  }

  archive(id: string) {
    this.roleDefs.archive(id);
  }

  restore(id: string) {
    this.roleDefs.restore(id);
  }

  /** Whether roleId is one of the 7 fixed ids the DOCX/preview footer actually prints. */
  isPrinted(roleId: string): boolean {
    return PRINTED_ROLE_IDS.has(roleId);
  }

  memberFor(roleId: string) {
    return this.roster.all().find((m) => m.roleId === roleId);
  }

  isPending(roleId: string): boolean {
    return this.pendingRoles.has(roleId);
  }

  /** Opens the inline assign/reassign form for roleId, prefilled with whoever currently holds it (if anyone). */
  startAssign(roleId: string) {
    const existing = this.memberFor(roleId);
    this.assigningRoleId = roleId;
    this.assignName = existing?.name ?? '';
    this.assignEmail = existing?.email ?? '';
    this.assignPhone = existing?.phone ?? '';
    this.assignError = null;
  }

  cancelAssign() {
    this.assigningRoleId = null;
    this.assignName = '';
    this.assignEmail = '';
    this.assignPhone = '';
    this.assignError = null;
  }

  async confirmAssign(roleId: string) {
    const name = this.assignName.trim();
    if (!name) return;
    this.assignError = null;
    this.pendingRoles.add(roleId);
    try {
      await this.roster.assign(roleId, name, this.assignEmail.trim(), this.assignPhone.trim());
      this.cancelAssign();
    } catch {
      this.assignError = 'Could not save this assignment — try again.';
    } finally {
      this.pendingRoles.delete(roleId);
    }
  }

  async unassign(roleId: string) {
    this.assignError = null;
    this.pendingRoles.add(roleId);
    try {
      await this.roster.unassign(roleId);
    } catch {
      this.assignError = 'Could not remove this assignment — try again.';
    } finally {
      this.pendingRoles.delete(roleId);
    }
  }

  saveJSON() {
    this.importExport.saveJSON();
  }

  loadJSON() {
    document.getElementById('committee-import-file')?.click();
  }

  async onImportJSON(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target!.result as string);
        await this.importExport.loadSnapshot(data);
      } catch (err) {
        alert('Error loading JSON: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }
}
