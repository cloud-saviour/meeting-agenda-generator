import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommitteeRoleDefinitionService } from '../../agenda-editor/services/committee-role-definition.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-admin-committee-roles',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './admin-committee-roles.component.html',
})
export class AdminCommitteeRolesComponent {
  readonly roleDefs = inject(CommitteeRoleDefinitionService);

  newLabel = '';
  newDescription = '';

  editingId: string | null = null;
  editLabel = '';
  editDescription = '';

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
}
