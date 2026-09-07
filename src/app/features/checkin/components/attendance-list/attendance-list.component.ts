import { Component, inject } from '@angular/core';
import { CheckinStateService } from '../../services/checkin-state.service';
import { AttendanceConfirmationService } from '../../services/attendance-confirmation.service';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  templateUrl: './attendance-list.component.html',
})
export class AttendanceListComponent {
  readonly state = inject(CheckinStateService);
  readonly auth = inject(AuthService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);

  get attendees() {
    return this.state.attendees();
  }

  isConfirmed(uid: string): boolean {
    return !!this.attendanceConfirmation.confirmationsForCurrentMeeting().get(uid)?.attended;
  }

  toggleConfirm(uid: string) {
    const meeting = this.state.meeting();
    const meta = { date: meeting.date, theme: meeting.theme };
    this.isConfirmed(uid)
      ? this.attendanceConfirmation.unconfirmAttendance(meeting.id, uid)
      : this.attendanceConfirmation.confirmAttendance(meeting.id, uid, meta);
  }
}
