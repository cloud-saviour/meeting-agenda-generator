import { Component, inject } from '@angular/core';
import { CheckinStateService } from '../../services/checkin-state.service';

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  templateUrl: './attendance-list.component.html',
})
export class AttendanceListComponent {
  readonly state = inject(CheckinStateService);

  get attendees() {
    return this.state.attendees();
  }
}
