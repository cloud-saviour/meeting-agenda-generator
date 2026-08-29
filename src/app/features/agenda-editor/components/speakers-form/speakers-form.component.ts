import { Component, inject } from '@angular/core';
import { AgendaStateService } from '../../services/agenda-state.service';
import { RoleDefinitionService } from '../../../../core/services/role-definition.service';

@Component({
  selector: 'app-speakers-form',
  standalone: true,
  templateUrl: './speakers-form.component.html',
})
export class SpeakersFormComponent {
  readonly state = inject(AgendaStateService);
  readonly roleDefs = inject(RoleDefinitionService);
  readonly activeRoles = this.roleDefs.activeRoles;
  get spks() { return this.state.spks(); }
  add() { this.state.addSpeaker(); }
  remove(id: number) { this.state.removeSpeaker(id); }
  update(id: number, field: string, value: any) { this.state.updateSpeaker(id, field as any, value); }
}
