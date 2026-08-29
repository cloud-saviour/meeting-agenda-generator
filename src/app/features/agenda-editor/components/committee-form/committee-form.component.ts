import { Component, inject } from '@angular/core';
import { AgendaStateService } from '../../services/agenda-state.service';
import { CommitteeRoleDefinitionService } from '../../services/committee-role-definition.service';

@Component({
  selector: 'app-committee-form',
  standalone: true,
  templateUrl: './committee-form.component.html',
})
export class CommitteeFormComponent {
  readonly state = inject(AgendaStateService);
  readonly roleDefs = inject(CommitteeRoleDefinitionService);
  readonly activeRoles = this.roleDefs.activeRoles;
  get cmt() { return this.state.cmt(); }
  get m() { return this.state.meeting(); }
  saved = false;
  updateMember(i: number, field: string, value: string) {
    this.state.updateCommitteeMember(i, field as any, value);
  }
  updateMeeting(field: string, value: string) {
    this.state.updateMeeting({ [field]: value } as any);
  }
  saveRoster() {
    this.state.saveCommitteeRoster();
    this.saved = true;
    setTimeout(() => (this.saved = false), 2000);
  }
}
