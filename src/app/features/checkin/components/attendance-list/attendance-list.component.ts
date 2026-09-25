import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckinStateService } from '../../services/checkin-state.service';
import { AttendanceConfirmationService } from '../../services/attendance-confirmation.service';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './attendance-list.component.html',
})
export class AttendanceListComponent {
  readonly state = inject(CheckinStateService);
  readonly auth = inject(AuthService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);

  confirmError: string | null = null;
  private readonly pendingConfirm = new Set<string>();

  editingUid: string | null = null;
  editName = '';
  private readonly pendingEdit = new Set<string>();
  private readonly pendingRemove = new Set<string>();

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

  startEdit(uid: string, currentName: string) {
    this.editingUid = uid;
    this.editName = currentName;
  }

  cancelEdit() {
    this.editingUid = null;
    this.editName = '';
  }

  isEditPending(uid: string): boolean {
    return this.pendingEdit.has(uid);
  }

  async saveEdit() {
    if (!this.editingUid) return;
    const name = this.editName.trim();
    if (!name) return;
    const uid = this.editingUid;
    this.pendingEdit.add(uid);
    try {
      await this.state.adminRenamePerson(uid, name);
      this.cancelEdit();
    } catch {
      this.confirmError = 'Could not rename — try again.';
    } finally {
      this.pendingEdit.delete(uid);
    }
  }

  isRemovePending(uid: string): boolean {
    return this.pendingRemove.has(uid);
  }

  async remove(uid: string, name: string) {
    const confirmed = confirm(
      `Remove "${name}" from attendance? This also releases any role claim, speaker signup, and evaluator slot they hold. Use this only for a bogus/duplicate entry, not a real withdrawal — this will NOT list them as an apology.`
    );
    if (!confirmed) return;
    this.confirmError = null;
    this.pendingRemove.add(uid);
    try {
      await this.state.adminRemoveAttendee(uid);
    } catch {
      this.confirmError = 'Could not remove — try again.';
    } finally {
      this.pendingRemove.delete(uid);
    }
  }
}
