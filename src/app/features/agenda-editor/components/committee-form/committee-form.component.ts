import { Component, inject } from '@angular/core';
import { AgendaStateService } from '../../services/agenda-state.service';

@Component({
  selector: 'app-committee-form',
  standalone: true,
  templateUrl: './committee-form.component.html',
})
export class CommitteeFormComponent {
  readonly state = inject(AgendaStateService);
  get cmt() { return this.state.cmt(); }
  get m() { return this.state.meeting(); }
  updateMember(i: number, field: string, value: string) {
    this.state.updateCommitteeMember(i, field as any, value);
  }
  updateMeeting(field: string, value: string) {
    this.state.updateMeeting({ [field]: value } as any);
  }
}
