import { Component, inject } from '@angular/core';
import { SignupStateService } from '../../services/signup-state.service';

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  templateUrl: './attendance-list.component.html',
})
export class AttendanceListComponent {
  readonly state = inject(SignupStateService);

  get attendees() {
    return this.state.attendees();
  }
}
