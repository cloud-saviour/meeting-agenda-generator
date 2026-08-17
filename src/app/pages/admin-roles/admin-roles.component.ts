import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RoleDefinitionService } from '../../services/role-definition.service';

@Component({
  selector: 'app-admin-roles',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './admin-roles.component.html',
})
export class AdminRolesComponent {
  readonly roleDefs = inject(RoleDefinitionService);

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
