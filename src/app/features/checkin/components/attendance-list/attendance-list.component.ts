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

  confirmError: string | null = null;
  private readonly pendingConfirm = new Set<string>();

  get attendees() {
    return this.state.attendees();
  }

  isConfirmed(uid: string): boolean {
    return !!this.attendanceConfirmation.confirmationsForCurrentMeeting().get(uid)?.attended;
  }

  /** Disables the button for this uid while its write is in flight — without this, a slow or
   *  failed Firestore write looks identical to a click that did nothing. */
  isConfirmPending(uid: string): boolean {
    return this.pendingConfirm.has(uid);
  }

  async toggleConfirm(uid: string) {
    this.confirmError = null;
    this.pendingConfirm.add(uid);
    try {
      const meeting = this.state.meeting();
      const meta = { date: meeting.date, theme: meeting.theme };
      await (this.isConfirmed(uid)
        ? this.attendanceConfirmation.unconfirmAttendance(meeting.id, uid)
        : this.attendanceConfirmation.confirmAttendance(meeting.id, uid, meta));
    } catch {
      this.confirmError = 'Could not update confirmation — try again.';
    } finally {
      this.pendingConfirm.delete(uid);
    }
  }
}
