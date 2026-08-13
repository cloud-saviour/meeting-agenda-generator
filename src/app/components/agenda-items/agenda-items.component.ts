import { Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { AgendaStateService } from '../../services/agenda-state.service';
import { AgendaItem } from '../../models/agenda.models';

@Component({
  selector: 'app-agenda-items',
  standalone: true,
  imports: [DragDropModule, NgClass],
  templateUrl: './agenda-items.component.html',
})
export class AgendaItemsComponent {
  readonly state = inject(AgendaStateService);
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

  typeBadge(type: string): string {
    const map: Record<string, string> = {
      row: 'row', dual: 'dual', speakers: 'tbl', evaluators: 'tbl', recess: 'break', notes: 'notes',
    };
    return map[type] ?? type;
  }

  typeClass(type: string): string {
    const map: Record<string, string> = {
      dual: 'type-dual', speakers: 'type-special', evaluators: 'type-special',
      recess: 'type-recess', notes: 'type-notes',
    };
    return map[type] ?? '';
  }

  badgeClass(type: string): string {
    const map: Record<string, string> = {
      row: 'badge-row', dual: 'badge-dual', speakers: 'badge-special', evaluators: 'badge-special',
      recess: 'badge-recess', notes: 'badge-notes',
    };
    return map[type] ?? 'badge-row';
  }
}
