import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { RoleDefinitionImportExportService } from '../services/role-definition-import-export.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-admin-roles',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './admin-roles.component.html',
})
export class AdminRolesComponent {
  readonly roleDefs = inject(RoleDefinitionService);
  private readonly importExport = inject(RoleDefinitionImportExportService);

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

  saveJSON() {
    this.importExport.saveJSON();
  }

  loadJSON() {
    document.getElementById('role-import-file')?.click();
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
