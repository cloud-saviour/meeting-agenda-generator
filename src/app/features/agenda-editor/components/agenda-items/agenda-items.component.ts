import { Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { AgendaStateService } from '../../services/agenda-state.service';
import { AgendaItem } from '../../models/agenda.models';
import { RoleDefinitionService } from '../../../../core/services/role-definition.service';
import { CommitteeRoleDefinitionService } from '../../services/committee-role-definition.service';

@Component({
  selector: 'app-agenda-items',
  standalone: true,
  imports: [DragDropModule, NgClass],
  templateUrl: './agenda-items.component.html',
})
export class AgendaItemsComponent {
  readonly state = inject(AgendaStateService);
  readonly roleDefs = inject(RoleDefinitionService);
  readonly committeeRoleDefs = inject(CommitteeRoleDefinitionService);
  readonly activeRoles = this.roleDefs.activeRoles;
  readonly activeCommitteeRoles = this.committeeRoleDefs.activeRoles;
  editMode = false;

  get items() {
    return this.state.agItems();
  }

  toggleEdit() {
    this.editMode = !this.editMode;
  }

  drop(event: CdkDragDrop<AgendaItem[]>) {
    this.state.moveAgItem(event.previousIndex, event.currentIndex);
  }

  add(type: AgendaItem['type']) {
    this.state.addAgItem(type);
  }

  remove(id: number) {
    this.state.removeAgItem(id);
  }

  update(id: number, field: string, value: unknown) {
    this.state.updateAgItem(id, field, value);
  }

  updateDual(id: number, subIdx: 0 | 1, field: string, value: unknown) {
    this.state.updateDualSubItem(id, subIdx, field, value);
  }

  /** Picking a real role clears any custom label — re-selecting the synthetic
   * custom-label option itself (value "") is a no-op. */
  onRoleChange(id: number, value: string) {
    if (!value) return;
    this.state.updateAgItem(id, 'roleId', value);
    this.state.updateAgItem(id, 'customRoleLabel', null);
  }

  onDualRoleChange(id: number, subIdx: 0 | 1, value: string) {
    if (!value) return;
    this.state.updateDualSubItem(id, subIdx, 'roleId', value);
    this.state.updateDualSubItem(id, subIdx, 'customRoleLabel', null);
  }

  typeBadge(type: string): string {
    const map: Record<string, string> = {
      row: 'row', dual: 'dual', speakers: 'tbl', evaluators: 'tbl', recess: 'break', notes: 'notes',
    };
    return map[type] ?? type;
  }

  typeClass(type: string): string {
    const map: Record<string, string> = {
      dual: 'bg-primary-subtle', speakers: 'bg-info-subtle', evaluators: 'bg-info-subtle',
      recess: 'bg-success-subtle', notes: 'bg-warning-subtle',
    };
    return map[type] ?? '';
  }

  badgeClass(type: string): string {
    const map: Record<string, string> = {
      row: 'bg-secondary', dual: 'bg-primary', speakers: 'bg-info', evaluators: 'bg-info',
      recess: 'bg-success', notes: 'bg-warning text-dark',
    };
    return map[type] ?? 'bg-secondary';
  }
}
